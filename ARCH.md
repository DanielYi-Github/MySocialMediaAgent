# 技術架構與開發計畫 v2

本文件對齊 `PRD.md` 的版本邊界：V1 以草稿生成與審核為核心；V1.5 之後才處理半自動發布；V2 正式產品化官方 API 發布；V2.5 將瀏覽器自動化視為實驗功能。

---

## 1. 系統分層

### 1.1 Frontend
- React + Vite
- 圖片上傳與預覽
- 使用者 context 輸入
- 四平台草稿卡片
- Inline edit / regenerate / copy / confirm
- LLM 與 publishing 設定 UI

### 1.2 Draft Generation
- 由 `src/lib/generation.js` 組裝 prompt 與 provider request
- 支援 OpenAI-compatible Chat Completions 與 Anthropic Messages API
- 目前 V1 以首張主圖作為主要 vision input
- 回傳結果正規化為前端可顯示的草稿資料

### 1.3 Provider Configuration
- Provider source of truth 在 `src/lib/providers.js`
- 支援 OpenAI、Anthropic、Gemini、NVIDIA NIM、Ollama、Custom
- 不再綁定單一 Copilot / GPT-4.5-mini 路線
- 預設模型應優先選 vision-capable model

### 1.4 Local Backend
- Express server
- CORS 僅允許本地前端來源
- 目前提供 LLM / publishing proxy
- 提供 XHS / Facebook / Instagram browser automation endpoints

### 1.5 Publishing Layer
- API publishing：Facebook Page、Instagram Business、Threads
- Browser automation：XHS、Facebook personal、Instagram personal
- Browser automation 屬於 V2.5 實驗能力，不是 V1 MVP 穩定承諾

---

## 2. V1 草稿生成架構

### 2.1 Input
- 支援 1–10 張圖片
- 第一張為主圖
- 使用者可輸入地點、事件、心情、主題、受眾方向

### 2.2 Image Handling
目前狀態：
- 前端以 FileReader 轉 data URL
- 顯示縮圖
- 草稿生成 request 主要送第一張圖片

V1 要求：
- UI 明確標示首張為主圖
- Prompt 明確說明以主圖為主要分析依據
- 多圖文案不得暗示模型完整理解所有圖片，除非未來實作多圖輸入

V2 改進：
- 前端壓縮長邊至 2048px
- 圖片格式與大小檢查
- 多圖送入模型，或先逐圖摘要再合併故事線

### 2.3 Output Schema
目前相容格式仍是單一 `content` 字串。

目標格式：

```json
{
  "title": "平台標題或開頭句",
  "body": "主要文案",
  "hashtags": ["#tag1", "#tag2"],
  "imageAlt": "圖片說明",
  "notes": "生成理由或審核提示"
}
```

遷移策略：
- P1 先讓 parser 同時接受舊 `content` 與新 schema
- 前端逐步從 textarea content 升級為結構化草稿編輯

---

## 3. Prompt 策略

平台規格需與 `PRD.md` 保持一致。

| 平台 | 語氣風格 | 結構要求 | Hashtag 策略 |
|---|---|---|---|
| Instagram | 視覺導向、精簡、有畫面感 | 2–4 句 | 5–8 個 |
| 小紅書 | 筆記感、生活化、重點條列 | 標題 + 條列/短段落 | 8–12 個 |
| Facebook | 敘事完整、自然、親和 | 較長段落，可完整描述 | 2–3 個 |
| Threads | 短句、即時感、自然口吻 | 140 字內 | 0–2 個 |

### Prompt Source of Truth
目前 prompt 分散在：
- `src/lib/generation.js`
- `PROMPTS.md`
- `ARCH.md`

P1 應收斂為單一來源，避免 hashtag 數、字數、語氣規格彼此不一致。

---

## 4. 發布架構

### 4.1 V1.5 Publishing Assist
發布區只在使用者確認草稿後出現。

必要保護：
- 發布前二次確認
- 顯示平台、帳號類型、圖片數、最終文案
- 顯示 API / Browser / Manual 路徑
- Browser automation 必須標記實驗與風險

### 4.2 V2 Official API Publishing
正式產品化範圍：
- Facebook Page Graph API
- Instagram Business API
- Threads API
- Token 權限檢查
- 圖片公開 URL 處理
- 發布結果記錄

### 4.3 V2.5 Browser Automation
實驗範圍：
- XHS creator portal
- Facebook personal account
- Instagram personal account
- Self-healing selector
- Force Webwright agent loop

限制：
- 可能違反平台規則
- 可能因 UI 改版失效
- 不應作為 V1 MVP 成功標準

---

## 5. Backend Proxy 安全

目前 `/api/llm/proxy` 可由前端指定 URL 轉發。這適合本地開發，但產品化前必須收斂。

P0 要求：
- 加入 allowlist domains
- 拒絕 private network / localhost upstream
- 限制 method
- 對 token 做 redaction
- 錯誤訊息避免暴露敏感資訊

---

## 6. 測試與品質

### 6.1 現況
- `npm run build` 可通過
- 現有 node 測試可手動跑
- `npm run lint` 目前有環境設定與 lint error 需要修正
- `package.json` 尚未提供正式 `test` script

### 6.2 P0 驗證
- `npm run lint` 通過
- `npm test` 可一次跑完現有測試
- `npm run build` 通過
- Proxy allowlist 測試通過
- 發布二次確認不會誤觸 API

### 6.3 P1 驗證
- 50 組素材測試表
- 四平台草稿非空
- Instagram / 小紅書可用率達 80%
- Facebook / Threads 可用率達 60%
- 品質檢查器能標示字數、hashtag、空文案問題

---

## 7. Roadmap

### P0：一致性與安全底座
1. 文件對齊 PRD v2
2. 發布前二次確認
3. Backend proxy allowlist
4. ESLint Node/browser/test 環境修正
5. 加入正式 test script

### P1：草稿品質與資料模型
1. 結構化草稿 schema
2. 統一 prompt source of truth
3. 多圖策略修正
4. 平台品質檢查器
5. 50 組素材評估表

### P2：發布能力產品化
1. 發布能力矩陣
2. 憑證健康檢查
3. 圖片預處理
4. Webwright 實驗模式隔離
5. 發布結果記錄
