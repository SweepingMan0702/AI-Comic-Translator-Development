/**
 * overlay.js - 翻譯覆蓋層建立與管理
 */

/**
 * 在圖片元素上建立翻譯覆蓋層，顯示 loading 狀態
 * @param {HTMLImageElement} imgElement
 * @returns {HTMLElement} wrapperEl
 */
export function createLoadingOverlay(imgElement) {
  ensureWrapper(imgElement);
  const layer = getOrCreateLayer(imgElement);

  // 清除舊內容
  layer.innerHTML = '';

  const loader = document.createElement('div');
  loader.className = 'comic-translation-loading';
  layer.appendChild(loader);

  imgElement._comicTransState = 'loading';
  return layer;
}

/**
 * 顯示翻譯結果
 * @param {HTMLImageElement} imgElement
 * @param {Array<{x, y, width, height, translation}>} boxes
 */
export function showTranslationOverlay(imgElement, boxes) {
  const layer = getOrCreateLayer(imgElement);
  layer.innerHTML = '';

  if (!boxes || boxes.length === 0) {
    imgElement._comicTransState = 'done';
    return;
  }

  const naturalW = imgElement.naturalWidth || imgElement.width || 1;
  const naturalH = imgElement.naturalHeight || imgElement.height || 1;
  const displayW = imgElement.offsetWidth || imgElement.width || naturalW;
  const displayH = imgElement.offsetHeight || imgElement.height || naturalH;

  const scaleX = displayW / naturalW;
  const scaleY = displayH / naturalH;

  boxes.forEach(box => {
    if (!box.translation || !box.translation.trim()) return;

    const el = document.createElement('div');
    el.className = 'comic-text-block';

    const left = box.x * scaleX;
    const top = box.y * scaleY;
    const width = box.width * scaleX;
    const height = box.height * scaleY;

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.textContent = box.translation;

    // 自動縮放字體：以高度為基準，最小 9px，最大 18px
    const fontSize = Math.max(9, Math.min(18, height * 0.28));
    el.style.fontSize = `${fontSize}px`;

    layer.appendChild(el);
  });

  // 顯示完成標記（2秒後淡出）
  const done = document.createElement('div');
  done.className = 'comic-translation-done';
  done.textContent = '✓';
  layer.appendChild(done);

  imgElement._comicTransState = 'done';
}

/**
 * 顯示錯誤狀態
 */
export function showErrorOverlay(imgElement, errorMessage) {
  const layer = getOrCreateLayer(imgElement);
  layer.innerHTML = '';

  const errEl = document.createElement('div');
  errEl.className = 'comic-translation-error';
  errEl.textContent = '⚠';
  errEl.title = errorMessage || '翻譯失敗';
  layer.appendChild(errEl);

  imgElement._comicTransState = 'error';
}

/**
 * 移除翻譯覆蓋層
 */
export function clearOverlay(imgElement) {
  const layer = imgElement._comicTransLayer;
  if (layer) {
    layer.innerHTML = '';
    layer.remove();
    delete imgElement._comicTransLayer;
  }

  // 解除 wrapper（若圖片原本無 relative parent，還原其 parent）
  const wrapper = imgElement.parentElement;
  if (wrapper && wrapper.classList.contains('comic-translation-wrapper')) {
    // 將圖片移出 wrapper，還原 DOM
    wrapper.parentElement?.insertBefore(imgElement, wrapper);
    wrapper.remove();
  }

  imgElement._comicTransState = null;
}

/**
 * 移除頁面上所有翻譯覆蓋層
 */
export function clearAllOverlays() {
  document.querySelectorAll('.comic-translation-layer').forEach(el => el.remove());
  document.querySelectorAll('img[data-comic-trans-id]').forEach(img => {
    img._comicTransState = null;
    img._comicTransLayer = null;
  });
  // 還原 wrapper
  document.querySelectorAll('.comic-translation-wrapper').forEach(wrapper => {
    const img = wrapper.querySelector('img');
    if (img) wrapper.parentElement?.insertBefore(img, wrapper);
    wrapper.remove();
  });
}

// ===== 內部工具函式 =====

/**
 * 確保圖片被包在 relative wrapper 中
 */
function ensureWrapper(imgElement) {
  const parent = imgElement.parentElement;
  if (!parent) return;

  // 若 parent 已是 wrapper 或已有 relative/absolute 定位，不需要額外包裝
  const parentStyle = window.getComputedStyle(parent);
  const parentPos = parentStyle.position;

  if (
    parent.classList.contains('comic-translation-wrapper') ||
    parentPos === 'relative' ||
    parentPos === 'absolute' ||
    parentPos === 'fixed' ||
    parentPos === 'sticky'
  ) {
    return;
  }

  // 建立 wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'comic-translation-wrapper';

  // 複製圖片相關樣式到 wrapper
  const imgStyle = window.getComputedStyle(imgElement);
  wrapper.style.display = imgStyle.display === 'block' ? 'block' : 'inline-block';
  wrapper.style.maxWidth = '100%';

  parent.insertBefore(wrapper, imgElement);
  wrapper.appendChild(imgElement);
}

/**
 * 取得或建立圖片的 overlay layer
 */
function getOrCreateLayer(imgElement) {
  if (imgElement._comicTransLayer) {
    return imgElement._comicTransLayer;
  }

  const layer = document.createElement('div');
  layer.className = 'comic-translation-layer';

  const parent = imgElement.parentElement;
  if (parent) {
    parent.appendChild(layer);
  }

  imgElement._comicTransLayer = layer;
  return layer;
}
