/**
 * gemini.js - Gemini 原生多圖批次視覺翻譯 (Multi-Image Batch API)
 * 1. 採用 Google 官方原生多圖陣列輸入 (不需 Canvas 拼接，100% 免疫跨域 CORS)
 * 2. 1 次 API 請求直接辨識翻譯 3~4 張漫畫圖片，配額消耗直接減少 75%
 * 3. 支援多 Key 平行調度與自動故障轉移 (Failover)
 */

import { logErrorToStorage, markKeyStatus } from './storage.js';

const INTERACTIONS_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GENERATE_CONTENT_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const MULTI_MODEL_POOL = [
  'gemini-3.6-flash',       // 主力：最新 3.6 世代
  'gemini-3.7-flash',       // 備援 1：最新 3.7 世代
  'gemini-3.5-flash',       // 備援 2：3.5 穩定版
  'gemini-3.5-flash-lite',  // 備援 3：3.5 輕量版（超省配額）
  'gemini-3.1-flash-lite',  // 備援 4：3.1 輕量版
];

let currentModelIndex = 0;

/** 回傳目前模型池狀態，供外部查詢 */
export function getModelPoolStatus() {
  return {
    models: MULTI_MODEL_POOL,
    currentIndex: currentModelIndex,
    currentModel: MULTI_MODEL_POOL[currentModelIndex],
  };
}

const LANG_NAMES = {
  'zh-TW': '繁體中文',
  'zh-CN': '簡體中文',
  'en': '英文',
  'ja': '日文',
  'ko': '韓文',
};

export class GeminiError extends Error {
  constructor(message, code, type, retryAfterSeconds = 0) {
    super(message);
    this.code = code;
    this.type = type;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function categorizeQuotaError(errorMsg, status) {
  if (status === 401 || status === 403) {
    return { type: 'auth', message: 'API Key 無效或已被撤銷', waitSec: 0 };
  }

  const msg = errorMsg || '';
  const match = msg.match(/retry in\s+([0-9.]+)\s*s/i);
  const waitSec = match ? Math.ceil(parseFloat(match[1])) : 30;

  if (
    msg.includes('free_tier_requests') && waitSec > 120 ||
    msg.includes('daily_limit') ||
    msg.includes('limit: 0') ||
    msg.includes('quota exceeded for your project')
  ) {
    return { type: 'exhausted', message: 'API 額度已用完 (已達今日免費上限)', waitSec };
  }

  if (status === 429 || msg.includes('429') || msg.includes('rate_limit') || msg.includes('RESOURCE_EXHAUSTED')) {
    return { type: 'rate_limit', message: `請求過快 (請等候 ${waitSec} 秒後重試)`, waitSec };
  }

  return { type: 'unknown', message: msg || '未知錯誤', waitSec: 0 };
}

function parseBoxCoordinates(item) {
  let ymin = null, xmin = null, ymax = null, xmax = null;

  const boxArray = item.box_2d || item.box || item.bbox || item.bounding_box;
  if (Array.isArray(boxArray) && boxArray.length >= 4) {
    ymin = Number(boxArray[0]);
    xmin = Number(boxArray[1]);
    ymax = Number(boxArray[2]);
    xmax = Number(boxArray[3]);
  }

  if (ymin === null || isNaN(ymin)) {
    if (item.ymin !== undefined && item.xmin !== undefined) {
      ymin = Number(item.ymin);
      xmin = Number(item.xmin);
      ymax = Number(item.ymax !== undefined ? item.ymax : ymin + (item.height || 60));
      xmax = Number(item.xmax !== undefined ? item.xmax : xmin + (item.width || 100));
    }
  }

  if (ymin === null || isNaN(ymin)) {
    if (item.top !== undefined && item.left !== undefined) {
      ymin = Number(item.top);
      xmin = Number(item.left);
      ymax = Number(item.bottom !== undefined ? item.bottom : ymin + (item.height || 60));
      xmax = Number(item.right !== undefined ? item.right : xmin + (item.width || 100));
    }
  }

  if (ymin === null || isNaN(ymin)) {
    if (item.y !== undefined && item.x !== undefined) {
      ymin = Number(item.y);
      xmin = Number(item.x);
      const w = Number(item.width || item.w || 100);
      const h = Number(item.height || item.h || 60);
      ymax = ymin + h;
      xmax = xmin + w;
    }
  }

  if (ymin === null || isNaN(ymin) || xmin === null || isNaN(xmin)) {
    return { ymin: 350, xmin: 200, ymax: 550, xmax: 800, isFallback: true };
  }

  if (ymin <= 1.0 && xmin <= 1.0 && ymax <= 1.0 && xmax <= 1.0 && (ymax > 0 || xmax > 0)) {
    ymin *= 1000;
    xmin *= 1000;
    ymax *= 1000;
    xmax *= 1000;
  }

  ymin = Math.max(0, Math.min(1000, Math.round(ymin)));
  xmin = Math.max(0, Math.min(1000, Math.round(xmin)));
  ymax = Math.max(ymin + 15, Math.min(1000, Math.round(ymax)));
  xmax = Math.max(xmin + 15, Math.min(1000, Math.round(xmax)));

  return { ymin, xmin, ymax, xmax, isFallback: false };
}

/**
 * 原生多圖批次翻譯 (一次處理 1~4 張圖片)
 * @param {string} apiKey
 * @param {Array<{base64: string, mimeType: string, index: number}>} imagesList
 * @param {string} targetLang
 */
export async function detectAndTranslateMultiImages(apiKey, imagesList, targetLang) {
  const langName = LANG_NAMES[targetLang] || '繁體中文';

  const prompt = `你是專業漫畫在地化翻譯與視覺對白偵測專家。請分析這 ${imagesList.length} 張漫畫圖片，精準定位每張圖片中的所有對話框與旁白文字，並將台詞翻譯成${langName}。

【標準化座標與辨識規範】：
1. 圖片索引：使用 image_index (0 到 ${imagesList.length - 1}) 精確標記該對白所屬的圖片。
2. 座標格式【極重要，必須嚴格遵守】：
   - 請統一使用 "box_2d": [ymin, xmin, ymax, xmax]，數值為 0 到 1000 的整數。
   - ymin = 對白氣泡或文字框的最頂端 (Top, 0~1000)
   - xmin = 對白氣泡或文字框的最左側 (Left, 0~1000)
   - ymax = 對白氣泡或文字框的最底端 (Bottom, 0~1000)
   - xmax = 對白氣泡或文字框的最右側 (Right, 0~1000)
   - 請務必遵守 [Top, Left, Bottom, Right] 順序，確保 ymin < ymax 且 xmin < xmax，嚴禁 X 與 Y 順序顛倒。
3. 框選目標基準：
   - 請框選「對話氣泡 (Speech Bubble) 或旁白框的完整外輪廓邊界 (Outer Border)」，而非僅框選文字本體，以確保翻譯覆蓋層能精準貼合氣泡中心。
4. 對白框類型涵蓋：
   - 涵蓋所有類型：一般圓橢氣泡、方形旁白框、黑色陰影/放射狀情緒框 (Burst / Glow Bubbles)、尖刺呼喊框 (Jagged Bubbles)、以及被切片裁切的邊緣殘缺氣泡。
5. 排除純音效：
   - 僅略過無外框的純背景狀聲擬音詞（如 ドン、ドドド、쾅、Crash、BAM 等），若音效外圍有對白氣泡或屬台詞則仍須翻譯。
6. 排版方向 (direction)：
   - 直排文字標記 "vertical"，橫排文字標記 "horizontal"。
7. 原文與翻譯：
   - original_text: 提取對白原文
   - translation: 翻譯成自然的${langName}

請嚴格回傳純 JSON 陣列，不包含額外文字或解釋：
[
  {
    "image_index": 0,
    "box_2d": [120, 350, 260, 580],
    "original_text": "살려둘 필요는 없다",
    "translation": "不需要留活口",
    "direction": "horizontal"
  }
]`;

  const raw = await callGeminiWithModelPool(apiKey, prompt, imagesList);
  const parsed = parseJSON(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(item => item && (item.translation || item.text))
    .map(item => {
      const translation = String(item.translation || item.text || '').trim();
      const coords = parseBoxCoordinates(item);
      const imgIdx = Number(item.image_index !== undefined ? item.image_index : 0);

      const boxH = coords.ymax - coords.ymin;
      const boxW = coords.xmax - coords.xmin;

      let direction = item.direction;
      if (direction !== 'vertical' && direction !== 'horizontal') {
        direction = (boxH / boxW) >= 1.25 ? 'vertical' : 'horizontal';
      }

      return {
        imageIndex: isNaN(imgIdx) ? 0 : Math.max(0, Math.min(imagesList.length - 1, imgIdx)),
        translation,
        ...coords,
        direction,
      };
    });
}

async function callGeminiWithModelPool(apiKey, prompt, imagesList) {
  let lastError = null;

  for (let i = 0; i < MULTI_MODEL_POOL.length; i++) {
    const modelIdx = (currentModelIndex + i) % MULTI_MODEL_POOL.length;
    const modelName = MULTI_MODEL_POOL[modelIdx];

    try {
      const result = await callInteractionsApi(apiKey, modelName, prompt, imagesList);
      currentModelIndex = (modelIdx + 1) % MULTI_MODEL_POOL.length;
      return result;
    } catch (err) {
      const isUnavailable = err.type === 'rate_limit' || err.type === 'exhausted' || err.code === 404 || err.message?.includes('no longer available');
      
      // 寫入本地除錯日誌，記錄模型不可用或報錯詳情
      await logErrorToStorage('MODEL_FAILOVER', {
        model: modelName,
        status: err.code || err.type || 'error',
        reason: err.message,
        action: isUnavailable ? '自動切換下一個模型' : '拋出例外',
        time: new Date().toLocaleTimeString(),
      });

      if (isUnavailable) {
        console.warn(`[ComicTranslator] 模型 ${modelName} 無法使用 (${err.message})，自動切換下一個模型...`);
        lastError = err;
        continue;
      }
      lastError = err;
    }
  }

  if (lastError?.type === 'exhausted') {
    await markKeyStatus(apiKey, 'exhausted');
  }

  await logErrorToStorage('ALL_MODELS_FAILED', {
    triedModels: MULTI_MODEL_POOL,
    lastError: lastError?.message || '未知錯誤',
    time: new Date().toLocaleTimeString(),
  });

  throw lastError || new GeminiError('所有模型均呼叫失敗', 0, 'unknown');
}

async function callInteractionsApi(apiKey, modelName, prompt, imagesList) {
  const url = `${INTERACTIONS_API_URL}?key=${apiKey}`;

  const inputParts = [{ type: 'text', text: prompt }];

  imagesList.forEach(img => {
    inputParts.push({
      type: 'image',
      data: img.base64,
      mime_type: img.mimeType || 'image/jpeg',
    });
  });

  const body = {
    model: modelName,
    input: inputParts,
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new GeminiError('網路連線失敗', 0, 'network');
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || response.statusText;
    const { type, message, waitSec } = categorizeQuotaError(msg, response.status);
    throw new GeminiError(message, response.status, type, waitSec);
  }

  const data = await response.json();

  if (Array.isArray(data?.steps)) {
    const modelOutputs = data.steps.filter(s => s.type === 'model_output');
    for (const step of modelOutputs) {
      if (Array.isArray(step.content)) {
        const textPart = step.content.find(c => c.type === 'text' && c.text);
        if (textPart) return textPart.text;
      }
    }
  }

  if (data?.output_text) return data.output_text;

  throw new GeminiError('未回傳有效內容', 0, 'parse');
}

function parseJSON(raw) {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (match) {
      return JSON.parse(match[1]);
    }
    throw new GeminiError(`無法解析 JSON 回應：${text.slice(0, 150)}`, 0, 'parse');
  }
}

export async function testSingleApiKey(key) {
  try {
    const result = await callInteractionsApi(key, MULTI_MODEL_POOL[0], '請回覆 "OK" 兩個字。', []);
    await markKeyStatus(key, 'valid');
    return {
      success: result.trim().length > 0,
      status: 'valid',
      message: '✓ API Key 連線正常',
    };
  } catch (err) {
    const st = err.type || 'invalid';
    await markKeyStatus(key, st);
    return {
      success: false,
      status: st,
      message: err.message,
      waitSec: err.retryAfterSeconds || 0,
    };
  }
}
