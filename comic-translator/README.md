# 📖 Comic Translator — AI 漫畫即時翻譯 Chrome Extension

![版本](https://img.shields.io/badge/版本-1.3.0-blue?style=flat-square)
![Manifest](https://img.shields.io/badge/Manifest-V3-green?style=flat-square)
![Gemini](https://img.shields.io/badge/Gemini-3.x%20Flash%20Series-orange?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

> 使用 **Google Gemini 3.x Flash Vision AI** 原生多圖視覺辨識技術，即時翻譯漫畫圖片中的台詞與旁白，並以智慧自適應文字框覆蓋在原圖上。無需離開漫畫網站，即可享受零障礙閱讀體驗！

---

## ✨ 核心亮點功能

| 功能 | 說明 |
| :--- | :--- |
| 🚀 **3 合 1 原生多圖批次** | 1 次 API 請求同時處理 3~4 張漫畫圖片，API 消耗直接減少 **75%**，徹底免疫跨域 CORS！ |
| 🤖 **5 大黃金模型自動輪替** | 整合 `3.7 Flash`、`3.6 Flash`、`3.5 Flash`、`3.5 Flash Lite` (500 RPD)、`3.1 Flash Lite` (500 RPD)，遇限制自動無縫跳轉，每日單 Key 擁逾 **1,060+ 次** 請求配額！ |
| 🔑 **多 Key / 多專案平行分流** | 支援填入多組 Google Project API Key，自動指針輪替與安全冷卻，支援最多 3 個 Worker 平行極速翻譯。 |
| 🎚️ **字體大小即時滑桿 (1%~300%)** | 於 Popup 即時自由拖動縮放比例，頁面上已翻譯的對白氣泡會即時同步放大/縮小，無需重譯！ |
| ✋ **對白氣泡互動調整** | 對話框可**自由拖曳移動**，懸停**右上角把手可拖曳手動縮放寬高**，**雙擊滑鼠左鍵**即可自訂編輯文字。 |
| ↺ **單圖強制清除快取刷新** | 懸停任一圖片左上角點擊 `↺` 按鈕，自動清除該圖 IndexedDB 快取並強制重新向 AI 發起翻譯。 |
| 🌙 **深淺色 (Dark/Light) 雙 UI** | Popup 右上角支援 🌙 / ☀️ 一鍵切換深色與淺色介面，並自動記憶使用者偏好。 |
| 💡 **右上角使用小提示** | 整合常見使用訣竅（包含漏翻處理、速度排隊機制說明等）。 |
| 📋 **結構化除錯日誌** | 內建模型狀態與異常診斷器，可隨時點擊「檢視除錯日誌」查看各模型運作狀況。 |
| 🌐 **多國語言支援** | 繁體中文、簡體中文、英文、日本語、한국어。 |

---

## 📁 專案結構

```
comic-translator/
├── manifest.json               # Chrome Extension 配置（Manifest V3，版本 1.3.0）
├── README.md                   # 專案說明文件
│
├── popup/                      # 擴充功能彈出視窗
│   ├── popup.html              # 主介面 HTML（支援深淺色、小提示選單、模型狀態列）
│   ├── popup.js                # Popup 邏輯（多 Key 管理、字體滑桿、日誌檢視器）
│   └── popup.css               # Material Design + Dark Mode 樣式
│
├── content/                    # 網頁注入腳本
│   ├── content.js              # 原生多圖批次打包、氣泡拖曳縮放、單圖刷新
│   └── content.css             # 自適應氣泡、縮放把手、刷新按鈕樣式
│
├── background/                 # 背景 Service Worker
│   └── background.js           # 多 Worker 佇列、多 Key 輪替、冷卻保護閥
│
├── lib/                        # 核心共用模組
│   ├── gemini.js               # Gemini Interactions API 封裝、5 模型池、標準 box_2d
│   ├── storage.js              # Chrome Storage + IndexedDB 快取封裝
│   └── cache.js                # SHA-256 圖片 Hash 計算
│
└── assets/
    └── icons/                  # 專屬 3D 漫畫「漫」字高清晰圖示
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## 🚀 安裝與使用方式

### 步驟 1：載入擴充功能至 Chrome

1. 下載或 Clone 本專案至本機電腦。
2. 開啟 Chrome 瀏覽器，於網址列輸入 `chrome://extensions/`
3. 開啟右上角的 **「開發人員模式」**（Developer mode）。
4. 點擊左上角的 **「載入未封裝項目」**（Load unpacked）。
5. 選擇 **`comic-translator` 資料夾**（包含 `manifest.json` 的那層目錄）。
6. 工具列出現「漫」字專屬圖示即安裝成功 ✅！

---

### 步驟 2：取得免費 Gemini API Key（多專案提速心法）

> 💡 **提速秘訣**：推薦在同一個 Google 帳號內建立 **3 組不同 Project 的 Key**，每組專案配額獨立分開，可徹底消除速率冷卻限制！

1. 前往 **[Google AI Studio ↗](https://aistudio.google.com/)** 登入 Google 帳號。
2. 點擊左側選單 **「Get API key」** ➜ 點擊 **「Create API key」**。
3. 選擇 **「Create API key in new project」**（在新的專案中建立）：
   * • 第 1 組：專案名稱填 `comic 1` ➜ 複製 Key
   * • 第 2 組：專案名稱填 `comic 2` ➜ 複製 Key
   * • 第 3 組：專案名稱填 `comic 3` ➜ 複製 Key
4. 打開 Extension 視窗，將 3 組 Key 一次性貼入輸入框中（每行一組或以逗號隔開），點擊 **「＋ 新增」**。
5. 選擇目標翻譯語言（預設：繁體中文）。

---

### 步驟 3：開始閱讀漫畫

| 操作 | 方法 |
| :--- | :--- |
| **翻譯整頁漫畫** | 打開漫畫頁面 ➜ 點擊 Popup ➜ **「翻譯本頁漫畫」** |
| **調整翻譯字體大小** | 在 Popup 的「翻譯設定」滑動 **「翻譯字體大小 (1%~300%)」**，頁面文字立即放大縮小 |
| **單圖重新翻譯** | 將滑鼠懸停在圖片左上角，點擊出現的藍色 **`↺` 刷新按鈕**（自動清除該圖快取） |
| **移動對話框** | 按住對話框任意拖曳至適當位置 |
| **手動縮放對話框** | 滑鼠懸停對話框**右上角**，按住藍色把手拖曳調整寬高 |
| **自訂編輯文字** | **雙擊滑鼠左鍵** 進入對話框編輯模式，直接修改文字 |
| **切換深色/淺色模式** | 點擊 Popup 右上角 **🌙 / ☀️ 按鈕** |
| **停止翻譯** | 點擊 Popup 內的 **「停止」按鈕**，立即斷開連線並清除 Loading 圖示 |

---

## 🤖 AI 模型輪替池說明

擴充套件採用 Google Interactions API 官方規範，內建 5 款高性價比 Flash 視覺模型輪替：

```
[1] gemini-3.7-flash      (最新 3.7 旗艦 Flash)
[2] gemini-3.6-flash      (主力高速模型)
[3] gemini-3.5-flash      (穩定備援)
[4] gemini-3.5-flash-lite (輕量版，每日享 500 次請求)
[5] gemini-3.1-flash-lite (輕量版，每日享 500 次請求)
```

* **自動故障轉移（Automatic Failover）**：任一模型若觸發 429 速率限制或配額耗盡，系統在同一次請求內會自動嘗試下一個模型，使用者翻譯完全不中斷。
* **即時高亮反饋**：Popup 底部狀態列會每 2 秒即時顯示目前成功啟用的模型（以藍色晶片與脈動圓點高亮）。

---

## 🔒 隱私與安全聲明

* **純本機端執行**：無任何中介後端伺服器，API Key 與使用者設定僅儲存在瀏覽器的 `chrome.storage.local`。
* **快取安全**：翻譯結果僅儲存於本機瀏覽器的 IndexedDB 資料庫中。
* **零資料收集**：擴充功能不收集任何個人隱私資訊，不包含任何第三方追蹤代碼。

---

## 📄 開源授權

本專案採用 [MIT License](LICENSE) 授權開源。
