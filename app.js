
setInterval(() => {
  if (window.outerWidth - window.innerWidth > 200 || window.outerHeight - window.innerHeight > 200) {
    document.body.textContent = 'Security Policy Violation Detected.';
  }
}, 1000);


const CardManager = (function() {
  let _data =[]; 


  function sanitize(str) {
    if (!str) return '';
    return String(str).replace(/[<>&"'`]/g, '');
  }

  // IDのハッシュ化 (推測防止)
  function hashId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return btoa(String(hash)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  }

  // CSVパース (内部で完結)
  function parseCSV(csvText) {
    const rows = []; let currentRow =[]; let currentCell = ''; let insideQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i], nextChar = csvText[i + 1];
      if (insideQuotes) {
        if (char === '"' && nextChar === '"') { currentCell += '"'; i++; }
        else if (char === '"') { insideQuotes = false; }
        else { currentCell += char; }
      } else {
        if (char === '"') insideQuotes = true;
        else if (char === ',') { currentRow.push(sanitize(currentCell.trim())); currentCell = ''; }
        else if (char === '\n' || char === '\r') {
          currentRow.push(sanitize(currentCell.trim()));
          if (currentRow.join('') !== '') rows.push(currentRow);
          currentRow =[]; currentCell = '';
          if (char === '\r' && nextChar === '\n') i++;
        } else { currentCell += char; }
      }
    }
    if (currentCell || currentRow.length > 0) {
      currentRow.push(sanitize(currentCell.trim()));
      if (currentRow.join('') !== '') rows.push(currentRow);
    }
    return rows;
  }

  return {
    // データをロード
    loadFromCSV: function(csvText, mapping) {
      const rows = parseCSV(csvText);
      if (rows.length < 2) throw new Error('データがありません');
      const dataRows = rows.slice(1);
      const parsed =[];

      for (const row of dataRows) {
        const getVal = (key) => (mapping && mapping[key] !== -1 && mapping[key] !== undefined && row[mapping[key]] !== undefined) ? row[mapping[key]] : '';
        
        const eqStr = mapping ? getVal('equipmentCategory') : (row[0] || '');
        const equipmentCategory = eqStr ? eqStr.split('|').map(s => s.trim()) : [];
        const targetMachine = mapping ? getVal('targetMachine') : (row[1] || '');
        const systemNumber = mapping ? getVal('systemNumber') : (row[2] || '');
        const abbr = mapping ? getVal('abbr') : (row[3] || '');
        const fullSpell = mapping ? getVal('fullSpell') : (row[4] || '');
        const ja = mapping ? getVal('ja') : (row[5] || '');
        const outline = mapping ? getVal('outline') : (row[6] || '');
        const overview = mapping ? getVal('overview') : (row[7] || '');

        if (!abbr || !ja) continue;

        const id = hashId(`${abbr}_${ja}`);
        parsed.push({ id, equipmentCategory, targetMachine, systemNumber, abbr, fullSpell, ja, outline, overview, updatedAt: Date.now() });
      }
      if (parsed.length === 0) throw new Error('有効なデータが見つかりませんでした。');
      _data = parsed;
      return parsed.length;
    },

    getCount: () => _data.length,
    getAll: () => _data.map(c => ({...c})), 
    clear: () => { _data =[]; }
  };
})();

// ==========================================
// 状態管理・グローバル変数
// ==========================================
let currentCsvText = ''; 
const AppState = {
  currentScreen: 'home',
  entryType: 'normal',
  session: {
    cards:[], currentIndex: 0, mode: 'normal', 
    startTime: 0, timerInterval: null, timeRemaining: 0, results:[]
  },
  lastSession: null 
};

// ==========================================
// ユーティリティ・DOM生成ヘルパー (innerHTML排除用)
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
function updateHomeSummary() {
  const count = CardManager.getCount();
  const summaryEl = document.getElementById('home-data-summary');
  const menuBtns = document.querySelectorAll('.main-menu-btn');
  
  clearEl(summaryEl);

  if (count === 0) {
    summaryEl.style.display = 'none';
    menuBtns.forEach(btn => btn.disabled = true);
    return;
  }
  
  summaryEl.style.display = 'block';
  menuBtns.forEach(btn => btn.disabled = false);
  
  const titleDiv = createEl('div', { className: 'home-summary-title', textContent: `読込済みの問題: ${count} 問` });
  summaryEl.appendChild(titleDiv);

  const eqMap = {};
  const cards = CardManager.getAll();
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

async function getAllFromStore(storeName) {
  if(storeName === 'cards') return CardManager.getAll();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ==========================================
// 初期化・共通イベントリスナー
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  if (window.dbInitPromise) await window.dbInitPromise;
  updateHomeSummary();

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
  document.getElementById('btn-ans').addEventListener('click', handleAnswer);
  document.getElementById('btn-mark-correct').addEventListener('click', handleMarkCorrect);
  
  document.getElementById('btn-exit').addEventListener('click', () => document.getElementById('modal-exit').classList.add('active'));
  document.getElementById('btn-modal-no').addEventListener('click', () => document.getElementById('modal-exit').classList.remove('active'));
  document.getElementById('btn-modal-yes').addEventListener('click', () => {
    document.getElementById('modal-exit').classList.remove('active');
    endSession();
  });

  document.getElementById('btn-retry-session').addEventListener('click', retrySession);
  document.getElementById('btn-review-wrong').addEventListener('click', async () => {
    AppState.entryType = 'wrong';
    await prepareConfigScreen();
    showScreen('config');
  });

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
      if (e.target.value === 'random') {
        document.getElementById('config-opt-random').style.display = 'block';
        document.getElementById('config-opt-range').style.display = 'none';
      } else {
        document.getElementById('config-opt-random').style.display = 'none';
        document.getElementById('config-opt-range').style.display = 'block';
      }
      document.getElementById('config-set-preview').style.display = 'none';
    });
  });

  document.querySelector('.config-form').addEventListener('change', (e) => {
    if (e.target.classList.contains('chk-flag') || e.target.classList.contains('chk-eq') || 
        e.target.id === 'config-span' || e.target.id === 'config-chunk-size') {
      updateConfigPreview();
    }
  });

  document.getElementById('btn-toggle-preview').addEventListener('click', async () => {
    const previewDiv = document.getElementById('config-set-preview');
    if (previewDiv.style.display === 'block') { previewDiv.style.display = 'none'; return; }
    
    let cards = await getFilteredCards();
    const chunkSize = parseInt(document.getElementById('config-chunk-size').value);
    const chunkIndex = parseInt(document.getElementById('config-chunk-select').value);
    
    if (!isNaN(chunkIndex)) {
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
  const setupCsvUpload = (btnId, inputId) => {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        currentCsvText = ev.target.result;
        // マッピング用のヘッダー取得(1行目だけ手動パース)
        const firstLine = currentCsvText.split('\n')[0];
        if(!firstLine) return alert("データがありません。");
        const headers = firstLine.split(',').map(s => s.replace(/"/g, '').trim());
        openMappingModal(headers);
      };
      reader.readAsText(file);
      input.value = ''; 
    });
  };

  setupCsvUpload('btn-home-select-csv', 'home-csv-upload');
  setupCsvUpload('btn-trigger-mapping', 'csv-upload');

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

  document.getElementById('btn-execute-import').addEventListener('click', () => {
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
      const count = CardManager.loadFromCSV(currentCsvText, mapping);
      const msgH = document.getElementById('home-import-msg');
      const msgS = document.getElementById('import-msg');
      const msgText = `🔓 ${count} 件の問題を安全なメモリに展開しました！`;
      if(msgH) { msgH.style.color = "var(--success-color)"; msgH.textContent = msgText; }
      if(msgS) { msgS.style.color = "var(--success-color)"; msgS.textContent = msgText; }
      
      updateHomeSummary();
      if(AppState.currentScreen === 'settings') showScreen('home');
    } catch (err) {
      alert("読み込みエラー: " + err.message);
    }
    currentCsvText = '';
  });

  // バックアップ・リセット・テーマ
  document.getElementById('btn-export-backup').addEventListener('click', async () => {
    try {
      const jsonStr = await exportBackup();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      const d = new Date();
      a.download = `flashcard_history_${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}_${d.getHours().toString().padStart(2,'0')}${d.getMinutes().toString().padStart(2,'0')}.json`;
      a.click(); URL.revokeObjectURL(url);
      localStorage.setItem('lastBackupTimestamp', Date.now().toString());
      alert('学習履歴のバックアップをダウンロードしました。');
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
        const jsonStr = e.target.result; const backupData = JSON.parse(jsonStr);
        const lastTime = parseInt(localStorage.getItem('lastBackupTimestamp') || localStorage.getItem('lastDataUpdate') || '0', 10);
        if (lastTime > 0 && backupData.timestamp < lastTime) {
          if (!await confirmAction('⚠️ 警告: 古いバックアップです', '前回保存した時より古いデータです。\n本当に復元しますか？')) return;
        } else {
          if (!await confirmAction('バックアップの復元', '現在の学習履歴が上書きされます。\n実行してよろしいですか？')) return;
        }
        await importBackup(jsonStr);
        localStorage.setItem('lastDataUpdate', Date.now().toString());
        msg.style.color = "var(--success-color)"; msg.textContent = "学習履歴の復元が完了しました！";
        updateHomeSummary();
      } catch (err) { msg.style.color = "var(--danger-color)"; msg.textContent = "復元エラー: " + err.message; }
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-reset-history').addEventListener('click', async () => {
    if(await confirmAction('学習履歴のリセット', '間違えた問題などの履歴のみを削除しますか？')) {
      await clearStore('progress'); await clearStore('attempts'); alert('履歴をリセットしました。');
    }
  });

  document.getElementById('btn-reset-all').addEventListener('click', async () => {
    if(await confirmAction('全データ完全リセット', '学習履歴をすべて削除しますか？\n(メモリ上の問題データも消去されます)')) {
      await clearStore('progress'); await clearStore('attempts'); 
      CardManager.clear();
      updateHomeSummary(); alert('全リセットしました。');
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
    if (e.key === 'Enter') {
      e.preventDefault(); document.getElementById('btn-retry-session').click();
    } else if (e.key.toLowerCase() === 'r') {
      e.preventDefault(); 
      const btnR = document.getElementById('btn-review-wrong');
      if(btnR.style.display !== 'none') btnR.click();
    } else if (e.key.toLowerCase() === 'h') {
      e.preventDefault(); showScreen('home');
    }
    return;
  }

  if (AppState.currentScreen !== 'session') return;

  const state = AppState.session.results[AppState.session.currentIndex];
  const isInputFocused = document.activeElement && document.activeElement.id === 'user-answer-input';

  if (e.key === 'Enter') {
    e.preventDefault(); 
    if (!state.judged) document.getElementById('btn-ans').click();
    else document.getElementById('btn-next').click();
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
async function renderListScreen() {
  const cards = CardManager.getAll();
  const select = document.getElementById('list-category-filter');
  const categories = new Set();
  cards.forEach(c => { 
    if (c.equipmentCategory) c.equipmentCategory.forEach(cat => categories.add(cat)); 
  });
  
  clearEl(select);
  select.appendChild(createEl('option', { value: 'all', textContent: 'すべて' }));
  categories.forEach(cat => { select.appendChild(createEl('option', { value: cat, textContent: cat })); });
  if(!select.onchange) select.addEventListener('change', renderListTable);
  
  renderListTable();
  showScreen('list');
}

async function renderListTable() {
  const cards = CardManager.getAll();
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
// 学習分析・間違えた問題リスト
// ==========================================
async function renderAnalyticsScreen() {
  const cards = CardManager.getAll();
  const progress = await getAllFromStore('progress');
  const progMap = new Map(progress.map(p =>[p.cardId, p]));

  let learnedCards = 0; let totalCorrect = 0; let totalWrong = 0;
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
  clearEl(catTbody);
  Object.values(statsMap).forEach(stat => {
    const statAcc = (stat.correct + stat.wrong > 0) ? Math.round((stat.correct / (stat.correct + stat.wrong)) * 100) : 0;
    const tr = createEl('tr');
    tr.appendChild(createEl('td', { textContent: stat.name }));
    tr.appendChild(createEl('td', { textContent: stat.total }));
    tr.appendChild(createEl('td', { textContent: stat.learned }));
    tr.appendChild(createEl('td', { style: `color:${statAcc < 60 ? 'var(--danger-color)' : 'inherit'}; font-weight:bold;`, textContent: `${statAcc}%` }));
    catTbody.appendChild(tr);
  });

  const container = document.getElementById('analytics-wrong-container');
  clearEl(container);
  const wrongCards = cards.filter(c => progMap.get(c.id) && progMap.get(c.id).wrongCount > 0);

  if (wrongCards.length === 0) {
    container.appendChild(createEl('p', { style: 'text-align:center; padding: 20px; background:var(--card-bg); border-radius:8px;', textContent: '間違えた問題はありません！🎉' }));
  } else {
    const grouped = {};
    wrongCards.forEach(c => {
      const eqs = (c.equipmentCategory && c.equipmentCategory.length > 0) ? c.equipmentCategory :['分類なし'];
      eqs.forEach(eq => {
        if(!grouped[eq]) grouped[eq] =[];
        grouped[eq].push(c);
      });
    });

    Object.keys(grouped).sort().forEach(eq => {
      const gCards = grouped[eq];
      gCards.sort((a, b) => progMap.get(b.id).wrongCount - progMap.get(a.id).wrongCount);
      
      const wrapper = createEl('div', { style: 'margin-bottom: 15px;' });
      const header = createEl('div', { className: 'folder-header closed' });
      header.appendChild(document.createTextNode(`📁 ${eq} `));
      header.appendChild(createEl('span', { style: 'font-size:0.9rem; font-weight:normal;', textContent: `(${gCards.length}件)` }));
      
      const content = createEl('div', { className: 'folder-content table-responsive closed', style: 'margin-bottom: 0;' });
      
      const table = document.createElement('table');
      const thead = createEl('thead');
      const trH = createEl('tr');
      ['マーク', '略語', '日本語', 'ミス回数', '対象号機'].forEach((t, i) => {
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
        tr.appendChild(createEl('td', {},[createEl('strong', { textContent: c.abbr })]));
        tr.appendChild(createEl('td', { textContent: c.ja }));
        tr.appendChild(createEl('td', { style: 'color:var(--danger-color); font-weight:bold;', textContent: `${p.wrongCount}回` }));
        tr.appendChild(createEl('td', { textContent: c.targetMachine || '-' }));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      content.appendChild(table); wrapper.appendChild(header); wrapper.appendChild(content); container.appendChild(wrapper);
    });
  }
  showScreen('analytics');
}

// ==========================================
//  設定画面＆プレビュー・出題セット生成
// ==========================================
async function getFilteredCards() {
  const allCards = CardManager.getAll(); 
  const allProgress = await getAllFromStore('progress');
  const allAttempts = await getAllFromStore('attempts');
  const progMap = new Map(allProgress.map(p =>[p.cardId, p]));
  let filtered =[];

  if (AppState.entryType === 'normal') {
    filtered = [...allCards]; 
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
  
  if (filtered.length === 0) {
    chunkSelect.appendChild(createEl('option', { value: '0', textContent: 'データがありません' }));
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
  const cards = CardManager.getAll();
  const configForm = document.querySelector('.config-form');
  let spanSelect = document.getElementById('config-span');
  
  if (AppState.entryType === 'weak') {
    if (!spanSelect) {
      const label = createEl('label', { id: 'label-config-span' },[
        '集計期間: ',
        createEl('select', { id: 'config-span' },[
          createEl('option', { value: '30', textContent: '直近30日' }),
          createEl('option', { value: '7', textContent: '直近7日' }),
          createEl('option', { value: '90', textContent: '直近90日' }),
          createEl('option', { value: 'all', textContent: '全期間' })
        ])
      ]);
      configForm.insertBefore(label, document.getElementById('filter-flags').parentElement.previousElementSibling);
    }
  } else {
    if (spanSelect) document.getElementById('label-config-span').remove();
  }

  const eqContainer = document.getElementById('filter-equipments');
  if (eqContainer.innerHTML === '') {
    const eqSet = new Set();
    cards.forEach(c => {
      if (c.equipmentCategory) c.equipmentCategory.forEach(eq => eqSet.add(eq));
    });
    eqSet.forEach(eq => {
      const lbl = createEl('label', { className: 'checkbox-label' },[
        createEl('input', { type: 'checkbox', value: eq, className: 'chk-eq' }),
        document.createTextNode(` ${eq}`)
      ]);
      eqContainer.appendChild(lbl);
    });
  }
  await updateConfigPreview();
}

// ==========================================
// セッション制御
// ==========================================
async function startSession() {
  const mode = document.getElementById('config-mode').value;
  let cards = await getFilteredCards();
  const extractType = document.querySelector('input[name="extract-type"]:checked').value;

  if (extractType === 'random') {
    cards.sort(() => Math.random() - 0.5);
    const countSelect = document.getElementById('config-count').value;
    if (countSelect !== 'all') cards = cards.slice(0, parseInt(countSelect));
  } else {
    const chunkSize = parseInt(document.getElementById('config-chunk-size').value);
    const chunkIndex = parseInt(document.getElementById('config-chunk-select').value);
    if (!isNaN(chunkIndex)) {
      const start = chunkIndex * chunkSize;
      const end = start + chunkSize;
      cards = cards.slice(start, end);
    } else {
      cards =[];
    }

    const order = document.getElementById('config-chunk-order').value;
    if (order === 'reverse') cards.reverse();
    if (order === 'random') cards.sort(() => Math.random() - 0.5);
  }
  
  if (cards.length === 0) return alert("条件・絞り込みに一致する問題がありません！");

  AppState.lastSession = { cards: [...cards], mode };
  initAndRunSession(cards, mode);
}

function retrySession() {
  if (!AppState.lastSession) return;
  initAndRunSession([...AppState.lastSession.cards], AppState.lastSession.mode);
}

function initAndRunSession(cardsArray, mode) {
  AppState.session.mode = mode;
  AppState.session.cards = cardsArray;
  AppState.session.currentIndex = 0;
  AppState.session.results = cardsArray.map(c => ({
    cardId: c.id, judged: false, isCorrect: false, userInput: '', attemptId: null,
    testType: mode === 'test' ? (Math.random() > 0.5 ? 'rev1' : 'rev2') : mode
  }));

  if (mode === 'test') {
    AppState.session.timeRemaining = cardsArray.length * 10;
    document.getElementById('session-timer').style.display = 'inline';
    if (AppState.session.timerInterval) clearInterval(AppState.session.timerInterval);
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

function updateSessionCorrectIndicator() {
  const correctCount = AppState.session.results.filter(r => r.isCorrect).length;
  document.getElementById('session-correct-indicator').textContent = `✔ ${correctCount}`;
}

function renderCard() {
  const s = AppState.session;
  const card = s.cards[s.currentIndex];
  const state = s.results[s.currentIndex];
  const activeMode = s.mode === 'test' ? state.testType : s.mode;

  document.getElementById('session-progress').textContent = `${s.currentIndex + 1} / ${s.cards.length}`;
  updateSessionCorrectIndicator();

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
  const inputSec = document.getElementById('card-input-section');
  const inputEl = document.getElementById('user-answer-input');
  const judgeEl = document.getElementById('judgment-result');
  const detailsEl = document.getElementById('card-details');
  
  detailsEl.style.display = 'none';
  clearEl(judgeEl);
  qEl.textContent = (activeMode === 'normal' || activeMode === 'rev1') ? card.abbr : card.ja;

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
  
  const total = s.cards.length;
  const correctCount = s.results.filter(r => r.isCorrect).length;
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  document.getElementById('res-correct').textContent = correctCount;
  document.getElementById('res-total').textContent = total;
  document.getElementById('res-accuracy').textContent = accuracy;
  document.getElementById('btn-review-wrong').style.display = (total - correctCount > 0) ? 'flex' : 'none';

  showScreen('result');
}


window.addEventListener('pagehide', () => {
  CardManager.clear(); 
});
