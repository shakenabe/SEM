// ==========================================
// 状態管理・グローバル変数
// ==========================================
let currentCsvText = ''; 
const AppState = {
  currentScreen: 'home',
  entryType: 'normal',
  session: {
    cards:[], currentIndex: 0, mode: 'normal', cardStartTime: 0, 
    results:[]
  },
  lastSession: null 
};

// ==========================================
// ユーティリティ・DOM生成ヘルパー (XSS対策用)
// ==========================================
function clearEl(el) { el.textContent = ''; }

function createEl(tag, attrs = {}, children =[]) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') el.className = val;
    else if (key === 'textContent') el.textContent = val;
    else if (key === 'dataset') {
      for (const[dKey, dVal] of Object.entries(val)) el.dataset[dKey] = dVal;
    } else el.setAttribute(key, val);
  }
  children.forEach(child => {
    if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    else el.appendChild(child);
  });
  return el;
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
  if (screenId === 'home') updateHomeSummary();
}

function confirmAction(title, message) {
  return new Promise((resolve) => {
    document.getElementById('confirm-title').textContent = title;
    const msgEl = document.getElementById('confirm-message');
    clearEl(msgEl);
    message.split('\n').forEach(line => {
      msgEl.appendChild(document.createTextNode(line));
      msgEl.appendChild(document.createElement('br'));
    });
    
    const modal = document.getElementById('modal-confirm');
    modal.classList.add('active');

    const btnYes = document.getElementById('btn-confirm-yes');
    const btnNo = document.getElementById('btn-confirm-no');

    const handleYes = () => { cleanup(); resolve(true); };
    const handleNo = () => { cleanup(); resolve(false); };

    const handleKeydown = (e) => {
      if (e.key === 'Enter' || e.key.toLowerCase() === 'y') {
        e.preventDefault(); e.stopPropagation(); handleYes();
      } else if (e.key === 'Escape' || e.key.toLowerCase() === 'n') {
        e.preventDefault(); e.stopPropagation(); handleNo();
      }
    };

    function cleanup() {
      modal.classList.remove('active');
      btnYes.removeEventListener('click', handleYes);
      btnNo.removeEventListener('click', handleNo);
      document.removeEventListener('keydown', handleKeydown, true);
    }
    
    btnYes.addEventListener('click', handleYes);
    btnNo.addEventListener('click', handleNo);
    document.addEventListener('keydown', handleKeydown, true);
  });
}

// ==========================================
// ホーム画面サマリー更新
// ==========================================
async function updateHomeSummary() {
  const cards = await getAllFromStore('cards');
  const summaryEl = document.getElementById('home-data-summary');
  const menuBtns = document.querySelectorAll('.main-menu-btn');
  
  clearEl(summaryEl);

  if (cards.length === 0) {
    summaryEl.style.display = 'none';
    menuBtns.forEach(btn => btn.disabled = true);
    document.getElementById('btn-go-analytics').disabled = true;
    document.getElementById('btn-go-list').disabled = true;
    return;
  }
  
  summaryEl.style.display = 'block';
  menuBtns.forEach(btn => btn.disabled = false);
  document.getElementById('btn-go-analytics').disabled = false;
  document.getElementById('btn-go-list').disabled = false;
  
  const titleDiv = createEl('div', { className: 'home-summary-title', textContent: `登録済みの問題: ${cards.length} 問` });
  summaryEl.appendChild(titleDiv);

  const eqMap = {};
  cards.forEach(c => {
    const eqs = (c.equipmentCategory && c.equipmentCategory.length > 0) ? c.equipmentCategory : ['分類なし'];
    eqs.forEach(eq => { eqMap[eq] = (eqMap[eq] || 0) + 1; });
  });

  const tagsDiv = createEl('div', { className: 'home-summary-tags' });
  Object.keys(eqMap).sort().forEach(eq => {
    tagsDiv.appendChild(createEl('span', { className: 'home-summary-tag', textContent: `${eq}: ${eqMap[eq]}件` }));
  });
  summaryEl.appendChild(tagsDiv);
}

// ==========================================
// 初期化・共通イベントリスナー
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  if (window.dbInitPromise) await window.dbInitPromise;
  await updateHomeSummary();

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

  document.getElementById('btn-start-session').addEventListener('click', startSession);
  document.getElementById('btn-prev').addEventListener('click', () => navigateCard(-1));
  document.getElementById('btn-next').addEventListener('click', () => navigateCard(1));
  document.getElementById('btn-ans').addEventListener('click', () => handleAnswer('ans'));
  
  document.getElementById('btn-exit').addEventListener('click', () => document.getElementById('modal-exit').classList.add('active'));
  document.getElementById('btn-modal-no').addEventListener('click', () => document.getElementById('modal-exit').classList.remove('active'));
  document.getElementById('btn-modal-yes').addEventListener('click', () => {
    document.getElementById('modal-exit').classList.remove('active');
    endSession();
  });

  document.getElementById('btn-retry-session').addEventListener('click', retrySession);

  // 自己評価フラグ (トグル操作)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-flag-btn');
    if (!btn) return;
    let cardId = btn.dataset.id;
    if (!cardId) {
      if (AppState.currentScreen === 'session') cardId = AppState.session.cards[AppState.session.currentIndex].id;
      else return;
    }
    const flagType = btn.dataset.flag;
    const tx = db.transaction('progress', 'readwrite');
    const store = tx.objectStore('progress');
    const req = store.get(cardId);
    req.onsuccess = () => {
      let p = req.result || { cardId, correctCount: 0, wrongCount: 0 };
      if (!p.flags) p.flags = {};
      p.flags[flagType] = !p.flags[flagType]; 
      store.put(p);
      if (p.flags[flagType]) btn.classList.add('active');
      else btn.classList.remove('active');
    };
  });

  document.addEventListener('click', (e) => {
    const header = e.target.closest('.folder-header');
    if (header) {
      header.classList.toggle('closed');
      const content = header.nextElementSibling;
      if (content && content.classList.contains('folder-content')) {
        content.classList.toggle('closed');
      }
    }
  });

  document.querySelectorAll('input[name="extract-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const isRandom = e.target.value === 'random';
      document.getElementById('config-opt-random').style.display = isRandom ? 'block' : 'none';
      document.getElementById('config-opt-range').style.display = isRandom ? 'none' : 'block';
      document.getElementById('config-set-preview').style.display = 'none';
    });
  });

  document.querySelector('.config-form').addEventListener('change', (e) => {
    const targetId = e.target.id;
    if (e.target.classList.contains('chk-flag') || e.target.classList.contains('chk-eq') || 
        targetId === 'config-weak-filter' || targetId === 'config-chunk-size') {
      updateConfigPreview();
    }
  });

  document.getElementById('btn-toggle-preview').addEventListener('click', async () => {
    const previewDiv = document.getElementById('config-set-preview');
    if (previewDiv.style.display === 'block') { previewDiv.style.display = 'none'; return; }
    
    let cards = await getFilteredCards();
    const chunkSize = parseInt(document.getElementById('config-chunk-size').value);
    const chunkIndex = parseInt(document.getElementById('config-chunk-select').value);
    
    if (!isNaN(chunkIndex) && chunkSize > 0) {
      const start = chunkIndex * chunkSize;
      const end = start + chunkSize;
      cards = cards.slice(start, end);
    } else { cards =[]; }

    const order = document.getElementById('config-chunk-order').value;
    if (order === 'reverse') cards.reverse();
    if (order === 'random') cards = [...cards].sort(() => Math.random() - 0.5);

    clearEl(previewDiv);
    if (cards.length === 0) {
      previewDiv.appendChild(createEl('div', { style: 'text-align:center; padding:10px;', textContent: '問題がありません' }));
    } else {
      cards.forEach((c, i) => {
        const item = createEl('div', { className: 'set-preview-item' });
        item.appendChild(createEl('strong', { textContent: `${i + 1}. ${c.abbr} ` }));
        item.appendChild(createEl('span', { style: 'font-size:0.85rem; color:var(--primary-color);', textContent: `(${c.ja})` }));
        previewDiv.appendChild(item);
      });
    }
    previewDiv.style.display = 'block';
  });

  // CSV読み込み関連
  const triggerImportBtn = document.getElementById('btn-trigger-mapping');
  const fileInput = document.getElementById('csv-upload');
  const msgEl = document.getElementById('import-msg');

  if(triggerImportBtn && fileInput) {
    triggerImportBtn.addEventListener('click', () => {
      const file = fileInput.files[0];
      if (!file) { msgEl.style.color = "var(--danger-color)"; msgEl.textContent = "ファイルを選択してください。"; return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        currentCsvText = e.target.result;
        const firstLine = currentCsvText.split('\n')[0];
        if(!firstLine) return alert("データがありません。");
        const headers = firstLine.split(',').map(s => s.replace(/"/g, '').trim());
        openMappingModal(headers);
      };
      reader.readAsText(file);
      fileInput.value = ''; 
    });
  }

  function openMappingModal(headers) {
    const container = document.getElementById('csv-mapping-container');
    clearEl(container);
    
    const appFields =[
      { key: 'equipmentCategory', label: '設備分類', keywords:['設備', '分類', 'カテゴリ'] },
      { key: 'targetMachine', label: '対象号機', keywords:['号機', '対象', '機器'] },
      { key: 'systemNumber', label: '系統番号', keywords:['系統', '番号', 'システム'] },
      { key: 'abbr', label: '略語', req: true, keywords:['略語', '略称', '英語', '問題'] },
      { key: 'fullSpell', label: 'フルスペル', keywords:['フル', 'スペル', '古', 'full'] },
      { key: 'ja', label: '日本語', req: true, keywords:['日本', '和名', '意味', '解答', '答え'] },
      { key: 'outline', label: '概略', keywords: ['概略'] },
      { key: 'overview', label: '概要', keywords:['概要', '役割', '詳細', '解説'] }
    ];
    
    appFields.forEach(field => {
      const row = createEl('div', { className: 'mapping-row' });
      const label = createEl('div', { className: 'mapping-label', textContent: field.label });
      if(field.req) {
        const star = createEl('span', { style: 'color:var(--danger-color);', textContent: ' *' });
        label.appendChild(star);
      }
      
      const select = createEl('select', { className: 'mapping-select', dataset: { key: field.key } });
      select.appendChild(createEl('option', { value: '-1', textContent: '（使用しない）' }));
      
      let bestMatchIdx = -1;
      headers.forEach((h, idx) => {
        select.appendChild(createEl('option', { value: idx, textContent: `[列${idx + 1}] ${h}` }));
        if(bestMatchIdx === -1) {
          if (h.includes(field.label)) bestMatchIdx = idx;
          else if (field.keywords && field.keywords.some(kw => h.includes(kw))) bestMatchIdx = idx;
        }
      });
      if(bestMatchIdx !== -1) select.value = bestMatchIdx;
      
      row.appendChild(label); row.appendChild(select); container.appendChild(row);
    });
    document.getElementById('modal-csv-mapping').classList.add('active');
  }

  document.getElementById('btn-cancel-import').addEventListener('click', () => {
    document.getElementById('modal-csv-mapping').classList.remove('active');
    currentCsvText = '';
  });

  document.getElementById('btn-execute-import').addEventListener('click', async () => {
    const selects = document.querySelectorAll('.mapping-select');
    const mapping = {};
    let abbrMapped = false, jaMapped = false;
    selects.forEach(sel => {
      const key = sel.dataset.key; const val = parseInt(sel.value, 10);
      mapping[key] = val;
      if(key === 'abbr' && val !== -1) abbrMapped = true;
      if(key === 'ja' && val !== -1) jaMapped = true;
    });
    if(!abbrMapped || !jaMapped) { alert("「略語」と「日本語」の列は必須です。"); return; }
    
    document.getElementById('modal-csv-mapping').classList.remove('active');
    
    try {
      const result = await window.importCSV(currentCsvText, mapping);
      const msgText = `✅ 成功！ 更新・追加: ${result.updated}件 / 古い問題の削除: ${result.deleted}件`;
      if(msgEl) { msgEl.style.color = "var(--success-color)"; msgEl.textContent = msgText; }
      
      localStorage.setItem('lastDataUpdate', Date.now().toString());
      await updateHomeSummary();
    } catch (err) {
      alert("読み込みエラー: " + err.message);
    }
    currentCsvText = '';
  });

  // バックアップ・リセット・テーマ
  document.getElementById('btn-export-backup').addEventListener('click', async () => {
    try {
      const includeCards = document.getElementById('backup-include-cards').checked;
      const jsonStr = await window.exportBackup(includeCards);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      const d = new Date();
      a.download = `flashcard_backup_${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}_${d.getHours().toString().padStart(2,'0')}${d.getMinutes().toString().padStart(2,'0')}.json`;
      a.click(); URL.revokeObjectURL(url);
      localStorage.setItem('lastBackupTimestamp', Date.now().toString());
      alert('バックアップをダウンロードしました。');
    } catch (err) { alert('バックアップ失敗: ' + err.message); }
  });

  document.getElementById('btn-import-backup').addEventListener('click', async () => {
    const fileIn = document.getElementById('backup-upload');
    const msg = document.getElementById('backup-msg');
    const file = fileIn.files[0];
    if (!file) { msg.style.color = "var(--danger-color)"; msg.textContent = "JSONを選択してください。"; return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const jsonStr = e.target.result;
        if (!await confirmAction('バックアップの復元', '現在のデータがすべて上書きされます。\n実行してよろしいですか？')) return;
        
        await window.importBackup(jsonStr);
        localStorage.setItem('lastDataUpdate', Date.now().toString());
        msg.style.color = "var(--success-color)"; msg.textContent = "復元が完了しました！";
        await updateHomeSummary();
      } catch (err) { msg.style.color = "var(--danger-color)"; msg.textContent = "復元エラー: " + err.message; }
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-reset-history').addEventListener('click', async () => {
    if(await confirmAction('学習履歴のリセット', '評価や正解・不正解の履歴のみを削除しますか？')) {
      await window.clearStore('progress'); await window.clearStore('attempts'); alert('履歴をリセットしました。');
    }
  });

  document.getElementById('btn-reset-all').addEventListener('click', async () => {
    if(await confirmAction('全データ完全リセット', '問題データと学習履歴を【すべて】削除しますか？')) {
      await window.clearStore('cards');
      await window.clearStore('progress'); 
      await window.clearStore('attempts'); 
      await updateHomeSummary(); alert('全リセットしました。');
    }
  });

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
  const exitModal = document.getElementById('modal-exit');
  if (exitModal.classList.contains('active')) {
    if (e.key === 'Enter' || e.key.toLowerCase() === 'y') {
      e.preventDefault(); e.stopPropagation(); document.getElementById('btn-modal-yes').click();
    } else if (e.key === 'Escape' || e.key.toLowerCase() === 'n') {
      e.preventDefault(); e.stopPropagation(); document.getElementById('btn-modal-no').click();
    }
    return;
  }

  if (AppState.currentScreen === 'result') {
    if (e.key === 'Enter' || e.key.toLowerCase() === 'r') {
      e.preventDefault(); document.getElementById('btn-retry-session').click();
    } else if (e.key.toLowerCase() === 'h') {
      e.preventDefault(); showScreen('home');
    }
    return;
  }

  if (AppState.currentScreen !== 'session') return;

  const state = AppState.session.results[AppState.session.currentIndex];

  if (e.key === 'Enter') {
    e.preventDefault(); 
    if (!state.judged) document.getElementById('btn-ans').click();
    else document.getElementById('btn-next').click();
    return;
  }
  
  if (e.key === ' ') { // Spacebar for 'X'
      e.preventDefault();
      if (!state.judged) handleAnswer('space');
      return;
  }

  switch (e.key) {
    case '1': document.getElementById('btn-prev').click(); break;
    case '2': document.getElementById('btn-ans').click(); break;
    case '4': document.getElementById('btn-next').click(); break;
    case '5': document.getElementById('btn-exit').click(); break;
  }
});

// ==========================================
// 📋 データ一覧画面
// ==========================================
async function renderListScreen() {
  const cards = await getAllFromStore('cards');
  const select = document.getElementById('list-category-filter');
  const categories = new Set();
  cards.forEach(c => { 
    if (c.equipmentCategory) c.equipmentCategory.forEach(cat => categories.add(cat)); 
  });
  
  clearEl(select);
  select.appendChild(createEl('option', { value: 'all', textContent: 'すべて' }));
  Array.from(categories).sort().forEach(cat => { select.appendChild(createEl('option', { value: cat, textContent: cat })); });
  if(!select.onchange) select.addEventListener('change', renderListTable);
  
  await renderListTable();
  showScreen('list');
}

async function renderListTable() {
  const cards = await getAllFromStore('cards');
  const filterCat = document.getElementById('list-category-filter').value;
  const container = document.getElementById('data-list-container');
  clearEl(container);
  
  const progressList = await getAllFromStore('progress');
  const progMap = new Map(progressList.map(p =>[p.cardId, p]));
  let count = 0;
  
  const grouped = {};
  cards.forEach(c => {
    if (filterCat !== 'all' && (!c.equipmentCategory || !c.equipmentCategory.includes(filterCat))) return;
    count++;
    const eqs = (c.equipmentCategory && c.equipmentCategory.length > 0) ? c.equipmentCategory : ['分類なし'];
    eqs.forEach(eq => {
      if (filterCat !== 'all' && eq !== filterCat) return; 
      if(!grouped[eq]) grouped[eq] = [];
      grouped[eq].push(c);
    });
  });
  
  document.getElementById('list-total-count').textContent = count;

  if (Object.keys(grouped).length === 0) {
    container.appendChild(createEl('p', { style: 'text-align:center; padding:20px;', textContent: 'データがありません' }));
    return;
  }

  Object.keys(grouped).sort().forEach(eq => {
    const gCards = grouped[eq];
    const wrapper = createEl('div', { style: 'margin-bottom: 15px;' });
    
    const header = createEl('div', { className: 'folder-header closed' });
    header.appendChild(document.createTextNode(`📁 ${eq} `));
    header.appendChild(createEl('span', { style: 'font-size:0.9rem; font-weight:normal;', textContent: `(${gCards.length}件)` }));
    
    const content = createEl('div', { className: 'folder-content table-responsive closed', style: 'margin-bottom: 0;' });
    
    const table = document.createElement('table');
    const thead = createEl('thead');
    const trH = createEl('tr');['マーク', '対象号機', '系統', '略語', 'フルスペル', '日本語', '概略', '概要'].forEach((t, i) => {
      trH.appendChild(createEl('th', { style: i === 0 ? 'min-width: 90px;' : '', textContent: t }));
    });
    thead.appendChild(trH);
    table.appendChild(thead);
    
    const tbody = createEl('tbody');
    gCards.forEach(c => {
      const p = progMap.get(c.id);
      const uAct = p?.flags?.uneasy ? 'active' : '';
      const mAct = p?.flags?.mistake ? 'active' : '';
      
      const tr = createEl('tr');
      const tdBtns = createEl('td', { style: 'white-space: nowrap;' },[
        createEl('button', { className: `flag-btn toggle-flag-btn ${uAct}`, dataset: { id: c.id, flag: 'uneasy' }, title: '不安', textContent: '😰' }),
        document.createTextNode(' '),
        createEl('button', { className: `flag-btn toggle-flag-btn ${mAct}`, dataset: { id: c.id, flag: 'mistake' }, title: 'ミス注意', textContent: '⚠️' })
      ]);
      tr.appendChild(tdBtns);
      tr.appendChild(createEl('td', { textContent: c.targetMachine || '' }));
      tr.appendChild(createEl('td', { textContent: c.systemNumber || '' }));
      tr.appendChild(createEl('td', {},[createEl('strong', { textContent: c.abbr || '' })]));
      tr.appendChild(createEl('td', { textContent: c.fullSpell || '' }));
      tr.appendChild(createEl('td', {},[createEl('strong', { textContent: c.ja || '' })]));
      tr.appendChild(createEl('td', { textContent: c.outline || '' }));
      tr.appendChild(createEl('td', { textContent: c.overview || '' }));
      tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    content.appendChild(table);
    wrapper.appendChild(header);
    wrapper.appendChild(content);
    container.appendChild(wrapper);
  });
}

// ==========================================
// 📊 学習分析・履歴画面
// ==========================================
async function renderAnalyticsScreen() {
  const container = document.getElementById('analytics-history-container');
  clearEl(container);

  const attempts = await getAllFromStore('attempts');
  const cards = await getAllFromStore('cards');
  const cardMap = new Map(cards.map(c => [c.id, c]));

  if (attempts.length === 0) {
    container.appendChild(createEl('p', { style: 'text-align:center; padding: 20px; background:var(--card-bg); border-radius:8px;', textContent: 'まだ学習履歴はありません。' }));
    showScreen('analytics');
    return;
  }

  attempts.sort((a, b) => b.answeredAt - a.answeredAt); // 新しい順にソート

  attempts.forEach(att => {
    const card = cardMap.get(att.cardId);
    if (!card) return;

    let iconText = '';
    if (att.rating === 'excellent') iconText = '◎';
    else if (att.rating === 'good') iconText = '〇';
    else if (att.rating === 'poor') iconText = '✕';
    else iconText = att.result === 'correct' ? '✔️' : '❌'; // 旧データ用

    const item = createEl('div', { className: 'history-item' }, [
      createEl('div', { className: 'history-icon', textContent: iconText }),
      createEl('div', { className: 'history-details' }, [
        createEl('div', { className: 'history-card-info' }, [
          createEl('strong', { textContent: `${card.abbr} ` }),
          createEl('span', { textContent: `(${card.ja})` })
        ]),
        createEl('div', { className: 'history-meta', textContent: new Date(att.answeredAt).toLocaleString() })
      ])
    ]);
    container.appendChild(item);
  });

  showScreen('analytics');
}


// ==========================================
// 🔍 設定画面＆プレビュー・出題セット生成
// ==========================================
async function getFilteredCards() {
  const allCards = await getAllFromStore('cards'); 
  const allProgress = await getAllFromStore('progress');
  const progMap = new Map(allProgress.map(p =>[p.cardId, p]));
  let filtered =[];

  if (AppState.entryType === 'normal') {
    filtered = [...allCards]; 
  } else if (AppState.entryType === 'weak_list') {
    const filterType = document.getElementById('config-weak-filter').value;
    const allAttempts = await getAllFromStore('attempts');
    const targetCardIds = new Set();
    
    // ratingに基づいてフィルタリング
    allAttempts.forEach(att => {
        if (filterType === 'x_only' && att.rating === 'poor') targetCardIds.add(att.cardId);
        else if (filterType === 'o_only' && att.rating === 'good') targetCardIds.add(att.cardId);
        else if (filterType === 'ox' && (att.rating === 'poor' || att.rating === 'good')) targetCardIds.add(att.cardId);
    });

    // 最新の履歴が対象になるようにソート
    const attemptMap = new Map();
    allAttempts.forEach(att => {
        if (targetCardIds.has(att.cardId)) {
            if (!attemptMap.has(att.cardId) || attemptMap.get(att.cardId).answeredAt < att.answeredAt) {
                attemptMap.set(att.cardId, att);
            }
        }
    });

    const sortedAttempts = Array.from(attemptMap.values()).sort((a,b) => b.answeredAt - a.answeredAt);
    const sortedCardIds = sortedAttempts.map(att => att.cardId);

    const cardMap = new Map(allCards.map(c => [c.id, c]));
    filtered = sortedCardIds.map(id => cardMap.get(id)).filter(Boolean); // 存在しないカードを除外
  }
  
  const checkedFlags = Array.from(document.querySelectorAll('.chk-flag:checked')).map(cb => cb.value);
  if (checkedFlags.length > 0) {
    filtered = filtered.filter(c => {
      const p = progMap.get(c.id);
      if (!p || !p.flags) return false;
      return checkedFlags.some(flag => p.flags[flag]); 
    });
  }

  const checkedEqs = Array.from(document.querySelectorAll('.chk-eq:checked')).map(cb => cb.value);
  if (checkedEqs.length > 0) {
    filtered = filtered.filter(c => {
      return c.equipmentCategory && c.equipmentCategory.some(eq => checkedEqs.includes(eq));
    });
  }

  return filtered;
}

async function updateConfigPreview() {
  const filtered = await getFilteredCards();
  const countDisplay = document.getElementById('config-target-count-display');
  countDisplay.textContent = `現在の対象問題数: ${filtered.length} 問`;

  const chunkSize = parseInt(document.getElementById('config-chunk-size').value) || 20;
  const chunkSelect = document.getElementById('config-chunk-select');
  clearEl(chunkSelect);
  document.getElementById('config-set-preview').style.display = 'none';
  
  if (filtered.length === 0 || chunkSize <= 0) {
    chunkSelect.appendChild(createEl('option', { value: '', textContent: 'データがありません' }));
    return;
  }

  const numChunks = Math.ceil(filtered.length / chunkSize);
  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize + 1;
    const end = Math.min((i + 1) * chunkSize, filtered.length);
    chunkSelect.appendChild(createEl('option', { value: i, textContent: `第${i + 1}セット (${start}〜${end}問)` }));
  }
}

async function prepareConfigScreen() {
  const cards = await getAllFromStore('cards');
  
  const weakOpt = document.getElementById('config-opt-weak-list');
  const flagFilter = document.getElementById('filter-flags').parentElement;
  
  if (AppState.entryType === 'weak_list') {
      weakOpt.style.display = 'block';
  } else {
      weakOpt.style.display = 'none';
  }

  const eqContainer = document.getElementById('filter-equipments');
  if (eqContainer.innerHTML === '') {
    const eqSet = new Set();
    cards.forEach(c => {
      if (c.equipmentCategory) c.equipmentCategory.forEach(eq => eqSet.add(eq));
    });
    Array.from(eqSet).sort().forEach(eq => {
      const lbl = createEl('label', { className: 'checkbox-label' },[
        createEl('input', { type: 'checkbox', value: eq, className: 'chk-eq' }),
        document.createTextNode(` ${eq}`)
      ]);
      eqContainer.appendChild(lbl);
    });
  }
  // チェックをリセット
  document.querySelectorAll('.chk-flag, .chk-eq').forEach(chk => chk.checked = false);
  await updateConfigPreview();
}

// ==========================================
// セッション制御
// ==========================================
async function startSession() {
  const mode = document.getElementById('config-mode').value;
  let cards = await getFilteredCards();
  const extractType = document.querySelector('input[name="extract-type"]:checked').value;

  // 常にシャッフルオプションを尊重する
  const order = document.getElementById('config-chunk-order').value;
  if (extractType === 'random' || order === 'random') {
    cards.sort(() => Math.random() - 0.5);
  }

  if (extractType === 'random') {
    const countSelect = document.getElementById('config-count').value;
    if (countSelect !== 'all') cards = cards.slice(0, parseInt(countSelect));
  } else { // range
    const chunkSize = parseInt(document.getElementById('config-chunk-size').value);
    const chunkIndex = parseInt(document.getElementById('config-chunk-select').value);
    if (!isNaN(chunkIndex) && chunkSize > 0) {
      const start = chunkIndex * chunkSize;
      const end = start + chunkSize;
      cards = cards.slice(start, end);
    } else {
      cards =[];
    }
    if (order === 'reverse') cards.reverse();
  }
  
  if (cards.length === 0) return alert("条件・絞り込みに一致する問題がありません！");

  AppState.lastSession = { 
      cards: [...cards], 
      mode, 
      entryType: AppState.entryType,
      // フォームの状態を保存
      formState: {
          extractType: document.querySelector('input[name="extract-type"]:checked').value,
          randomCount: document.getElementById('config-count').value,
          chunkSize: document.getElementById('config-chunk-size').value,
          chunkIndex: document.getElementById('config-chunk-select').value,
          chunkOrder: document.getElementById('config-chunk-order').value,
      }
  };
  initAndRunSession(cards, mode);
}

async function retrySession() {
  if (!AppState.lastSession) return;
  
  let cards = [...AppState.lastSession.cards];
  const lastState = AppState.lastSession.formState;

  // 再シャッフル処理
  if (lastState.extractType === 'random' || lastState.chunkOrder === 'random') {
      cards.sort(() => Math.random() - 0.5);
  }

  initAndRunSession(cards, AppState.lastSession.mode);
}

function initAndRunSession(cardsArray, mode) {
  AppState.session.mode = mode;
  AppState.session.cards = cardsArray;
  AppState.session.currentIndex = 0;
  AppState.session.results = cardsArray.map(c => ({
    cardId: c.id, judged: false, isCorrect: false, rating: null
  }));

  showScreen('session');
  renderCard();
}

function updateSessionCorrectIndicator() {
  const correctCount = AppState.session.results.filter(r => r.isCorrect).length;
  document.getElementById('session-correct-indicator').textContent = `✔ ${correctCount}`;
}

function renderCard() {
  const s = AppState.session;
  const card = s.cards[s.currentIndex];
  const state = s.results[s.currentIndex];
  const activeMode = s.mode;

  document.getElementById('session-progress').textContent = `${s.currentIndex + 1} / ${s.cards.length}`;
  updateSessionCorrectIndicator();
  
  clearEl(document.getElementById('judgment-icon'));

  document.getElementById('badge-equipment').textContent = card.equipmentCategory?.join(', ') || '分類なし';
  const sysBadge = document.getElementById('badge-system');
  if(card.systemNumber) {
    sysBadge.style.display = 'inline-block';
    sysBadge.textContent = '系統: ' + card.systemNumber;
  } else {
    sysBadge.style.display = 'none';
  }

  const tx = db.transaction('progress', 'readonly');
  const req = tx.objectStore('progress').get(card.id);
  req.onsuccess = () => {
    const p = req.result;
    document.getElementById('session-flag-uneasy').classList.toggle('active', !!p?.flags?.uneasy);
    document.getElementById('session-flag-mistake').classList.toggle('active', !!p?.flags?.mistake);
  };

  const qEl = document.getElementById('card-question');
  const detailsEl = document.getElementById('card-details');
  
  detailsEl.style.display = 'none';
  qEl.textContent = activeMode === 'normal' ? card.abbr : card.ja;

  document.getElementById('btn-prev').disabled = (s.currentIndex === 0);
  document.getElementById('btn-ans').disabled = state.judged;

  const btnNext = document.getElementById('btn-next');
  clearEl(btnNext);
  if (s.currentIndex === s.cards.length - 1) {
    btnNext.appendChild(createEl('span', { textContent: '結果を見る ▶' }));
    btnNext.appendChild(createEl('span', { className: 'shortcut-key', textContent: '[4 / Enter]' }));
  } else {
    btnNext.appendChild(createEl('span', { textContent: '次へ ▶' }));
    btnNext.appendChild(createEl('span', { className: 'shortcut-key', textContent: '[4 / Enter]' }));
  }

  if (state.judged) {
      showDetails(card, activeMode);
  } else {
      AppState.session.cardStartTime = Date.now();
  }
}

async function handleAnswer(source = 'ans') {
  const s = AppState.session;
  const state = s.results[s.currentIndex];
  if (state.judged) return;

  const elapsedTime = Date.now() - s.cardStartTime;
  let rating = 'poor';

  if (source === 'space') {
    rating = 'poor';
    state.isCorrect = false;
    document.getElementById('judgment-icon').textContent = '✕';
  } else {
    state.isCorrect = true; 
    if (elapsedTime <= 5000) {
        rating = 'excellent';
        document.getElementById('judgment-icon').textContent = '◎';
    } else if (elapsedTime <= 15000) {
        rating = 'good';
        document.getElementById('judgment-icon').textContent = '〇';
    } else {
        document.getElementById('judgment-icon').textContent = '✕';
    }
  }

  state.rating = rating;
  state.judged = true;
  await saveAttempt(s.cards[s.currentIndex].id, s.mode, state.isCorrect, rating, elapsedTime);
  renderCard();
}

function showDetails(card, activeMode) {
  document.getElementById('card-details').style.display = 'block';
  document.getElementById('card-answer').textContent = activeMode === 'normal' ? card.ja : card.abbr;
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
  const newIndex = s.currentIndex + direction;
  if (newIndex >= 0 && newIndex < s.cards.length) {
      s.currentIndex = newIndex;
      renderCard();
  }
}

function saveAttempt(cardId, mode, isCorrect, rating, elapsedTime) {
  return new Promise((resolve) => {
    const now = Date.now();
    const tx = db.transaction(['attempts', 'progress'], 'readwrite');
    const attStore = tx.objectStore('attempts');
    const progStore = tx.objectStore('progress');
    
    const resultStr = isCorrect ? 'correct' : 'wrong';
    attStore.add({ cardId, mode, result: resultStr, rating, elapsedTime, answeredAt: now });

    const reqP = progStore.get(cardId);
    reqP.onsuccess = () => {
      let p = reqP.result || { cardId, correctCount: 0, wrongCount: 0 };
      p.lastAnsweredAt = now;
      if (isCorrect) {
        p.correctCount = (p.correctCount || 0) + 1;
      } else {
        p.wrongCount = (p.wrongCount || 0) + 1;
      }
      progStore.put(p);
    };
    tx.oncomplete = () => resolve();
  });
}

function endSession() {
  const s = AppState.session;
  
  const total = s.cards.length;
  const correctCount = s.results.filter(r => r.isCorrect).length;
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  document.getElementById('res-correct').textContent = correctCount;
  document.getElementById('res-total').textContent = total;
  document.getElementById('res-accuracy').textContent = accuracy;
  
  showScreen('result');
}
