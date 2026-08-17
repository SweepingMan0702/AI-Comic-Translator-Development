/**
 * background.js - Service Worker (多 Key 平行調度與原生多圖批次佇列)
 */

import { detectAndTranslateMultiImages, testSingleApiKey, GeminiError } from '../lib/gemini.js';
import { 
  getCachedTranslation, 
  setCachedTranslation, 
  getSetting, 
  setSettings, 
  getApiKeys,
  setApiKeys,
  clearAllCache,
  getLogsFromStorage,
  getKeyStatuses,
  markKeyStatus,
  setSetting
} from '../lib/storage.js';
import { getCacheKey } from '../lib/cache.js';

const KEY_MIN_INTERVAL_MS = 2500; // 單把 Key 間隔 2.5 秒，完全符合 Google 5~10 RPM 限制

let keyPointer = 0;
const keyCooldowns = new Map();
const keyLastUsed = new Map();

const taskQueue = [];
let activeWorkers = 0;

const stats = {
  apiCalls: 0,
  cacheHits: 0,
  totalTranslated: 0,
};

// ===== 訊息監聽 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(e => {
    console.error('[ComicTranslator BG]', e);
    sendResponse({ error: e.message || '未知錯誤' });
  });
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'GET_SETTINGS': {
      const [keys, targetLang, autoTranslate, keyStatuses] = await Promise.all([
        getApiKeys(),
        getSetting('targetLang', 'zh-TW'),
        getSetting('autoTranslate', false),
        getKeyStatuses(),
      ]);
      return { keys, targetLang, autoTranslate, keyStatuses };
    }

    case 'SAVE_KEYS_LIST': {
      const keys = await setApiKeys(msg.keys);
      broadcastToTabs({ type: 'UPDATE_KEYS', keys });
      return { success: true, keys };
    }

    case 'SAVE_SETTINGS': {
      await setSettings({
        targetLang: msg.targetLang,
        autoTranslate: msg.autoTranslate,
      });
      broadcastToTabs({
        type: 'UPDATE_SETTINGS',
        targetLang: msg.targetLang,
        autoTranslate: msg.autoTranslate,
      });
      return { success: true };
    }

    case 'TEST_SINGLE_KEY': {
      return await testSingleApiKey(msg.key);
    }

    // 原生多圖批次翻譯任務
    case 'TRANSLATE_BATCH_IMAGES': {
      return enqueueBatchTranslation(msg.items, msg.targetLang);
    }

    case 'STOP_TRANSLATION': {
      const cancelledCount = taskQueue.length;
      while (taskQueue.length > 0) {
        const task = taskQueue.shift();
        task.reject(new Error('翻譯已手動停止'));
      }
      broadcastToTabs({ type: 'STOP_TRANSLATION' });
      return { success: true, cancelledCount };
    }

    case 'CLEAR_TRANSLATIONS': {
      const tabId = sender.tab?.id;
      if (tabId) chrome.tabs.sendMessage(tabId, { type: 'CLEAR_TRANSLATIONS' });
      return { success: true };
    }

    case 'CLEAR_CACHE': {
      await clearAllCache();
      return { success: true };
    }

    case 'GET_STATS': {
      const keys = await getApiKeys();
      const now = Date.now();
      const activeKeys = keys.filter(k => (keyCooldowns.get(k) || 0) <= now).length;
      return { 
        ...stats, 
        totalKeys: keys.length, 
        activeKeys,
        pendingQueue: taskQueue.length
      };
    }

    case 'GET_LOGS': {
      return await getLogsFromStorage();
    }

    case 'CLEAR_LOGS': {
      await setSetting('debug_logs', []);
      return { success: true };
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}

// ===== 平行多 Worker 佇列控制 =====

function enqueueBatchTranslation(items, targetLang) {
  return new Promise((resolve, reject) => {
    taskQueue.push({ items, targetLang, resolve, reject });
    pump();
  });
}

async function pump() {
  const keys = await getApiKeys();
  const maxConcurrency = Math.max(1, Math.min(3, keys.length || 1)); // 依據 Key 數量動態開啟最多 3 個平行通道

  while (activeWorkers < maxConcurrency && taskQueue.length > 0) {
    const task = taskQueue.shift();
    activeWorkers++;
    executeBatch(task).finally(() => {
      activeWorkers--;
      pump();
    });
  }
}

async function executeBatch({ items, targetLang, resolve, reject }) {
  try {
    const result = await processBatch(items, targetLang);
    stats.totalTranslated += items.length;
    resolve(result);
  } catch (e) {
    reject(e);
  }
}

function pickAvailableKey(keys) {
  if (!keys || keys.length === 0) return null;
  const now = Date.now();

  for (let i = 0; i < keys.length; i++) {
    const idx = (keyPointer + i) % keys.length;
    const key = keys[idx];
    const cooldownTime = keyCooldowns.get(key) || 0;
    const lastUsed = keyLastUsed.get(key) || 0;

    if (cooldownTime <= now && (now - lastUsed) >= KEY_MIN_INTERVAL_MS) {
      keyPointer = (idx + 1) % keys.length;
      keyLastUsed.set(key, now);
      return { key, index: idx };
    }
  }

  // 找下一個即將解鎖的 Key
  let minWait = Infinity;
  keys.forEach(k => {
    const cd = keyCooldowns.get(k) || 0;
    const lastUsed = keyLastUsed.get(k) || 0;
    const readyAt = Math.max(cd, lastUsed + KEY_MIN_INTERVAL_MS);
    if (readyAt < minWait) minWait = readyAt;
  });

  const waitSeconds = Math.max(1, Math.ceil((minWait - now) / 1000));
  return { key: null, waitSeconds };
}

async function processBatch(items, targetLang) {
  const keys = await getApiKeys();
  if (keys.length === 0) {
    throw new Error('未設定 API Key，請先在擴充功能中新增 Gemini API Key。');
  }

  // 1. 檢查快取
  const resultsByImage = new Array(items.length).fill(null);
  const unCachedItems = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const cacheKey = await getCacheKey(it.url);
    if (cacheKey) {
      const cached = await getCachedTranslation(cacheKey, targetLang);
      if (cached) {
        resultsByImage[i] = cached;
        stats.cacheHits++;
        continue;
      }
    }
    unCachedItems.push({ ...it, originalIndex: i });
  }

  if (unCachedItems.length === 0) {
    return { resultsByImage };
  }

  // 2. 準備圖片 Base64 (若前端沒有傳入，由 Background fetch)
  const imagesForApi = [];
  for (let i = 0; i < unCachedItems.length; i++) {
    const item = unCachedItems[i];
    let base64 = item.localBase64;
    let mimeType = item.localMimeType || 'image/jpeg';

    if (!base64 && item.url) {
      const fetched = await fetchImageAsBase64(item.url);
      base64 = fetched.base64;
      mimeType = fetched.mimeType;
    }

    imagesForApi.push({
      base64,
      mimeType,
      index: i,
    });
  }

  // 3. 呼叫 Gemini 多圖批次 API
  let attempts = 0;
  let rawBoxes = [];

  while (attempts < Math.max(3, keys.length * 2)) {
    attempts++;
    const pick = pickAvailableKey(keys);

    if (!pick.key) {
      await sleep(1500);
      continue;
    }

    try {
      stats.apiCalls++;
      rawBoxes = await detectAndTranslateMultiImages(pick.key, imagesForApi, targetLang);
      await markKeyStatus(pick.key, 'valid');
      break;
    } catch (err) {
      if (err.type === 'rate_limit' || err.type === 'exhausted') {
        const cdSec = err.retryAfterSeconds || 35;
        console.warn(`[ComicTranslator] Key #${pick.index + 1} 觸發限制，冷卻 ${cdSec} 秒`);
        keyCooldowns.set(pick.key, Date.now() + cdSec * 1000);
        await markKeyStatus(pick.key, err.type);
        continue;
      }
      throw err;
    }
  }

  // 4. 將回傳的 boxes 依照 imageIndex 分配並存入快取
  unCachedItems.forEach((item, localIdx) => {
    const imgBoxes = rawBoxes.filter(b => b.imageIndex === localIdx);
    resultsByImage[item.originalIndex] = imgBoxes;

    getCacheKey(item.url).then(cacheKey => {
      if (cacheKey) setCachedTranslation(cacheKey, targetLang, imgBoxes);
    });
  });

  return { resultsByImage };
}

async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      headers: { 'Accept': 'image/*' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const mimeType = blob.type || 'image/jpeg';

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return { base64, mimeType };
  } catch (err) {
    throw new Error(`無法下載圖片 (${err.message})`);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  });
}
