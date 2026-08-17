/**
 * translator.js - 翻譯佇列與並發控制
 * Queue System + Rate Limiter（最多同時 3 張圖片）
 */

import { extractTextFromImage, translateTexts } from './gemini.js';
import { getCachedOCR, setCachedOCR, getCachedTranslation, setCachedTranslation } from './storage.js';
import { getCacheKey, imageToBase64 } from './cache.js';

const MAX_CONCURRENT = 3;      // 最大並發數
const REQUEST_INTERVAL_MS = 500; // 兩次 API 請求間最小間隔 (ms)

export class TranslationQueue {
  constructor({ apiKey, targetLang, onProgress, onError }) {
    this.apiKey = apiKey;
    this.targetLang = targetLang;
    this.onProgress = onProgress || (() => {});
    this.onError = onError || (() => {});

    this._queue = [];          // 待處理任務
    this._running = 0;         // 正在執行的任務數
    this._lastRequestTime = 0; // 上次 API 請求時間
    this._stats = {
      total: 0,
      completed: 0,
      failed: 0,
      apiCalls: 0,
      cacheHits: 0,
    };
  }

  /**
   * 加入翻譯任務
   * @param {HTMLImageElement} imgElement
   * @returns {Promise<TranslationResult | null>}
   */
  enqueue(imgElement) {
    return new Promise((resolve, reject) => {
      this._queue.push({ imgElement, resolve, reject });
      this._stats.total++;
      this._pump();
    });
  }

  /**
   * 取消所有待處理任務
   */
  clear() {
    const pending = this._queue.splice(0);
    pending.forEach(({ resolve }) => resolve(null));
    this._stats = { total: 0, completed: 0, failed: 0, apiCalls: 0, cacheHits: 0 };
  }

  get stats() { return { ...this._stats }; }

  // ===== 內部方法 =====

  _pump() {
    while (this._running < MAX_CONCURRENT && this._queue.length > 0) {
      const task = this._queue.shift();
      this._running++;
      this._executeTask(task).finally(() => {
        this._running--;
        this._pump();
      });
    }
  }

  async _executeTask({ imgElement, resolve, reject }) {
    try {
      const result = await this._translateImage(imgElement);
      this._stats.completed++;
      this.onProgress(this._stats);
      resolve(result);
    } catch (e) {
      this._stats.failed++;
      this.onError(e, imgElement);
      this.onProgress(this._stats);
      reject(e);
    }
  }

  async _throttle() {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    if (elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - elapsed);
    }
    this._lastRequestTime = Date.now();
  }

  async _translateImage(imgElement) {
    const url = imgElement.currentSrc || imgElement.src;
    if (!url) return null;

    const cacheKey = await getCacheKey(url);
    if (!cacheKey) return null;

    // ---- Phase 1: OCR（嘗試快取）----
    let ocrResult = await getCachedOCR(cacheKey);
    if (!ocrResult) {
      const { base64, mimeType } = await imageToBase64(imgElement);
      await this._throttle();
      this._stats.apiCalls++;

      ocrResult = await extractTextFromImage(this.apiKey, base64, mimeType);
      await setCachedOCR(cacheKey, ocrResult);
    } else {
      this._stats.cacheHits++;
    }

    if (!ocrResult || ocrResult.length === 0) {
      return { boxes: [], translations: [] };
    }

    // ---- Phase 2: 翻譯（嘗試快取）----
    let translationResult = await getCachedTranslation(cacheKey, this.targetLang);
    if (!translationResult) {
      const texts = ocrResult.map(b => b.text);
      await this._throttle();
      this._stats.apiCalls++;

      translationResult = await translateTexts(this.apiKey, texts, this.targetLang);
      await setCachedTranslation(cacheKey, this.targetLang, translationResult);
    } else {
      this._stats.cacheHits++;
    }

    // 將翻譯結果與 bounding box 合併
    const boxes = ocrResult.map((box, i) => {
      const trans = translationResult.find(t => t.original === box.text)
        || translationResult[i]
        || { translation: box.text };
      return {
        ...box,
        translation: trans.translation || box.text,
      };
    });

    return { boxes, translations: translationResult };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
