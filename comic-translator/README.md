# Comic Translator — AI 漫畫即時翻譯 Chrome Extension

![版本](https://img.shields.io/badge/版本-1.0.0-blue)
![Manifest](https://img.shields.io/badge/Manifest-V3-green)
![Gemini](https://img.shields.io/badge/Gemini-2.0%20Flash-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

> 使用 **Google Gemini 2.0 Flash Vision AI** 即時翻譯漫畫圖片中的文字，並以透明文字覆蓋層顯示在原圖上，讓你無需離開漫畫網站即可閱讀翻譯內容。

---

## ✨ 功能特色

| 功能 | 說明 |
|------|------|
| 🔍 **AI OCR 辨識** | 使用 Gemini Vision 辨識對話框、旁白、擬聲詞位置 |
| 📍 **精準 Overlay** | 翻譯文字以透明覆蓋層對齊原文位置，保留原圖視覺 |
| 🌐 **五語言支援** | 繁體中文、簡體中文、英文、日文、韓文 |
| ⚡ **雙層快取** | OCR 與翻譯分別快取（IndexedDB），避免重複 API 呼叫 |
| 🤖 **自動翻譯模式** | MutationObserver 監聽新圖片，滾動載入自動翻譯 |
| 🔒 **純前端架構** | 無後端伺服器，所有處理在瀏覽器端完成 |
| 🚦 **並發控制** | Queue + Rate Limiter，最多同時處理 3 張圖片 |

---

## 📁 專案結構

```
comic-translator/
├── manifest.json               # Chrome Extension 配置（Manifest V3）
├── README.md                   # 本說明文件
│
├── popup/                      # Extension Popup 介面
│   ├── popup.html              # 主介面 HTML
│   ├── popup.js                # Popup 邏輯（設定、統計、按鈕）
│   └── popup.css               # Material Design 風格樣式
│
├── content/                    # 注入頁面的腳本
│   ├── content.js              # 圖片偵測、Overlay 管理、訊息處理
│   ├── overlay.js              # Overlay 建立工具函式（備用模組）
│   └── content.css             # Overlay 層樣式
│
├── background/                 # Service Worker
│   └── background.js           # 翻譯佇列、API 呼叫、快取協調
│
├── lib/                        # 共用函式庫
│   ├── gemini.js               # Gemini API 封裝（OCR + 翻譯）
│   ├── translator.js           # TranslationQueue 類別（備用）
│   ├── storage.js              # Chrome Storage + IndexedDB 封裝
│   └── cache.js                # 圖片 Hash（SHA-256）+ Base64 工具
│
└── assets/
    └── icons/                  # Extension 圖示
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## 🚀 安裝方式

### 方法一：開發者模式直接載入（推薦用於開發測試）

1. 下載或 clone 本專案至本機
2. 開啟 Chrome，網址列輸入 `chrome://extensions/`
3. 右上角開啟「**開發人員模式**」(Developer mode)
4. 點擊「**載入未封裝項目**」(Load unpacked)
5. 選擇 `comic-translator` **資料夾**（包含 `manifest.json` 的那層）
6. Extension 圖示出現在工具列即安裝成功 ✅

### 方法二：打包成 .crx 檔案（用於分發）

```powershell
# 在 Chrome Extensions 頁面操作：
# 1. 前往 chrome://extensions/
# 2. 開啟「開發人員模式」
# 3. 點擊「封裝擴充功能」(Pack Extension)
# 4. 選擇 comic-translator 資料夾
# 5. 會產生 comic-translator.crx 與 comic-translator.pem
```

> ⚠️ **注意**：Chrome Web Store 正式發佈需要開發者帳號（$5 美元一次性費用）

### 方法三：ZIP 壓縮（用於 Chrome Web Store 上傳）

```powershell
# PowerShell 壓縮
Compress-Archive -Path "comic-translator\*" -DestinationPath "comic-translator-v1.0.0.zip"
```

上傳至 [Chrome Web Store 開發者後台](https://chrome.google.com/webstore/devconsole/)

---

## ⚙️ 初次設定

### 步驟 1：取得 Gemini API Key

1. 前往 [Google AI Studio](https://aistudio.google.com/)
2. 使用 **Google 帳號**登入
3. 點擊左側「**Get API Key**」
4. 點擊「**Create API Key**」建立新金鑰
5. 複製 API Key（格式類似 `AIzaSy...`）

> ⚡ **免費額度充足**：Gemini 2.0 Flash 每分鐘 15 次請求，每天 1,500 次，一般漫畫閱讀完全足夠

### 步驟 2：設定 Extension

1. 點擊 Chrome 工具列的 Extension 圖示
2. 在「Gemini API Key」欄位貼上 API Key
3. 點擊「**測試連線**」確認有效
4. 點擊「**儲存**」
5. 選擇目標翻譯語言（預設：繁體中文）

---

## 📖 使用方式

### 基本操作

| 操作 | 方法 |
|------|------|
| **翻譯頁面所有漫畫** | 點擊 Popup → 「翻譯本頁漫畫」 |
| **清除翻譯覆蓋層** | 點擊 Popup → 「清除翻譯」 |
| **重新翻譯** | 點擊 Popup → 「重新翻譯」（清除後重新呼叫 API） |
| **自動翻譯新圖片** | 開啟「自動翻譯新圖片」開關，滾動時自動處理 |
| **清除快取** | Popup 底部「清除快取」（下次翻譯重新呼叫 API） |

### 翻譯流程示意

```
頁面圖片
  │
  ▼
Content Script 偵測（MutationObserver）
  │  過濾 < 100×100px 的圖示
  ▼
Background Service Worker
  │
  ├─ 快取命中？──YES──► 直接使用快取結果
  │
  NO
  │
  ▼
Gemini Phase 1：OCR + Bounding Box
  │  回傳：[{text, x, y, width, height}]
  │  儲存至 IndexedDB
  ▼
Gemini Phase 2：翻譯
  │  回傳：[{original, translation}]
  │  儲存至 IndexedDB
  ▼
Content Script 建立 Overlay
  │  依 Bounding Box 計算縮放比例
  ▼
顯示透明文字覆蓋層（保留原圖）
```

---

## 🔧 技術架構

### 技術選型

| 技術 | 用途 |
|------|------|
| **Manifest V3** | 現代 Chrome Extension 架構 |
| **Gemini 2.0 Flash** | Vision AI（OCR + 翻譯，同一模型） |
| **MutationObserver** | 動態監聽 DOM，偵測 lazy-load 圖片 |
| **IndexedDB** | OCR 與翻譯結果持久化快取 |
| **Chrome Storage Local** | API Key 與使用者設定儲存 |
| **SubtleCrypto SHA-256** | 圖片 URL Hash，作為快取 Key |
| **Service Worker** | 背景任務佇列，並發上限 3 張 |

### Gemini Prompt 策略

**Phase 1 — OCR（辨識文字位置）**
```
請分析漫畫圖片，找出所有文字及位置。
回傳格式：[{"text":"原文","x":像素,"y":像素,"width":像素,"height":像素}]
座標相對於圖片原始尺寸。若無文字回傳 []。
```

**Phase 2 — 翻譯**
```
將漫畫文字翻譯成{目標語言}，保持角色語氣。
回傳格式：[{"original":"原文","translation":"譯文"}]
```

---

## ⚠️ 錯誤處理

### 常見錯誤與解決方法

| 錯誤訊息 | 原因 | 解決方法 |
|----------|------|----------|
| `API Key 無效或無權限` | API Key 錯誤或已失效 | 重新取得 API Key |
| `API 額度不足或請求過快` | 超過免費額度 | 等待額度重置（每天重設）或升級付費 |
| `網路連線失敗` | 無網路或 Gemini 服務中斷 | 檢查網路；查看 [Google API 狀態](https://status.cloud.google.com/) |
| `⚠ 警告圖示` | 圖片 CORS 限制無法讀取 | 此為網站限制，無法繞過 |
| `無法取得圖片` | 圖片使用驗證保護 | 不支援需登入才能存取的圖片 |
| `無法解析 JSON 回應` | Gemini 回傳格式異常 | 點擊「重新翻譯」重試 |

### API 額度說明（Gemini 2.0 Flash 免費版）

| 限制 | 數值 |
|------|------|
| 每分鐘請求數 | 15 RPM |
| 每天請求數 | 1,500 RPD |
| 每分鐘 Token 數 | 1,000,000 TPM |

每張漫畫圖片消耗 **2 次 API 請求**（OCR + 翻譯），快取後不重複消耗。

---

## 🛠️ 支援網站

| 網站類型 | 支援狀況 | 備註 |
|----------|----------|------|
| 靜態 `<img>` 圖片 | ✅ 完整支援 | |
| Lazy-load 圖片 | ✅ 支援 | 自動解析 `data-src`, `data-lazy` 等屬性 |
| `<picture>` 元素 | ✅ 支援 | |
| AJAX 動態載入 | ✅ 支援 | 透過 MutationObserver 偵測 |
| Canvas 渲染漫畫 | ❌ 不支援 | WebGL 播放器無法存取圖片資料 |
| SVG 格式圖片 | ❌ 不支援 | Gemini 不支援 SVG 格式 |
| 需驗證的圖片 | ❌ 不支援 | CORS 限制 |

### 測試網站

| 網站 | 狀態 |
|------|------|
| [MangaDex](https://mangadex.org) | ✅ 支援 |
| [Webtoons](https://www.webtoons.com) | ✅ 支援 |
| [Bilibili 漫畫](https://manga.bilibili.com) | ✅ 支援（需登入） |
| [ComicWalker](https://comic-walker.com) | ✅ 支援 |
| [一般圖片站（Imgur 等）](https://imgur.com) | ✅ 支援 |

---

## 🔒 隱私與安全

- **API Key 儲存**：使用 Chrome Storage Local（加密儲存，僅限本機）
- **圖片資料**：僅在翻譯時傳送至 Gemini API，不儲存於任何伺服器
- **快取資料**：OCR 與翻譯結果僅儲存在本機 IndexedDB
- **無追蹤**：不收集任何使用者資料，不發送遙測

---

## 🛠️ 開發指南

### 本機開發

```powershell
# 1. Clone 專案
git clone <your-repo-url>
cd comic-translator

# 2. 在 Chrome 載入（開發者模式）
# chrome://extensions/ → 載入未封裝項目 → 選擇資料夾

# 3. 修改程式碼後，在 chrome://extensions/ 點擊重新整理圖示
```

### 目錄說明

```
lib/gemini.js      → 修改 Gemini Prompt 或換用其他模型
lib/storage.js     → 修改快取策略或新增設定項目
content/content.js → 修改圖片偵測邏輯或 Overlay 樣式
background/background.js → 修改並發數量或 Rate Limit 設定
popup/             → 修改使用者介面
```

### 調整並發數量

在 `background/background.js` 修改：

```javascript
const MAX_CONCURRENT = 3;      // 同時最多處理 3 張圖片
const REQUEST_INTERVAL_MS = 600; // 兩次 API 請求間最小間隔
```

### 更換 Gemini 模型

在 `lib/gemini.js` 修改：

```javascript
const MODEL = 'gemini-2.0-flash'; // 可改為 gemini-2.5-flash 等
```

---

## 📄 License

MIT License

Copyright (c) 2026 Comic Translator

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

---

*Made with ❤️ using Google Gemini AI*
