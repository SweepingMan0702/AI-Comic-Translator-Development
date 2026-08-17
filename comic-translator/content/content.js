/**
 * content.js - 頁面注入腳本 (原生多圖批次打包與併發佇列控制)
 */

// ===== 全域狀態 =====
let autoTranslate = false;
let targetLang = 'zh-TW';
let hasValidKeys = false;
let isTranslatingAborted = false;
let observer = null;

const imageOverlayMap = new Map();
const processedImages = new WeakSet();
const pendingImages = new WeakSet();

const BATCH_SIZE = 3; // 每 3 張圖片原生批次發送，API 請求直接省 67%~75%

// ===== 初始化 =====

async function init() {
  const settings = await sendMessage({ type: 'GET_SETTINGS' });
  hasValidKeys = Array.isArray(settings.keys) && settings.keys.length > 0;
  targetLang = settings.targetLang || 'zh-TW';
  autoTranslate = settings.autoTranslate || false;

  window.addEventListener('resize', updateAllOverlayPositions, { passive: true });
  window.addEventListener('scroll', updateAllOverlayPositions, { passive: true });

  if (autoTranslate && hasValidKeys) {
    startObserver();
  }
}

init().catch(console.error);

// ===== 訊息監聽 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(e => {
    sendResponse({ error: e.message });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'TRANSLATE_PAGE':
      isTranslatingAborted = false;
      await translateAllImages();
      return { success: true };

    case 'STOP_TRANSLATION':
      isTranslatingAborted = true;
      document.querySelectorAll('.comic-translation-loading').forEach(el => el.remove());
      showNotification('⏹️ 已停止所有翻譯任務', 'warning');
      return { success: true };

    case 'CLEAR_TRANSLATIONS':
      isTranslatingAborted = true;
      clearAllTranslations();
      return { success: true };

    case 'RE_TRANSLATE_PAGE':
      isTranslatingAborted = false;
      clearAllTranslations();
      await translateAllImages();
      return { success: true };

    case 'UPDATE_KEYS':
      hasValidKeys = Array.isArray(msg.keys) && msg.keys.length > 0;
      return { success: true };

    case 'UPDATE_SETTINGS':
      targetLang = msg.targetLang || targetLang;
      autoTranslate = msg.autoTranslate !== undefined ? msg.autoTranslate : autoTranslate;

      if (autoTranslate && hasValidKeys) {
        startObserver();
      } else if (!autoTranslate) {
        stopObserver();
      }
      return { success: true };

    case 'GET_PAGE_STATS':
      return getPageStats();

    default:
      return { error: 'Unknown message type' };
  }
}

// ===== 圖片偵測 =====

function isComicImage(img) {
  const rect = img.getBoundingClientRect();
  const w = rect.width || img.naturalWidth || img.width || 0;
  const h = rect.height || img.naturalHeight || img.height || 0;

  if (w < 160 || h < 160) return false;
  if (w * h < 40000) return false;

  const alt = (img.alt || '').toLowerCase();
  const src = (img.src || img.currentSrc || '').toLowerCase();

  if (['logo', 'icon', 'avatar', 'profile', 'banner', 'ad-', 'advertisement'].some(k => alt.includes(k) || src.includes(k))) {
    return false;
  }

  if (src.startsWith('data:image/svg') || src.endsWith('.svg')) return false;

  return true;
}

function resolveImageSrc(img) {
  const lazyAttrs = ['data-src', 'data-lazy', 'data-original', 'data-url', 'data-image', 'data-lazy-src', 'data-srcset'];
  for (const attr of lazyAttrs) {
    const val = img.getAttribute(attr);
    if (val && !val.startsWith('#')) {
      img.src = val;
      break;
    }
  }
  if (!img.src && img.dataset.srcset) {
    img.srcset = img.dataset.srcset;
  }
}

function waitForImageLoad(img) {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve(img);
      return;
    }
    const onLoad = () => { img.removeEventListener('load', onLoad); resolve(img); };
    const onError = () => { img.removeEventListener('error', onError); resolve(null); };
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
  });
}

function scanImages() {
  const imgs = document.querySelectorAll('img, picture img');
  const result = [];

  imgs.forEach(img => {
    if (processedImages.has(img) || pendingImages.has(img)) return;
    resolveImageSrc(img);
    if (isComicImage(img)) {
      result.push(img);
    }
  });

  return result;
}

async function getLocalImageBase64(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
    const base64 = dataUrl.split(',')[1];
    return { base64, mimeType: 'image/jpeg' };
  } catch (e) {
    return null;
  }
}

// ===== 翻譯主流程 (原生多圖批次) =====

async function translateAllImages() {
  const settings = await sendMessage({ type: 'GET_SETTINGS' });
  if (!settings.keys || settings.keys.length === 0) {
    showNotification('請先在擴充功能中新增 Gemini API Key', 'error');
    return;
  }

  const imgs = scanImages();
  if (imgs.length === 0) {
    showNotification('當前頁面未發現未翻譯的漫畫圖片', 'info');
    return;
  }

  showNotification(`開始原生批次翻譯 ${imgs.length} 張漫畫（省 75% API 請求）…`, 'info');

  // 將圖片以 3 張為一組打包
  const batches = [];
  for (let i = 0; i < imgs.length; i += BATCH_SIZE) {
    batches.push(imgs.slice(i, i + BATCH_SIZE));
  }

  // 採用受控的佇列發送，避免 0 秒內同時轟炸 API
  for (const batch of batches) {
    if (isTranslatingAborted) break;
    translateBatchNative(batch);
  }
}

async function translateBatchNative(imgBatch) {
  const unhandled = imgBatch.filter(img => !processedImages.has(img) && !pendingImages.has(img));
  if (unhandled.length === 0 || isTranslatingAborted) return;

  unhandled.forEach(img => {
    pendingImages.add(img);
    createLoadingOverlay(img);
  });

  try {
    const items = [];
    for (const img of unhandled) {
      await waitForImageLoad(img);
      const url = img.currentSrc || img.src;
      let localData = null;
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        localData = await getLocalImageBase64(img);
      }
      items.push({
        url,
        localBase64: localData?.base64,
        localMimeType: localData?.mimeType,
      });
    }

    if (isTranslatingAborted) {
      unhandled.forEach(removeOverlay);
      return;
    }

    const response = await sendMessage({
      type: 'TRANSLATE_BATCH_IMAGES',
      items,
      targetLang,
    });

    if (isTranslatingAborted) {
      unhandled.forEach(removeOverlay);
      return;
    }

    if (response.error) throw new Error(response.error);

    const results = response.resultsByImage || [];
    unhandled.forEach((img, idx) => {
      const boxes = results[idx] || [];
      showTranslation(img, boxes);
      processedImages.add(img);
    });

  } catch (e) {
    if (!isTranslatingAborted) {
      console.warn('[ComicTranslator 批次異常]:', e.message);
      unhandled.forEach(img => showErrorOnImage(img, e.message));
    } else {
      unhandled.forEach(removeOverlay);
    }
  } finally {
    unhandled.forEach(img => pendingImages.delete(img));
  }
}

// ===== Overlay 浮動層與縮小 10% 圓內接定位 =====

function getOrCreateOverlayContainer(img) {
  let record = imageOverlayMap.get(img);
  if (record && record.containerEl.isConnected) {
    return record.containerEl;
  }

  const container = document.createElement('div');
  container.className = 'comic-translator-overlay-container';
  document.body.appendChild(container);

  const updatePos = () => {
    if (!img.isConnected) {
      container.remove();
      imageOverlayMap.delete(img);
      return;
    }
    const rect = img.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

    container.style.left = `${rect.left + scrollX}px`;
    container.style.top = `${rect.top + scrollY}px`;
    container.style.width = `${rect.width}px`;
    container.style.height = `${rect.height}px`;
    container.style.display = rect.width === 0 || rect.height === 0 ? 'none' : 'block';
  };

  updatePos();

  record = { containerEl: container, updatePos };
  imageOverlayMap.set(img, record);

  return container;
}

function updateAllOverlayPositions() {
  imageOverlayMap.forEach(({ updatePos }) => updatePos());
}

function createLoadingOverlay(img) {
  const container = getOrCreateOverlayContainer(img);
  container.innerHTML = `<div class="comic-translation-loading"></div>`;
  img._comicTransState = 'loading';
}

function showTranslation(img, boxes) {
  const container = getOrCreateOverlayContainer(img);
  container.innerHTML = '';

  if (!boxes || boxes.length === 0) {
    img._comicTransState = 'done';
    return;
  }

  const rect = img.getBoundingClientRect();
  const displayW = rect.width || img.offsetWidth || 800;
  const displayH = rect.height || img.offsetHeight || 1200;

  boxes.forEach((box) => {
    if (!box.translation?.trim()) return;

    const el = document.createElement('div');
    const isVertical = box.direction === 'vertical';
    el.className = `comic-text-block ${isVertical ? 'vertical' : 'horizontal'}`;
    el.title = '按住可拖曳 / 雙擊滑鼠左鍵可編輯文字';

    const rawLeft = (box.xmin / 1000) * displayW;
    const rawTop = (box.ymin / 1000) * displayH;
    const rawRight = (box.xmax / 1000) * displayW;
    const rawBottom = (box.ymax / 1000) * displayH;

    const bubbleWidth = rawRight - rawLeft;
    const bubbleHeight = rawBottom - rawTop;
    const centerX = rawLeft + bubbleWidth / 2;
    const centerY = rawTop + bubbleHeight / 2;

    const width = Math.max(20, Math.round(bubbleWidth * 0.80));
    const height = Math.max(16, Math.round(bubbleHeight * 0.80));

    const left = Math.max(0, Math.round(centerX - width / 2));
    const top = Math.max(0, Math.round(centerY - height / 2));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;

    const textSpan = document.createElement('span');
    textSpan.className = 'comic-text-content';
    textSpan.textContent = box.translation;
    el.appendChild(textSpan);

    const textLen = box.translation.length || 1;
    const boxArea = width * height;
    const estFontSize = Math.sqrt(boxArea / (textLen * 1.3));
    const fontSize = Math.max(10, Math.min(22, Math.round(estFontSize)));
    el.style.fontSize = `${fontSize}px`;

    makeDraggable(el);
    setupEditable(el, textSpan);

    container.appendChild(el);
  });

  const done = document.createElement('div');
  done.className = 'comic-translation-done';
  done.textContent = '✓';
  container.appendChild(done);

  img._comicTransState = 'done';
}

function setupEditable(el, textSpan) {
  let isEditing = false;

  const startEdit = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (isEditing) return;

    isEditing = true;
    el.classList.add('editing');
    textSpan.contentEditable = 'true';
    textSpan.focus();

    const range = document.createRange();
    range.selectNodeContents(textSpan);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const endEdit = () => {
    if (!isEditing) return;
    isEditing = false;
    el.classList.remove('editing');
    textSpan.contentEditable = 'false';
  };

  el.addEventListener('dblclick', startEdit);

  textSpan.addEventListener('blur', endEdit);
  textSpan.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      endEdit();
    } else if (e.key === 'Escape') {
      endEdit();
    }
  });
}

function makeDraggable(el) {
  let isDragging = false;
  let startMouseX = 0;
  let startMouseY = 0;
  let startLeft = 0;
  let startTop = 0;

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (el.classList.contains('editing')) return;

    e.preventDefault();
    e.stopPropagation();

    isDragging = true;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop = parseFloat(el.style.top) || 0;

    const onMouseMove = (moveEvent) => {
      if (!isDragging) return;
      const deltaX = moveEvent.clientX - startMouseX;
      const deltaY = moveEvent.clientY - startMouseY;
      el.style.left = `${startLeft + deltaX}px`;
      el.style.top = `${startTop + deltaY}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function showErrorOnImage(img, message) {
  if (img._comicTransState === 'done') return;

  const container = getOrCreateOverlayContainer(img);
  
  let badgeText = '⚠ 翻譯失敗 (點擊重試)';
  if (message.includes('用完') || message.includes('上限') || message.includes('exhausted')) {
    badgeText = '🛑 額度用完了';
  } else if (message.includes('過快') || message.includes('rate_limit') || message.includes('429')) {
    badgeText = '⏳ 請求過快 (冷卻中)';
  }

  const oldLoading = container.querySelector('.comic-translation-loading');
  if (oldLoading) oldLoading.remove();

  const oldBadge = container.querySelector('.comic-translation-quota-badge');
  if (oldBadge) oldBadge.remove();

  const badgeEl = document.createElement('div');
  badgeEl.className = 'comic-translation-quota-badge';
  badgeEl.title = escHtml(message);
  badgeEl.textContent = badgeText;
  badgeEl.onclick = (e) => {
    e.stopPropagation();
    badgeEl.remove();
    processedImages.delete(img);
    translateBatchNative([img]);
  };

  container.appendChild(badgeEl);
  img._comicTransState = 'error';
}

function removeOverlay(img) {
  const record = imageOverlayMap.get(img);
  if (record) {
    record.containerEl.remove();
    imageOverlayMap.delete(img);
  }
  img._comicTransState = null;
}

function clearAllTranslations() {
  imageOverlayMap.forEach(({ containerEl }) => containerEl.remove());
  imageOverlayMap.clear();
  document.querySelectorAll('img').forEach(img => {
    img._comicTransState = null;
    processedImages.delete(img);
    pendingImages.delete(img);
  });
}

// ===== MutationObserver =====

function startObserver() {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    if (!autoTranslate || !hasValidKeys || isTranslatingAborted) return;

    const newImgs = [];
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName === 'IMG') {
          newImgs.push(node);
        } else if (node.querySelectorAll) {
          node.querySelectorAll('img').forEach(img => newImgs.push(img));
        }
      });
    });

    const validNewImgs = [];
    newImgs.forEach(img => {
      resolveImageSrc(img);
      if (isComicImage(img) && !processedImages.has(img) && !pendingImages.has(img)) {
        validNewImgs.push(img);
      }
    });

    if (validNewImgs.length > 0) {
      for (let i = 0; i < validNewImgs.length; i += BATCH_SIZE) {
        translateBatchNative(validNewImgs.slice(i, i + BATCH_SIZE));
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

// ===== 統計與通知 =====

function getPageStats() {
  const all = document.querySelectorAll('img');
  let translated = 0, errors = 0, pending = 0;

  all.forEach(img => {
    if (img._comicTransState === 'done') translated++;
    else if (img._comicTransState === 'error') errors++;
    else if (img._comicTransState === 'loading') pending++;
  });

  return { translated, errors, pending };
}

function showNotification(message, type = 'info') {
  const existing = document.getElementById('comic-trans-notification');
  if (existing) existing.remove();

  const colors = { info: '#4285f4', success: '#34a853', error: '#ea4335', warning: '#fbbc05' };
  const el = document.createElement('div');
  el.id = 'comic-trans-notification';
  el.style.cssText = `
    position: fixed !important; top: 20px !important; right: 20px !important; z-index: 2147483647 !important;
    background: ${colors[type] || colors.info} !important; color: white !important;
    padding: 10px 18px !important; border-radius: 8px !important; font-size: 14px !important;
    font-family: 'Noto Sans TC', sans-serif !important; font-weight: 500 !important;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25) !important; max-width: 320px !important;
    animation: comic-slide-in 0.3s ease-out !important;
  `;
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => el.remove(), 3500);
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response || {});
      }
    });
  });
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
