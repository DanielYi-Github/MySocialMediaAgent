# MySocialMediaAgent 🤖

[English](./README.md) | 繁體中文

MySocialMediaAgent 是一個本地端、圖片優先的社群文案草稿工具。它使用具備 vision 能力的 LLM，把上傳圖片與簡短 context 轉成 Instagram、小紅書、Facebook、Threads 的平台化草稿。

產品目前採分階段定位：

- **V1 — 草稿生成與審核**：產出、修改、重新生成、複製、確認草稿。
- **V1.5 — 發布輔助**：在使用者明確審核確認後，才進入可選發布流程。
- **V2 — 官方 API 發布**：Facebook Page、Instagram Business、Threads API。
- **V2.5 — 實驗性瀏覽器自動化**：小紅書與個人帳號透過 Playwright / Webwright-style recovery 模擬操作。

目前產品範圍與實作優先級請看 `PRD.md`。

## 🌟 核心功能

- **多語言模型支援**：OpenAI、Anthropic、Google Gemini、NVIDIA NIM、本地 Ollama，以及自訂 OpenAI-compatible API。
- **圖片理解與草稿生成**：上傳圖片、補充 context，產出四平台文案草稿。
- **人工審核優先**：每個平台都可修改、重新生成、複製與確認；未確認前不應進入發布。
- **提示詞預覽**：可查看完整 system/user prompt，方便 debug 與調整。
- **可選發布路徑**：
  - **Facebook Page**：官方 API 發布。
  - **Instagram Business**：官方 API 發布。
  - **Threads**：官方 API 發布。
  - **小紅書 / 個人帳號**：實驗性瀏覽器自動化，不是官方 API。

## ⚠️ 發布安全提醒

自動發布不是 V1 MVP 的穩定承諾。瀏覽器自動化屬於實驗功能，平台 UI 改版時可能失效，也可能違反平台使用規則。請只在你已審核最終內容、理解風險後使用。

## 🚀 如何使用

### 1. 安裝環境與依賴

請確保你的電腦已安裝 [Node.js](https://nodejs.org/)。

```bash
npm install
npm run setup:xhs
```

`setup:xhs` 會安裝 optional 瀏覽器自動化需要的 Chromium。

### 2. 啟動專案

```bash
npm run dev:all
```

啟動成功後：

- 前端介面：`http://localhost:5173`
- 後端服務：`http://localhost:3001`

### 3. 設定 LLM

1. 打開 `http://localhost:5173`。
2. 點擊右上角 **設定 (⚙️)**。
3. 選擇 LLM provider。
4. 若 provider 需要 API Key，請填入對應金鑰。
5. 請使用 vision-capable model；純文字模型無法分析圖片。

自訂 OpenAI-compatible provider 必須先加入後端 proxy 白名單：

```bash
PROXY_ALLOWED_HOSTS=api.your-provider.com npm run server
```

內建 provider 與本地 Ollama `http://localhost:11434/v1/*` 已預設允許。

### 4. 產出草稿

1. 上傳 1–10 張圖片。
2. 第一張會被視為主要分析圖片。
3. 補充地點、心情、主題、受眾方向等 context。
4. 點擊「開始產出多平台文案」。
5. 逐平台審核、修改、重新生成、複製或確認草稿。

### 5. 可選發布

如果你要進入發布流程，請先在 UI 設定平台憑證，並在發布前再次確認各平台最終文案。

目前產品範圍與 implementation plan 請看 `PRD.md`。
