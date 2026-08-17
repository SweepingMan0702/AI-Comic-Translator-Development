/**
 * storage.js - Chrome Storage API + IndexedDB 封裝
 * 包含 Key 狀態持久化 (紅點/綠點/黃點)、異常日誌紀錄與快取
 */

const DB_NAME = 'ComicTranslatorDB';
const DB_VERSION = 1;
const TRANSLATION_STORE = 'translation_cache';

// ===== Chrome Storage (設定 & API Keys 列表) =====

export async function getSetting(key, defaultValue = null) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] !== undefined ? result[key] : defaultValue);
    });
  });
}

export async function setSetting(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

export async function setSettings(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, resolve);
  });
}

export async function getApiKeys() {
  const keysArray = await getSetting('api_keys_list', null);
  if (Array.isArray(keysArray) && keysArray.length > 0) {
    return keysArray.filter(k => typeof k === 'string' && k.trim().length > 5);
  }

  const oldKey = await getSetting('apiKey', '');
  if (oldKey && typeof oldKey === 'string') {
    const list = oldKey.split(/[\n,;]+/).map(k => k.trim()).filter(k => k.length > 5);
    if (list.length > 0) {
      await setSetting('api_keys_list', list);
      return list;
    }
  }

  return [];
}

export async function setApiKeys(keysList) {
  const cleanList = (keysList || []).map(k => k.trim()).filter(k => k.length > 5);
  await setSetting('api_keys_list', cleanList);
  await setSetting('apiKey', cleanList.join('\n'));
  return cleanList;
}

// ===== API Key 狀態持久化 (紅點/綠點) =====

export async function markKeyStatus(key, status) {
  try {
    const statuses = await getSetting('api_key_statuses', {});
    statuses[key] = status; // 'valid' | 'exhausted' | 'rate_limit' | 'invalid'
    await setSetting('api_key_statuses', statuses);
  } catch (e) {
    console.error('儲存 Key 狀態失敗:', e);
  }
}

export async function getKeyStatuses() {
  return await getSetting('api_key_statuses', {});
}

// ===== 本地異常日誌記錄 =====

export async function logErrorToStorage(type, details) {
  try {
    const logs = await getSetting('debug_logs', []);
    const entry = {
      time: new Date().toLocaleTimeString(),
      type,
      details,
    };
    logs.unshift(entry);
    if (logs.length > 50) logs.length = 50;
    await setSetting('debug_logs', logs);
  } catch (e) {
    console.error('日誌寫入失敗:', e);
  }
}

export async function getLogsFromStorage() {
  return await getSetting('debug_logs', []);
}

// ===== IndexedDB (快取) =====

let dbInstance = null;

async function getDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(TRANSLATION_STORE)) {
        const transStore = db.createObjectStore(TRANSLATION_STORE, { keyPath: 'cacheKey' });
        transStore.createIndex('timestamp', 'timestamp');
      }
    };

    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    req.onerror = () => reject(req.error);
  });
}

export async function getCachedTranslation(cacheKey, targetLang) {
  const db = await getDB();
  const key = `${cacheKey}_${targetLang}`;
  return new Promise((resolve) => {
    const tx = db.transaction(TRANSLATION_STORE, 'readonly');
    const req = tx.objectStore(TRANSLATION_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => resolve(null);
  });
}

export async function setCachedTranslation(cacheKey, targetLang, data) {
  const db = await getDB();
  const key = `${cacheKey}_${targetLang}`;
  return new Promise((resolve) => {
    const tx = db.transaction(TRANSLATION_STORE, 'readwrite');
    tx.objectStore(TRANSLATION_STORE).put({ cacheKey: key, data, timestamp: Date.now() });
    tx.oncomplete = resolve;
  });
}

export async function clearAllCache() {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction(TRANSLATION_STORE, 'readwrite');
    tx.objectStore(TRANSLATION_STORE).clear();
    tx.oncomplete = resolve;
  });
}
