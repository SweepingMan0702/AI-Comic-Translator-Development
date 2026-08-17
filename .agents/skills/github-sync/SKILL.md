---
name: github-sync
description: >-
  當使用者要求將專案存檔、推送至 GitHub、查看版本歷史、建立分支或還原檔案時，使用此 Skill。
  例如：「幫我存檔」、「推送到 GitHub」、「建立新分支」、「還原到上一版」、「查看 commit 紀錄」。
---

# GitHub 版本控制操作手冊

## 專案基本資訊

- **本地專案路徑**：`c:\Users\black\Desktop\temp`
- **GitHub 倉庫**：`https://github.com/SweepingMan0702/AI-Comic-Translator-Development`
- **主要分支**：`main`
- **Git 使用者**：`SweepingMan0702` / `blackfrie.0976@gmail.com`

> ⚠️ **重要**：GitHub Token 請勿寫入此檔案。每次需要推送時，若驗證失敗，請提醒使用者提供最新的 Personal Access Token（格式：`ghp_xxxx`），並使用以下格式設定遠端 URL：
> ```
> git remote set-url origin https://SweepingMan0702:<TOKEN>@github.com/SweepingMan0702/AI-Comic-Translator-Development.git
> ```

---

## 常用操作流程

### 1. 日常存檔並推送（最常用）

當使用者說「幫我存檔」、「推送到 GitHub」、「commit」時執行：

```bash
# 步驟一：確認目前狀態
git status

# 步驟二：加入所有變更
git add .

# 步驟三：建立 commit（說明由使用者提供，若未提供則詢問）
git commit -m "<使用者提供的說明>"

# 步驟四：推送至 GitHub
git push
```

**驗證**：確認終端機輸出包含 `main -> main`，表示推送成功。

---

### 2. 查看版本歷史記錄

當使用者說「查看歷史」、「我之前做了什麼」時執行：

```bash
git log --oneline --graph -20
```

---

### 3. 建立新功能分支

當使用者說「我想測試新功能，不要影響主程式」時執行：

```bash
# 建立並切換到新分支
git checkout -b <分支名稱>

# 推送新分支到 GitHub
git push -u origin <分支名稱>
```

---

### 4. 合併分支回主線

當使用者確認功能測試成功，想合併時執行：

```bash
git checkout main
git merge <分支名稱>
git push
```

---

### 5. 還原單一檔案到上一版

當使用者說「這個檔案改壞了，還原它」時執行：

```bash
git restore <檔案路徑>
```

---

### 6. 還原整個專案到指定版本

當使用者提供 commit ID（從 `git log --oneline` 取得）時執行：

```bash
# 先查看 commit 列表
git log --oneline

# 還原到指定 commit（僅查看，不破壞歷史）
git checkout <commit-id>

# 若確認要永久回到此版本（危險操作，需使用者確認）
git reset --hard <commit-id>
```

---

## 注意事項

1. **每次 commit 前先執行 `git status`** 確認變更內容。
2. **commit 訊息使用繁體中文**，簡短描述本次改動。
3. **不要 commit 以下檔案**（已設定於 `.gitignore`）：
   - `node_modules/`
   - `.env`
   - `*.log`
4. **API Key 或敏感資訊絕對不可 commit**，若發現請立即提醒使用者。
