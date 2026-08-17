/**
 * cache.js - 圖片 Hash 計算與快取 Key 管理
 */

/**
 * 以 SHA-256 雜湊 URL 字串，回傳 hex 字串
 */
export async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 取得圖片 URL 的快取 Key
 * 若 URL 過長則進行 hash，否則直接使用 URL（方便除錯）
 */
export async function getCacheKey(imageUrl) {
  if (!imageUrl || imageUrl === '') return null;

  // 移除 query string 中常見的時間戳參數，使快取更穩定
  try {
    const url = new URL(imageUrl);
    ['t', 'ts', 'timestamp', 'v', 'version', '_'].forEach(p => url.searchParams.delete(p));
    const cleanUrl = url.toString();
    return await hashString(cleanUrl);
  } catch {
    // 非標準 URL（如 data:URL）直接 hash
    return await hashString(imageUrl);
  }
}

/**
 * 嘗試從 Canvas 取得圖片內容 hash（適用於 CORS 允許的圖片）
 * 失敗時 fallback 到 URL hash
 */
export async function getImageContentHash(imgElement) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // 縮小取樣以加速 hash
    const sampleSize = 64;
    canvas.width = sampleSize;
    canvas.height = sampleSize;

    ctx.drawImage(imgElement, 0, 0, sampleSize, sampleSize);
    const dataUrl = canvas.toDataURL('image/png', 0.1);
    return await hashString(dataUrl);
  } catch {
    // CORS 限制或其他錯誤時，fallback 到 URL hash
    return await getCacheKey(imgElement.src || imgElement.currentSrc || '');
  }
}

/**
 * 將圖片轉為 Base64（用於送給 Gemini API）
 * 支援跨域圖片（透過 canvas）
 */
export async function imageToBase64(imgElement) {
  const url = imgElement.currentSrc || imgElement.src;

  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error('fetch failed');
    const blob = await response.blob();
    return await blobToBase64(blob);
  } catch {
    // Fallback: 用 canvas 繪製
    return canvasToBase64(imgElement);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve({ base64, mimeType: blob.type || 'image/jpeg' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function canvasToBase64(imgElement) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgElement.naturalWidth || imgElement.width;
      canvas.height = imgElement.naturalHeight || imgElement.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgElement, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, mimeType: 'image/jpeg' });
    } catch (e) {
      reject(e);
    }
  });
}
