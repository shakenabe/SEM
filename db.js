// ==========================================
// データベース初期化 (IndexedDB)
// ==========================================
const DB_NAME = 'FlashcardAppDB';
const DB_VERSION = 3; 
let db;

window.dbInitPromise = initDB().then(() => console.log('DB Initialized (Ver 3 - No Cards Storage)'));

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (db.objectStoreNames.contains('cards')) {
        db.deleteObjectStore('cards');
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

async function getAllFromStore(storeName) {
  return new Promise((resolve, reject) => {
    if (storeName === 'cards') {

      resolve([]);
      return;
    }
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ==========================================
// CSVパーサー & メモリ上への読み込み
// ==========================================
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
};

// DBに保存せず、メモリ上で扱うための配列を生成して返すだけにする
window.parseCardsFromCSV = function(csvText, mapping = null) {
  const rows = window.parseCSV(csvText);
  if (rows.length < 2) throw new Error('データがありません');

  const dataRows = rows.slice(1);
  const parsedCards =[];

  for (const row of dataRows) {
    const getVal = (key) => (mapping && mapping[key] !== -1 && mapping[key] !== undefined && row[mapping[key]] !== undefined) ? row[mapping[key]] : '';
    
    const equipmentCategoryStr = mapping ? getVal('equipmentCategory') : (row[0] || '');
    const targetMachine = mapping ? getVal('targetMachine') : (row[1] || '');
    const systemNumber = mapping ? getVal('systemNumber') : (row[2] || '');
    const abbr = mapping ? getVal('abbr') : (row[3] || '');
    const fullSpell = mapping ? getVal('fullSpell') : (row[4] || '');
    const ja = mapping ? getVal('ja') : (row[5] || '');
    const outline = mapping ? getVal('outline') : (row[6] || '');
    const overview = mapping ? getVal('overview') : (row[7] || '');

    if (!abbr || !ja) continue;

    // ハッシュIDを生成 (このIDを使って学習履歴と紐づける)
    const id = btoa(encodeURIComponent(`${abbr}_${ja}`));
    parsedCards.push({
      id,
      equipmentCategory: equipmentCategoryStr ? equipmentCategoryStr.split('|').map(s=>s.trim()) :[],
      targetMachine, systemNumber, abbr, fullSpell, ja, outline, overview,
      updatedAt: Date.now()
    });
  }

  if (parsedCards.length === 0) throw new Error('有効なデータが見つかりませんでした。');
  return parsedCards;
};

// ==========================================
// バックアップ処理（履歴のみ）
// ==========================================
async function exportBackup() {
  const backupData = {
    timestamp: Date.now(),
    version: DB_VERSION,
    progress: await getAllFromStore('progress'),
    attempts: await getAllFromStore('attempts')
  };
  return JSON.stringify(backupData);
}

async function importBackup(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data.timestamp || !data.version) throw new Error("無効なバックアップファイルです。");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['progress', 'attempts'], 'readwrite');
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
}

async function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}
