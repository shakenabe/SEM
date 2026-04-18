// ==========================================
// データベース初期化 (IndexedDB)
// ==========================================
const DB_NAME = 'FlashcardAppDB';
const DB_VERSION = 2;

let db;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (e.oldVersion < 2 && db.objectStoreNames.contains('cards')) {
        db.deleteObjectStore('cards');
      }
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
// CSVパーサー & インポート
// ==========================================
function parseCSV(csvText) {
  const rows =[]; let currentRow =[]; let currentCell = ''; let insideQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i], nextChar = csvText[i + 1];
    if (insideQuotes) {
      if (char === '"' && nextChar === '"') { currentCell += '"'; i++; }
      else if (char === '"') { insideQuotes = false; }
      else { currentCell += char; }
    } else {
      if (char === '"') insideQuotes = true;
      else if (char === ',') { currentRow.push(currentCell.trim()); currentCell = ''; }
      else if (char === '\n' || char === '\r') {
        currentRow.push(currentCell.trim());
        if (currentRow.join('') !== '') rows.push(currentRow);
        currentRow =[]; currentCell = '';
        if (char === '\r' && nextChar === '\n') i++;
      } else { currentCell += char; }
    }
  }
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.join('') !== '') rows.push(currentRow);
  }
  return rows;
}

async function importCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error('データがありません');

  const dataRows = rows.slice(1);
  const newCardsMap = new Map();

  for (const row of dataRows) {
    if (row.length < 8) continue;
    const[equipmentCategory, targetMachine, systemNumber, abbr, fullSpell, ja, outline, overview] = row;
    if (!abbr || !ja) continue;

    const id = btoa(encodeURIComponent(`${abbr}_${ja}`));
    newCardsMap.set(id, {
      id,
      equipmentCategory: equipmentCategory ? equipmentCategory.split('|') :[],
      targetMachine, systemNumber, abbr, fullSpell, ja, outline, overview,
      updatedAt: Date.now()
    });
  }

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
}

// ==========================================
// ★バックアップ（エクスポート）処理
// ==========================================
async function exportBackup(includeCards) {
  const backupData = {
    timestamp: Date.now(),
    version: DB_VERSION,
    progress: await getAllFromStore('progress'),
    attempts: await getAllFromStore('attempts')
  };

  // ユーザーが選択した場合のみ、問題データ(cards)を含める
  if (includeCards) {
    backupData.cards = await getAllFromStore('cards');
  }

  return JSON.stringify(backupData);
}

// ==========================================
// ★バックアップからの復元（インポート）処理
// ==========================================
async function importBackup(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data.timestamp || !data.version) throw new Error("無効なバックアップファイルです。");
  
  return new Promise((resolve, reject) => {
    // 書き込み対象のストアを指定
    const tx = db.transaction(['cards', 'progress', 'attempts'], 'readwrite');
    
    // 問題データの復元 (含まれている場合のみ上書き更新)
    if (data.cards && Array.isArray(data.cards)) {
      const cardsStore = tx.objectStore('cards');
      data.cards.forEach(c => cardsStore.put(c));
    }
    
    // 学習履歴(スコア)の復元
    if (data.progress && Array.isArray(data.progress)) {
      const progStore = tx.objectStore('progress');
      data.progress.forEach(p => progStore.put(p));
    }
    
    // 過去の解答ログの復元
    if (data.attempts && Array.isArray(data.attempts)) {
      const attStore = tx.objectStore('attempts');
      data.attempts.forEach(a => attStore.put(a));
    }

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ==========================================
// リセット処理
// ==========================================
async function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

// 初期化実行
initDB().then(() => console.log('DB Initialized (Ver 2)'));