/**
 * popup.js - Popup 邏輯 (Key 清單紅色狀態標記、停止翻譯、日誌檢視)
 */

// ===== DOM 元素 =====
const keyListContainer  = document.getElementById('keyListContainer');
const newKeyInput       = document.getElementById('newKeyInput');
const addNewKeyBtn      = document.getElementById('addNewKeyBtn');
const keyCountBadge     = document.getElementById('keyCountBadge');
const apiStatusMsg      = document.getElementById('apiStatusMsg');

const targetLangSel     = document.getElementById('targetLang');
const autoTransChk      = document.getElementById('autoTranslate');
const fontScaleInput    = document.getElementById('fontScale');
const fontScaleVal      = document.getElementById('fontScaleVal');

const translateBtn      = document.getElementById('translatePage');
const stopTranslationBtn= document.getElementById('stopTranslationBtn');
const reTransBtn        = document.getElementById('reTranslatePage');
const clearTransBtn     = document.getElementById('clearTranslations');
const clearCacheBtn     = document.getElementById('clearCache');
const viewLogsBtn       = document.getElementById('viewLogsBtn');
const loadingOverlay    = document.getElementById('loadingOverlay');

const statTranslated    = document.getElementById('statTranslated');
const statPending       = document.getElementById('statPending');
const statApiCalls      = document.getElementById('statApiCalls');
const statCacheHits     = document.getElementById('statCacheHits');

const modelPoolGrid     = document.getElementById('modelPoolGrid');
const modelPoolBadge    = document.getElementById('modelPoolBadge');

let currentKeys = [];
let keyStatuses = {};

// ===== 初始化 =====

async function init() {
  await loadSettings();
  startStatsPolling();
}

async function loadSettings() {
  const res = await bgMessage({ type: 'GET_SETTINGS' });
  currentKeys = Array.isArray(res.keys) ? res.keys : [];
  keyStatuses = res.keyStatuses || {};
  renderKeyList();

  if (res.targetLang) targetLangSel.value = res.targetLang;
  autoTransChk.checked = !!res.autoTranslate;
  const scale = res.fontScale !== undefined ? res.fontScale : 100;
  if (fontScaleInput) fontScaleInput.value = scale;
  if (fontScaleVal) fontScaleVal.textContent = `${scale}%`;
}

// ===== Key 清單渲染與操作 =====

function maskKey(key) {
  if (key.length <= 10) return key;
  return key.substring(0, 6) + '...' + key.substring(key.length - 4);
}

function renderKeyList() {
  keyListContainer.innerHTML = '';
  keyCountBadge.textContent = `${currentKeys.length} 組 Key`;

  if (currentKeys.length === 0) {
    keyListContainer.innerHTML = `
      <div class="empty-keys-tip">
        尚未新增 API Key，請在下方輸入並點擊新增
      </div>
    `;
    return;
  }

  currentKeys.forEach((key, index) => {
    const status = keyStatuses[key] || 'valid';
    const item = document.createElement('div');
    
    // 若額度不足或無效，卡片背景直接標紅
    const isExhausted = status === 'exhausted' || status === 'invalid';
    item.className = `key-item ${isExhausted ? 'exhausted-card' : ''}`;

    let badgeText = '';
    if (status === 'exhausted') badgeText = '<span style="color:#d93025;font-weight:700;margin-left:4px;">(額度不足)</span>';
    else if (status === 'rate_limit') badgeText = '<span style="color:#b06000;margin-left:4px;">(冷卻中)</span>';

    item.innerHTML = `
      <div class="key-text-wrapper">
        <span class="key-dot ${status}" title="狀態: ${statusText(status)}"></span>
        <span class="key-masked-text" title="${key}">#${index + 1} ${maskKey(key)}${badgeText}</span>
      </div>
      <div class="key-actions">
        <button class="btn-icon-sm" data-action="test" data-index="${index}" title="測試連線">測試</button>
        <button class="btn-icon-sm delete" data-action="delete" data-index="${index}" title="刪除">🗑️</button>
      </div>
    `;

    keyListContainer.appendChild(item);
  });

  keyListContainer.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', handleKeyAction);
  });
}

function statusText(st) {
  if (st === 'exhausted') return '額度不足 (今日上限)';
  if (st === 'rate_limit') return '請求過快 (冷卻中)';
  if (st === 'invalid') return '無效金鑰';
  return '連線正常';
}

async function handleKeyAction(e) {
  const action = e.target.dataset.action;
  const index = parseInt(e.target.dataset.index, 10);
  const targetKey = currentKeys[index];

  if (action === 'delete') {
    currentKeys.splice(index, 1);
    delete keyStatuses[targetKey];
    await saveKeysList();
    flashStatus('已刪除 API Key', 'info');
  } else if (action === 'test') {
    e.target.textContent = '...';
    e.target.disabled = true;

    try {
      const res = await bgMessage({ type: 'TEST_SINGLE_KEY', key: targetKey });
      const st = res.status || (res.success ? 'valid' : 'invalid');
      keyStatuses[targetKey] = st;

      if (res.success) {
        flashStatus(`✓ Key #${index + 1} 連線正常！`, 'success');
      } else {
        if (st === 'exhausted') {
          flashStatus(`❌ Key #${index + 1} 額度已用完 (今日上限)`, 'error');
        } else if (st === 'rate_limit') {
          flashStatus(`⚠️ Key #${index + 1} 請求過快 (請等候 ${res.waitSec || 30} 秒)`, 'info');
        } else {
          flashStatus(`❌ Key #${index + 1} API Key 無效`, 'error');
        }
      }
    } catch (err) {
      keyStatuses[targetKey] = 'invalid';
      flashStatus(`❌ 錯誤: ${err.message}`, 'error');
    } finally {
      renderKeyList();
      e.target.textContent = '測試';
      e.target.disabled = false;
    }
  }
}

// 新增 Key
addNewKeyBtn.addEventListener('click', addNewKey);
newKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addNewKey();
});

async function addNewKey() {
  const raw = newKeyInput.value.trim();
  if (!raw) {
    flashStatus('請輸入有效的 Gemini API Key', 'error');
    return;
  }

  const newKeys = raw.split(/[\n,;]+/).map(k => k.trim()).filter(k => k.length > 5);
  if (newKeys.length === 0) {
    flashStatus('輸入的 Key 格式不正確', 'error');
    return;
  }

  let addedCount = 0;
  newKeys.forEach(k => {
    if (!currentKeys.includes(k)) {
      currentKeys.push(k);
      keyStatuses[k] = 'valid';
      addedCount++;
    }
  });

  newKeyInput.value = '';
  await saveKeysList();
  flashStatus(`✓ 成功新增 ${addedCount} 組 API Key！`, 'success');
}

async function saveKeysList() {
  showLoading(true);
  try {
    await bgMessage({ type: 'SAVE_KEYS_LIST', keys: currentKeys });
    renderKeyList();
  } catch (e) {
    flashStatus(`儲存失敗: ${e.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// 翻譯設定自動儲存
targetLangSel.addEventListener('change', autoSaveSettings);
autoTransChk.addEventListener('change', autoSaveSettings);

if (fontScaleInput) {
  fontScaleInput.addEventListener('input', () => {
    if (fontScaleVal) fontScaleVal.textContent = `${fontScaleInput.value}%`;
  });
  fontScaleInput.addEventListener('change', autoSaveSettings);
}

async function autoSaveSettings() {
  try {
    const scale = fontScaleInput ? parseInt(fontScaleInput.value, 10) : 100;
    await bgMessage({
      type: 'SAVE_SETTINGS',
      targetLang: targetLangSel.value,
      autoTranslate: autoTransChk.checked,
      fontScale: scale,
    });
  } catch (e) {
    console.error('設定儲存失敗', e);
  }
}

// 翻譯本頁
translateBtn.addEventListener('click', async () => {
  if (currentKeys.length === 0) {
    flashStatus('請先在上方新增至少一組 Gemini API Key！', 'error');
    return;
  }

  translateBtn.disabled = true;
  translateBtn.textContent = '正在發送任務…';

  try {
    await sendToActiveTab({ type: 'TRANSLATE_PAGE' });
    flashStatus('已啟動本頁漫畫翻譯！', 'success');
  } catch (e) {
    flashStatus(`錯誤：${e.message}`, 'error');
  } finally {
    translateBtn.disabled = false;
    translateBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>翻譯本頁漫畫`;
  }
});

// 停止翻譯按鈕
stopTranslationBtn.addEventListener('click', async () => {
  try {
    await bgMessage({ type: 'STOP_TRANSLATION' });
    flashStatus('⏹️ 已停止所有翻譯與排隊任務', 'info');
  } catch (e) {
    flashStatus(`錯誤：${e.message}`, 'error');
  }
});

reTransBtn.addEventListener('click', async () => {
  try {
    await sendToActiveTab({ type: 'RE_TRANSLATE_PAGE' });
    flashStatus('正在重新翻譯漫畫…', 'info');
  } catch (e) {
    flashStatus(`錯誤：${e.message}`, 'error');
  }
});

clearTransBtn.addEventListener('click', async () => {
  try {
    await sendToActiveTab({ type: 'CLEAR_TRANSLATIONS' });
    flashStatus('翻譯覆蓋層已全部清除', 'success');
    resetStats();
  } catch (e) {
    flashStatus(`錯誤：${e.message}`, 'error');
  }
});

// 檢視除錯日誌
viewLogsBtn.addEventListener('click', async () => {
  try {
    const logs = await bgMessage({ type: 'GET_LOGS' });
    if (!logs || logs.length === 0) {
      alert('目前沒有任何異常除錯日誌。');
      return;
    }
    const text = JSON.stringify(logs, null, 2);
    const win = window.open('', '_blank', 'width=650,height=450');
    win.document.write(`
      <html>
      <head><title>Comic Translator 除錯日誌</title></head>
      <body style="font-family:monospace;font-size:12px;background:#1e1e1e;color:#d4d4d4;padding:16px;margin:0;">
        <h3 style="color:#4ec9b0;margin-top:0;">📋 本地除錯日誌 (最近 ${logs.length} 筆)</h3>
        <pre style="white-space:pre-wrap;word-break:break-all;">${escapeHtml(text)}</pre>
      </body>
      </html>
    `);
  } catch (e) {
    alert(`取得日誌失敗: ${e.message}`);
  }
});

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== 統計更新 =====

let statsInterval = null;

function startStatsPolling() {
  updateStats();
  statsInterval = setInterval(updateStats, 2000);
}

async function updateStats() {
  try {
    const bgStats = await bgMessage({ type: 'GET_STATS' });
    statApiCalls.textContent = bgStats.apiCalls || 0;
    statCacheHits.textContent = bgStats.cacheHits || 0;

    if (bgStats.modelPool) renderModelPool(bgStats.modelPool);

    const tab = await getActiveTab();
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATS' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        statTranslated.textContent = res.translated || 0;
        statPending.textContent = (res.pending || 0) + (bgStats.pendingQueue || 0);
      });
    }
  } catch {}
}

/** 渲染模型池狀態欄 */
function renderModelPool({ models, currentIndex }) {
  if (!models || models.length === 0) return;
  modelPoolBadge.textContent = `${models.length} 個模型`;
  modelPoolGrid.innerHTML = '';
  models.forEach((name, i) => {
    const chip = document.createElement('div');
    chip.className = `model-chip${i === currentIndex ? ' active' : ''}`;
    // 縮短顯示名稱：gemini-3.6-flash -> 3.6 Flash
    const label = name
      .replace('gemini-', '')
      .replace('-flash-lite', ' Flash Lite')
      .replace('-flash', ' Flash')
      .replace('-omni', ' Omni')
      .replace(/^(\d)/, (_, d) => d)  // 保留版本號
      .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    chip.innerHTML = `<span class="model-chip-dot"></span>${label}`;
    chip.title = name + (i === currentIndex ? '（目前使用中）' : '');
    modelPoolGrid.appendChild(chip);
  });
}

function resetStats() {
  statTranslated.textContent = '0';
  statPending.textContent = '0';
}

function showLoading(show) {
  loadingOverlay.classList.toggle('active', show);
}

let flashTimeout = null;
function flashStatus(msg, type = 'info') {
  apiStatusMsg.textContent = msg;
  apiStatusMsg.className = `api-status-msg ${type === 'success' ? 'success' : type === 'error' ? 'error' : 'info'}`;
  if (flashTimeout) clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => { apiStatusMsg.textContent = ''; }, 4500);
}

function bgMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(res || {});
    });
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => resolve(tab));
  });
}

async function sendToActiveTab(msg) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('無法取得當前分頁');
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(res || {});
    });
  });
}

init().catch(console.error);
