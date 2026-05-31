# MySocialMediaAgent 🤖

[English](./README.md) | 繁體中文

這是一個本地端的自動化社群媒體代理工具，結合了大語言模型（LLM）的分析與創作能力，以及瀏覽器自動化技術，幫助你輕鬆生成並發布貼文到各大社群平台。

## 🌟 核心功能

- **多語言模型支援**：支援 OpenAI、Anthropic (Claude)、Google Gemini、NVIDIA NIM、本地 Ollama 以及任何 OpenAI 相容的 API。
- **視覺能力 (Vision)**：支援上傳圖片，讓具備視覺能力的 LLM 幫你分析圖片內容並撰寫對應的文案。
- **多平台自動發文**：
  - **Facebook**：透過 API 自動發布到粉絲專頁。
  - **Instagram**：透過 API 自動發布到商業帳號。
  - **小紅書 (Xiaohongshu)**：內建 Playwright 瀏覽器自動化腳本，模擬真實使用者登入與發文（繞過官方 API 限制）。

## 🚀 如何使用

### 1. 安裝環境與依賴

請確保你的電腦已經安裝了 [Node.js](https://nodejs.org/)。

```bash
# 安裝所有套件
npm install

# 安裝 Playwright 所需的瀏覽器（用於小紅書等自動化發文）
npm run setup:xhs
# 或是執行：npx playwright install chromium
```

### 2. 啟動專案

```bash
# 一鍵同時啟動前端介面與後端服務
npm run dev:all
```
啟動成功後：
- 前端介面：`http://localhost:5173`
- 後端服務：`http://localhost:3001`

### 3. 設定 API 與發文憑證

1. 打開瀏覽器進入前端介面 (`http://localhost:5173`)。
2. 點擊右上角的 **「設定 (⚙️)」**。
3. **LLM 設定**：選擇你想要使用的語言模型（例如 Google Gemini），並填入對應的 API Key。
4. **發文設定**：填入你要發布的社群平台憑證（例如 FB Page Token、IG User ID、imgbb 圖片代管 Key 等）。

### 4. 開始發文

1. 在首頁上傳圖片（可選）。
2. 輸入你要的背景資訊或 Context。
3. 點擊「開始產出草稿」，等待 AI 為你生成各大平台的專屬文案。
4. 審閱確認無誤後，一鍵將貼文發布至對應的社群平台！
