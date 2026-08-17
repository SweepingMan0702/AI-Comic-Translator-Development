# 🧩 如何載入 Comic Translator 擴充功能

> 本教學適用於 **Google Chrome**、**Microsoft Edge**（步驟相同）

---

## 📋 前置準備

確認你的電腦上已有 `comic-translator` 資料夾，且資料夾內包含以下檔案：

```
comic-translator/
├── manifest.json   ← 這個檔案必須存在！
├── popup/
├── content/
├── background/
├── lib/
└── assets/
```

---

## 🚀 載入步驟

### 第 1 步：開啟擴充功能管理頁面

在 Chrome 網址列輸入以下網址並按 **Enter**：

```
chrome://extensions/
```

或者透過選單進入：

> Chrome 右上角 **⋮** → 更多工具 → 擴充功能

---

### 第 2 步：開啟「開發人員模式」

在擴充功能頁面的**右上角**，找到「**開發人員模式**」開關，**點擊開啟**（變成藍色即為開啟）。

```
┌─────────────────────────────────────────┐
│  擴充功能              開發人員模式 [●] │  ← 點這裡
└─────────────────────────────────────────┘
```

開啟後，頁面上方會出現三個新按鈕：

```
[ 載入未封裝項目 ]  [ 封裝擴充功能 ]  [ 更新 ]
```

---

### 第 3 步：載入擴充功能資料夾

點擊「**載入未封裝項目**」按鈕，會跳出資料夾選擇視窗。

**重要**：選擇 `comic-translator` **資料夾本身**（而不是進入資料夾內部）

```
✅ 正確：選擇 comic-translator/        （資料夾）
❌ 錯誤：選擇 comic-translator/manifest.json  （檔案）
```

選好後點擊「**選取資料夾**」。

---

### 第 4 步：確認安裝成功

載入成功後，擴充功能頁面會出現 Comic Translator 的卡片：

```
┌─────────────────────────────────────┐
│  📖 Comic Translator                │
│  AI 漫畫即時翻譯                    │
│  版本：1.0.0                        │
│                          [已啟用 ●] │
└─────────────────────────────────────┘
```

同時，Chrome **工具列右上角**也會出現擴充功能圖示 📖。

> 如果圖示沒有顯示，點擊工具列的 🧩 拼圖圖示，再點 Comic Translator 旁的「釘選」圖示 📌

---

### 第 5 步：設定 API Key

1. 點擊工具列上的 📖 Comic Translator 圖示
2. 在「**Gemini API Key**」欄位貼上你的 API Key
3. 點擊「**測試連線**」確認有效
4. 點擊「**儲存**」

---

## 🔄 修改程式碼後如何重新載入？

每次修改程式碼後，需要手動重新載入才會生效：

1. 前往 `chrome://extensions/`
2. 找到 Comic Translator 卡片
3. 點擊右下角的「**重新整理**」圖示 🔄

> **注意**：修改 `content.js` 後，除了重新整理 Extension，還需要**重新整理漫畫網頁**才能看到效果

---

## ❌ 常見問題排解

### 問題：載入後出現錯誤提示

| 錯誤訊息 | 原因 | 解決方法 |
|----------|------|----------|
| `Manifest file is missing or unreadable` | 選錯資料夾 | 確認選的是含 `manifest.json` 的資料夾 |
| `'manifest_version' key must be present` | manifest.json 格式錯誤 | 檢查 manifest.json 內容 |
| `Could not load icon` | 圖示檔案遺失 | 確認 `assets/icons/` 下有三個 .png 檔案 |
| 擴充功能圖示顯示為「錯誤」 | JS 語法錯誤 | 點擊「錯誤」查看詳細訊息 |

### 問題：點擊圖示後 Popup 沒反應

- 前往 `chrome://extensions/` → 找到 Comic Translator → 點「Service Worker」連結查看錯誤

### 問題：翻譯功能沒反應

- 確認已儲存 API Key（測試連線顯示 ✅）
- 確認網頁上有尺寸大於 100×100px 的圖片
- 嘗試重新整理漫畫網頁後再次點擊翻譯

---

## 📦 進階：打包成 .zip 上傳 Chrome Web Store

```powershell
# 在 comic-translator 的上層目錄執行
Compress-Archive -Path "comic-translator\*" -DestinationPath "comic-translator-v1.0.0.zip"
```

產生的 `comic-translator-v1.0.0.zip` 可上傳至：
[Chrome Web Store 開發者後台](https://chrome.google.com/webstore/devconsole/)

---

*有任何問題，請查閱 [README.md](./README.md) 或在專案中提出 Issue。*
