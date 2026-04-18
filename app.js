// ==========================================
// 状態管理・グローバル変数
// ==========================================
const AppState = {
  currentScreen: 'home',
  entryType: 'normal',
  session: {
    cards:[], currentIndex: 0, mode: 'normal', 
    startTime: 0, timerInterval: null, timeRemaining: 0, results:[]
  }
};

// ==========================================
// ユーティリティ関数
// ==========================================
async function getAllFromStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function normalizeString(str) {
  if (!str) return '';
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
            .replace(/[\s　\-ー]/g, '').toLowerCase();
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(`screen-${screenId}`).classList.add('active');
  AppState.currentScreen = screenId;
  window.scrollTo(0, 0);
}

function confirmAction(title, message) {
  return new Promise((resolve) => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').innerHTML = message.replace(/\n/g, '<br>');
    const modal = document.getElementById('modal-confirm');
    modal.classList.add('active');

    const btnYes = document.getElementById('btn-confirm-yes');
    const btnNo = document.getElementById('btn-confirm-no');

    const handleYes = () => { cleanup(); resolve(true); };
    const handleNo = () => { cleanup(); resolve(false); };

    function cleanup() {
      modal.classList.remove('active');
      btnYes.removeEventListener('click', handleYes);
      btnNo.removeEventListener('click', handleNo);
    }
    btnYes.addEventListener('click', handleYes);
    btnNo.addEventListener('click', handleNo);
  });
}

// ==========================================
// 初期化・イベントリスナー
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.menu-btn[data-target]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = e.target.closest('button').dataset.target;
      const entry = e.target.closest('button').dataset.entry;
      if (target === 'config') {
        AppState.entryType = entry;
        await prepareConfigScreen();
      }
      showScreen(target);
    });
  });

  document.querySelectorAll('.nav-home').forEach(btn => btn.addEventListener('click', () => showScreen('home')));
  
  document.getElementById('btn-go-analytics').addEventListener('click', renderAnalyticsScreen);
  const btnList = document.getElementById('btn-go-list');
  if(btnList) btnList.addEventListener('click', renderListScreen);

  // セッション操作ボタン
  document.getElementById('btn-start-session').addEventListener('click', startSession);
  document.getElementById('btn-prev').addEventListener('click', () => navigateCard(-1));
  document.getElementById('btn-next').addEventListener('click', () => navigateCard(1));
  document.getElementById('btn-ans').addEventListener('click', handleAnswer);
  document.getElementById('btn-mark-correct').addEventListener('click', handleMarkCorrect);
  
  document.getElementById('btn-exit').addEventListener('click', () => document.getElementById('modal-exit').classList.add('active'));
  document.getElementById('btn-modal-no').addEventListener('click', () => document.getElementById('modal-exit').classList.remove('active'));
  document.getElementById('btn-modal-yes').addEventListener('click', () => {
    document.getElementById('modal-exit').classList.remove('active');
    endSession();
  });

  document.getElementById('btn-review-wrong').addEventListener('click', async () => {
    AppState.entryType = 'wrong';
    await prepareConfigScreen();
    showScreen('config');
  });

  // ========== 設定画面のイベント ==========
  
  // 1. CSVインポート
  const importBtn = document.getElementById('btn-import-csv');
  const fileInput = document.getElementById('csv-upload');
  const msgEl = document.getElementById('import-msg');

  importBtn.addEventListener('click', () => {
    const file = fileInput.files[0];
    if (!file) { msgEl.style.color = "var(--danger-color)"; msgEl.textContent = "ファイルを選択してください。"; return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const result = await importCSV(e.target.result);
        msgEl.style.color = "var(--success-color)"; 
        msgEl.textContent = `更新: ${result.updated}件 / 削除: ${result.deleted}件`;
        localStorage.setItem('lastDataUpdate', Date.now().toString());
      } catch (err) {
        msgEl.style.color = "var(--danger-color)"; msgEl.textContent = "エラー: " + err.message;
      }
    };
    reader.readAsText(file);
  });

  // 2. ★バックアップ（ダウンロード）
  document.getElementById('btn-export-backup').addEventListener('click', async () => {
    try {
      const includeCards = document.getElementById('backup-include-cards').checked;
      const jsonStr = await exportBackup(includeCards);
      
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // ファイル名を現在日時にする
      const d = new Date();
      const dateStr = `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}_${d.getHours().toString().padStart(2,'0')}${d.getMinutes().toString().padStart(2,'0')}`;
      a.download = `flashcard_backup_${dateStr}.json`;
      
      a.click();
      URL.revokeObjectURL(url);
      
      // 最終エクスポート日時を記録
      localStorage.setItem('lastBackupTimestamp', Date.now().toString());
      alert('バックアップをダウンロードしました。');
    } catch (err) {
      alert('バックアップ作成に失敗しました: ' + err.message);
    }
  });

  // 3. ★バックアップからの復元
  document.getElementById('btn-import-backup').addEventListener('click', async () => {
    const fileIn = document.getElementById('backup-upload');
    const msg = document.getElementById('backup-msg');
    const file = fileIn.files[0];
    
    if (!file) {
      msg.style.color = "var(--danger-color)"; msg.textContent = "JSONファイルを選択してください。"; return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const jsonStr = e.target.result;
        const backupData = JSON.parse(jsonStr);
        
        // タイムスタンプ比較（古いバックアップかどうかの判定）
        const lastBackupStr = localStorage.getItem('lastBackupTimestamp') || localStorage.getItem('lastDataUpdate') || '0';
        const lastKnownTime = parseInt(lastBackupStr, 10);

        if (lastKnownTime > 0 && backupData.timestamp < lastKnownTime) {
          const ok = await confirmAction('⚠️ 警告: 古いバックアップです', 'このデータは前回保存した時より古い可能性があります。\n現在の学習履歴が古い状態に戻ってしまいますが、本当に復元しますか？');
          if (!ok) return;
        } else {
          const ok = await confirmAction('バックアップの復元', '現在の学習履歴がバックアップの内容で上書きされます。\n実行してよろしいですか？');
          if (!ok) return;
        }

        await importBackup(jsonStr);
        
        // 復元した日時を記録
        localStorage.setItem('lastDataUpdate', Date.now().toString());
        
        msg.style.color = "var(--success-color)";
        msg.textContent = "データの復元が完了しました！";
      } catch (err) {
        msg.style.color = "var(--danger-color)";
        msg.textContent = "復元エラー: " + err.message;
      }
    };
    reader.readAsText(file);
  });

  // 4. データリセット
  document.getElementById('btn-reset-history').addEventListener('click', async () => {
    if(await confirmAction('学習履歴のリセット', '間違えた問題などの履歴のみを削除しますか？')) {
      await clearStore('progress'); await clearStore('attempts'); alert('履歴をリセットしました。');
    }
  });

  document.getElementById('btn-reset-all').addEventListener('click', async () => {
    if(await confirmAction('全データ完全リセット', '問題データと履歴を【すべて】削除しますか？')) {
      await clearStore('cards'); await clearStore('progress'); await clearStore('attempts'); alert('全リセットしました。');
    }
  });

  // テーマ切り替え
  const themeToggle = document.getElementById('theme-toggle');
  const currentTheme = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', currentTheme);
  themeToggle.checked = currentTheme === 'dark';
  themeToggle.addEventListener('change', (e) => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  });
});

// ==========================================
// ⌨️ キーボードショートカット
// ==========================================
document.addEventListener('keydown', (e) => {
  if (AppState.currentScreen !== 'session') return;
  if (document.getElementById('modal-exit').classList.contains('active')) return;

  const state = AppState.session.results[AppState.session.currentIndex];
  const isInputFocused = document.activeElement && document.activeElement.id === 'user-answer-input';

  if (e.key === 'Enter') {
    e.preventDefault(); 
    if (!state.judged) {
      document.getElementById('btn-ans').click();
    } else {
      document.getElementById('btn-next').click();
    }
    return;
  }

  if (isInputFocused) return;

  switch (e.key) {
    case '1': document.getElementById('btn-prev').click(); break;
    case '2': document.getElementById('btn-ans').click(); break;
    case '3': document.getElementById('btn-mark-correct').click(); break;
    case '4': document.getElementById('btn-next').click(); break;
    case '5': document.getElementById('btn-exit').click(); break;
  }
});

// ==========================================
// 📋 データ一覧画面
// ==========================================
let listAllCards =[];
async function renderListScreen() {
  listAllCards = await getAllFromStore('cards');
  const select = document.getElementById('list-category-filter');
  
  const categories = new Set();
  listAllCards.forEach(c => { 
    if (c.equipmentCategory) c.equipmentCategory.forEach(cat => categories.add(cat)); 
  });
  
  select.innerHTML = '<option value="all">すべて</option>';
  categories.forEach(cat => { select.innerHTML += `<option value="${cat}">${cat}</option>`; });
  if(!select.onchange) select.addEventListener('change', renderListTable);
  
  renderListTable();
  showScreen('list');
}

function renderListTable() {
  const filterCat = document.getElementById('list-category-filter').value;
  const tbody = document.querySelector('#data-list-table tbody');
  tbody.innerHTML = '';
  let count = 0;
  
  listAllCards.forEach(c => {
    if (filterCat !== 'all' && (!c.equipmentCategory || !c.equipmentCategory.includes(filterCat))) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.equipmentCategory?.join(', ') || ''}</td>
      <td>${c.targetMachine || ''}</td>
      <td>${c.systemNumber || ''}</td>
      <td><strong>${c.abbr || ''}</strong></td>
      <td>${c.fullSpell || ''}</td>
      <td><strong>${c.ja || ''}</strong></td>
      <td>${c.outline || ''}</td>
      <td>${c.overview || ''}</td>
    `;
    tbody.appendChild(tr); 
    count++;
  });
  document.getElementById('list-total-count').textContent = count;
}


// ==========================================
// 📊 学習分析・間違えた問題リスト
// ==========================================
async function renderAnalyticsScreen() {
  const cards = await getAllFromStore('cards');
  const progress = await getAllFromStore('progress');
  const progMap = new Map(progress.map(p =>[p.cardId, p]));

  let learnedCards = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  let statsMap = {}; 

  cards.forEach(c => {
    (c.equipmentCategory ||[]).forEach(eq => {
      const id = 'e_' + eq;
      if (!statsMap[id]) statsMap[id] = { name: eq, total: 0, learned: 0, correct: 0, wrong: 0 };
      statsMap[id].total++;
    });
  });

  cards.forEach(c => {
    const p = progMap.get(c.id);
    if (p && (p.correctCount > 0 || p.wrongCount > 0)) {
      learnedCards++;
      totalCorrect += (p.correctCount || 0);
      totalWrong += (p.wrongCount || 0);

      (c.equipmentCategory ||[]).forEach(eq => {
        statsMap['e_' + eq].learned++;
        statsMap['e_' + eq].correct += p.correctCount || 0;
        statsMap['e_' + eq].wrong += p.wrongCount || 0;
      });
    }
  });

  document.getElementById('stat-progress').textContent = `${learnedCards} / ${cards.length}`;
  const acc = (totalCorrect + totalWrong > 0) ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100) : 0;
  document.getElementById('stat-accuracy').textContent = `${acc}%`;

  const catTbody = document.querySelector('#analytics-cat-table tbody');
  catTbody.innerHTML = '';
  Object.values(statsMap).forEach(stat => {
    const statAcc = (stat.correct + stat.wrong > 0) ? Math.round((stat.correct / (stat.correct + stat.wrong)) * 100) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${stat.name}</td><td>${stat.total}</td><td>${stat.learned}</td>
                    <td style="color:${statAcc < 60 ? 'var(--danger-color)' : 'inherit'}; font-weight:bold;">${statAcc}%</td>`;
    catTbody.appendChild(tr);
  });

  const wrongTbody = document.querySelector('#analytics-wrong-table tbody');
  wrongTbody.innerHTML = '';
  const wrongCards = cards.filter(c => progMap.get(c.id) && progMap.get(c.id).wrongCount > 0);
  wrongCards.sort((a, b) => progMap.get(b.id).wrongCount - progMap.get(a.id).wrongCount);

  if (wrongCards.length === 0) {
    wrongTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">間違えた問題はありません！🎉</td></tr>';
  } else {
    wrongCards.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${c.abbr}</strong></td><td>${c.ja}</td>
                      <td style="color:var(--danger-color); font-weight:bold;">${progMap.get(c.id).wrongCount}回</td>
                      <td>${c.equipmentCategory?.join(', ') || '-'}</td><td>${c.targetMachine || '-'}</td>`;
      wrongTbody.appendChild(tr);
    });
  }
  showScreen('analytics');
}


// ==========================================
// 🔍 設定画面＆出題セット生成
// ==========================================
async function prepareConfigScreen() {
  const cards = await getAllFromStore('cards');
  const configForm = document.querySelector('.config-form');
  let spanSelect = document.getElementById('config-span');
  
  if (AppState.entryType === 'weak') {
    if (!spanSelect) {
      const label = document.createElement('label');
      label.id = 'label-config-span';
      label.innerHTML = `集計期間: <select id="config-span"><option value="30">直近30日</option><option value="7">直近7日</option><option value="90">直近90日</option><option value="all">全期間</option></select>`;
      configForm.insertBefore(label, document.getElementById('filter-equipments').previousElementSibling);
    }
  } else {
    if (spanSelect) document.getElementById('label-config-span').remove();
  }

  const eqSet = new Set();
  cards.forEach(c => {
    if (c.equipmentCategory) c.equipmentCategory.forEach(eq => eqSet.add(eq));
  });

  const eqContainer = document.getElementById('filter-equipments');
  eqContainer.innerHTML = '';
  eqSet.forEach(eq => {
    eqContainer.innerHTML += `<label class="checkbox-label"><input type="checkbox" value="${eq}" class="chk-eq"> ${eq}</label>`;
  });
}

async function generateCardsForSession() {
  const allCards = await getAllFromStore('cards');
  const allProgress = await getAllFromStore('progress');
  const allAttempts = await getAllFromStore('attempts');
  const progMap = new Map(allProgress.map(p =>[p.cardId, p]));
  let filtered =[];

  if (AppState.entryType === 'normal') {
    filtered = [...allCards].sort(() => Math.random() - 0.5);
  } else if (AppState.entryType === 'wrong') {
    filtered = allCards.filter(c => progMap.get(c.id)?.wrongCount > 0);
    filtered.sort((a, b) => (progMap.get(b.id)?.lastWrongAt || 0) - (progMap.get(a.id)?.lastWrongAt || 0));
  } else if (AppState.entryType === 'weak') {
    const spanVal = document.getElementById('config-span')?.value || '30';
    const cutoffDate = spanVal === 'all' ? 0 : Date.now() - (parseInt(spanVal) * 24 * 60 * 60 * 1000);
    const weakStats = new Map(allCards.map(c =>[c.id, { wrongN: 0, attemptN: 0, lastResult: null }]));
    
    allAttempts.forEach(att => {
      if (att.answeredAt >= cutoffDate && weakStats.has(att.cardId)) {
        const stat = weakStats.get(att.cardId);
        stat.attemptN++;
        if (att.result === 'wrong') stat.wrongN++;
        stat.lastResult = att.result;
      }
    });

    filtered = allCards.filter(c => weakStats.get(c.id).attemptN > 0);
    filtered.forEach(c => {
      const s = weakStats.get(c.id);
      const acc = s.attemptN > 0 ? (s.attemptN - s.wrongN) / s.attemptN : 0;
      c._weakScore = (s.wrongN * 2) + (s.lastResult === 'wrong' ? 3 : 0) + (acc < 0.6 ? 2 : 0);
    });
    filtered.sort((a, b) => b._weakScore - a._weakScore);
  } else if (AppState.entryType === 'stale') {
    filtered = allCards.filter(c => progMap.get(c.id)?.correctCount > 0);
    filtered.sort((a, b) => (progMap.get(a.id)?.lastAnsweredAt || 0) - (progMap.get(b.id)?.lastAnsweredAt || 0));
  }

  const checkedEqs = Array.from(document.querySelectorAll('.chk-eq:checked')).map(cb => cb.value);
  if (checkedEqs.length > 0) {
    filtered = filtered.filter(c => {
      return c.equipmentCategory && c.equipmentCategory.some(eq => checkedEqs.includes(eq));
    });
  }

  const countSelect = document.getElementById('config-count').value;
  return countSelect === 'all' ? filtered : filtered.slice(0, parseInt(countSelect));
}

// ==========================================
// セッション制御
// ==========================================
async function startSession() {
  const mode = document.getElementById('config-mode').value;
  AppState.session.mode = mode;
  const cards = await generateCardsForSession();
  
  if (cards.length === 0) return alert("条件・絞り込みに一致する問題がありません！");

  AppState.session.cards = cards;
  AppState.session.currentIndex = 0;
  AppState.session.results = cards.map(c => ({
    cardId: c.id, judged: false, isCorrect: false, userInput: '', attemptId: null,
    testType: mode === 'test' ? (Math.random() > 0.5 ? 'rev1' : 'rev2') : mode
  }));

  if (mode === 'test') {
    AppState.session.timeRemaining = cards.length * 10;
    document.getElementById('session-timer').style.display = 'inline';
    AppState.session.timerInterval = setInterval(() => {
      AppState.session.timeRemaining--;
      const tr = AppState.session.timeRemaining;
      document.getElementById('session-timer').textContent = `⏳ ${String(Math.floor(tr/60)).padStart(2,'0')}:${String(tr%60).padStart(2,'0')}`;
      if (tr <= 0) { clearInterval(AppState.session.timerInterval); alert("時間切れ！"); endSession(); }
    }, 1000);
  } else {
    document.getElementById('session-timer').style.display = 'none';
  }

  showScreen('session');
  renderCard();
}

function renderCard() {
  const s = AppState.session;
  const card = s.cards[s.currentIndex];
  const state = s.results[s.currentIndex];
  const activeMode = s.mode === 'test' ? state.testType : s.mode;

  document.getElementById('session-progress').textContent = `${s.currentIndex + 1} / ${s.cards.length}`;
  document.getElementById('badge-equipment').textContent = card.equipmentCategory?.join(', ') || '分類なし';
  
  const sysBadge = document.getElementById('badge-system');
  if(card.systemNumber) {
    sysBadge.style.display = 'inline-block';
    sysBadge.textContent = '系統: ' + card.systemNumber;
  } else {
    sysBadge.style.display = 'none';
  }

  const qEl = document.getElementById('card-question');
  const inputSec = document.getElementById('card-input-section');
  const inputEl = document.getElementById('user-answer-input');
  const judgeEl = document.getElementById('judgment-result');
  const detailsEl = document.getElementById('card-details');
  
  detailsEl.style.display = 'none';
  judgeEl.textContent = '';
  qEl.textContent = (activeMode === 'normal' || activeMode === 'rev1') ? card.abbr : card.ja;

  document.getElementById('btn-prev').disabled = (s.currentIndex === 0);
  document.getElementById('btn-ans').disabled = state.judged;

  if (s.currentIndex === s.cards.length - 1) {
    document.getElementById('btn-next').innerHTML = `<span>結果を見る ▶</span><span class="shortcut-key">[4 / Enter]</span>`;
  } else {
    document.getElementById('btn-next').innerHTML = `<span>次へ ▶</span><span class="shortcut-key">[4 / Enter]</span>`;
  }

  if (activeMode === 'rev1' || activeMode === 'rev2') {
    inputSec.style.display = 'block';
    inputEl.value = state.userInput;
    inputEl.disabled = state.judged;
    
    if (state.judged) {
      judgeEl.textContent = state.isCorrect ? "⭕ 正解！" : "❌ 不正解...";
      judgeEl.style.color = state.isCorrect ? "var(--success-color)" : "var(--danger-color)";
      showDetails(card, activeMode);
    } else {
      setTimeout(()=> inputEl.focus(), 50);
    }
  } else {
    inputSec.style.display = 'none';
    if (state.judged) showDetails(card, activeMode);
  }
}

// ==========================================
// 解答・判定ロジック
// ==========================================
async function handleAnswer() {
  const s = AppState.session;
  const card = s.cards[s.currentIndex];
  const state = s.results[s.currentIndex];
  const activeMode = s.mode === 'test' ? state.testType : s.mode;

  if (state.judged) return;

  if (activeMode === 'rev1' || activeMode === 'rev2') {
    const inputVal = document.getElementById('user-answer-input').value;
    const correctAns = activeMode === 'rev1' ? card.ja : card.abbr;
    state.userInput = inputVal;
    state.isCorrect = (normalizeString(inputVal) === normalizeString(correctAns));
  } else {
    state.isCorrect = false; 
  }

  state.judged = true;
  state.attemptId = await saveAttempt(card.id, activeMode, state.isCorrect ? 'correct' : 'wrong');
  renderCard();
}

async function handleMarkCorrect() {
  const s = AppState.session;
  const state = s.results[s.currentIndex];
  const card = s.cards[s.currentIndex];
  const activeMode = s.mode === 'test' ? state.testType : s.mode;

  if (!state.judged) {
    state.isCorrect = true;
    state.judged = true;
    if (activeMode === 'rev1') state.userInput = card.ja;
    if (activeMode === 'rev2') state.userInput = card.abbr;
    state.attemptId = await saveAttempt(card.id, activeMode, 'correct');
    renderCard();
  } else {
    if (!state.isCorrect) {
      state.isCorrect = true;
      await overwriteToCorrect(card.id, state.attemptId);
      renderCard();
    }
  }
}

function showDetails(card, activeMode) {
  document.getElementById('card-details').style.display = 'block';
  document.getElementById('card-answer').textContent = (activeMode === 'normal' || activeMode === 'rev1') ? card.ja : card.abbr;
  document.getElementById('card-fullspell').textContent = card.fullSpell || '-';
  document.getElementById('card-outline').textContent = card.outline || '-'; 
  document.getElementById('card-overview').textContent = card.overview || '-'; 
}

function navigateCard(direction) {
  const s = AppState.session;
  if (direction === 1 && s.currentIndex === s.cards.length - 1) {
    document.getElementById('modal-exit').classList.add('active');
    return;
  }
  s.currentIndex = Math.max(0, s.currentIndex + direction);
  renderCard();
}

function saveAttempt(cardId, mode, resultStr) {
  return new Promise((resolve) => {
    const now = Date.now();
    let attemptId = null;
    const txAtt = db.transaction('attempts', 'readwrite');
    const reqAdd = txAtt.objectStore('attempts').add({ cardId, mode, result: resultStr, answeredAt: now });
    reqAdd.onsuccess = (e) => attemptId = e.target.result;

    const txProg = db.transaction('progress', 'readwrite');
    const store = txProg.objectStore('progress');
    const reqP = store.get(cardId);
    reqP.onsuccess = () => {
      let p = reqP.result || { cardId, correctCount: 0, wrongCount: 0 };
      p.lastAnsweredAt = now;
      if (resultStr === 'correct') {
        p.correctCount++; p.lastCorrectAt = now; p.streak = (p.streak || 0) + 1;
      } else {
        p.wrongCount++; p.lastWrongAt = now; p.streak = 0;
      }
      store.put(p);
    };
    txProg.oncomplete = () => resolve(attemptId);
  });
}

function overwriteToCorrect(cardId, attemptId) {
  return new Promise((resolve) => {
    const now = Date.now();
    if (attemptId) {
      const txAtt = db.transaction('attempts', 'readwrite');
      const storeAtt = txAtt.objectStore('attempts');
      const req = storeAtt.get(attemptId);
      req.onsuccess = () => { if (req.result) { req.result.result = 'correct'; storeAtt.put(req.result); } };
    }

    const txProg = db.transaction('progress', 'readwrite');
    const storeProg = txProg.objectStore('progress');
    const reqP = storeProg.get(cardId);
    reqP.onsuccess = () => {
      let p = reqP.result;
      if (p && p.wrongCount > 0) {
        p.wrongCount--; p.correctCount++;
        p.lastCorrectAt = now; p.streak = (p.streak || 0) + 1;
        storeProg.put(p);
      }
    };
    txProg.oncomplete = () => resolve();
  });
}

function endSession() {
  const s = AppState.session;
  if (s.timerInterval) clearInterval(s.timerInterval);
  const judgedCards = s.results.filter(r => r.judged);
  const correctCount = judgedCards.filter(r => r.isCorrect).length;
  const total = judgedCards.length;
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  document.getElementById('res-correct').textContent = correctCount;
  document.getElementById('res-total').textContent = total;
  document.getElementById('res-accuracy').textContent = accuracy;
  document.getElementById('btn-review-wrong').style.display = (total - correctCount > 0) ? 'flex' : 'none';

  showScreen('result');
}