// ==========================================
// データベース初期化 (IndexedDB)
// ★ 通常版: cards(問題文)をPCに永続保存する仕様
// ==========================================
const DB_NAME = 'FlashcardAppDB';
const DB_VERSION = 4; // バージョンを上げてcardsストアを再作成

let db;
window.dbInitPromise = initDB().then(() => console.log('DB Initialized (Ver 4 - Cards Storage Restored)'));

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      
      // バージョンアップに伴い、ストアを確保
      if (!db.objectStoreNames.contains('cards')) {
        const cardsOS = db.createObjectStore('cards', { keyPath: 'id' });
        cardsOS.createIndex('equipmentCategory', 'equipmentCategory', { multiEntry: true });
      }
      
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'cardId' });
      }
      if (!db.objectStoreNames.contains('attempts')) {
        const attOS = db.createObjectStore('attempts', { keyPath: 'attemptId', autoIncrement: true });
        attOS.createIndex('cardId', 'cardId', { unique: false });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

// 汎用データ取得ヘルパー
async function getAllFromStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ==========================================
// CSVパーサー 
// ==========================================
// XSS対策のサニタイズ
function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/[<>&"'`]/g, '');
}

// ハッシュIDの生成
function hashId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return btoa(String(hash)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

window.parseCSV = function(csvText) {
  const rows =[]; let currentRow =[]; let currentCell = ''; let insideQuotes = false;
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
};

// ★ マッピング情報を利用したインポート処理 (DBに保存)
window.importCSV = async function(csvText, mapping = null) {
  const rows = window.parseCSV(csvText);
  if (rows.length < 2) throw new Error('データがありません');

  const dataRows = rows.slice(1);
  const newCardsMap = new Map();

  for (const row of dataRows) {
    const getVal = (key) => (mapping && mapping[key] !== -1 && mapping[key] !== undefined && row[mapping[key]] !== undefined) ? row[mapping[key]] : '';
    
    const eqStr = mapping ? getVal('equipmentCategory') : (row[0] || '');
    const equipmentCategory = eqStr ? eqStr.split('|').map(s => s.trim()) :[];
    const targetMachine = mapping ? getVal('targetMachine') : (row[1] || '');
    const systemNumber = mapping ? getVal('systemNumber') : (row[2] || '');
    const abbr = mapping ? getVal('abbr') : (row[3] || '');
    const fullSpell = mapping ? getVal('fullSpell') : (row[4] || '');
    const ja = mapping ? getVal('ja') : (row[5] || '');
    const outline = mapping ? getVal('outline') : (row[6] || '');
    const overview = mapping ? getVal('overview') : (row[7] || '');

    if (!abbr || !ja) continue;

    const id = hashId(`${abbr}_${ja}`);
    newCardsMap.set(id, {
      id, equipmentCategory, targetMachine, systemNumber, abbr, fullSpell, ja, outline, overview, updatedAt: Date.now()
    });
  }

  if (newCardsMap.size === 0) throw new Error('有効なデータが見つかりませんでした。');

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cards'], 'readwrite');
    const store = tx.objectStore('cards');
    let deletedCount = 0;
    let updatedOrAddedCount = 0;

    const reqKeys = store.getAllKeys();
    reqKeys.onsuccess = () => {
      const existingKeys = reqKeys.result;
      existingKeys.forEach(key => {
        if (!newCardsMap.has(key)) { store.delete(key); deletedCount++; }
      });
      newCardsMap.forEach(card => { store.put(card); updatedOrAddedCount++; });
    };
    tx.oncomplete = () => resolve({ updated: updatedOrAddedCount, deleted: deletedCount });
    tx.onerror = (e) => reject(e.target.error);
  });
};

// ==========================================
// バックアップ
// ==========================================
window.exportBackup = async function(includeCards) {
  const backupData = {
    timestamp: Date.now(),
    version: DB_VERSION,
    progress: await getAllFromStore('progress'),
    attempts: await getAllFromStore('attempts')
  };
  if (includeCards) backupData.cards = await getAllFromStore('cards');
  return JSON.stringify(backupData);
};

window.importBackup = async function(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data.timestamp || !data.version) throw new Error("無効なバックアップファイルです。");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['cards', 'progress', 'attempts'], 'readwrite');
    if (data.cards && Array.isArray(data.cards)) {
      const cardsStore = tx.objectStore('cards');
      data.cards.forEach(c => cardsStore.put(c));
    }
    if (data.progress && Array.isArray(data.progress)) {
      const progStore = tx.objectStore('progress');
      data.progress.forEach(p => progStore.put(p));
    }
    if (data.attempts && Array.isArray(data.attempts)) {
      const attStore = tx.objectStore('attempts');
      data.attempts.forEach(a => attStore.put(a));
    }
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
};

window.clearStore = async function(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
};
