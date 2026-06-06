# MySocialMediaAgent 🤖

[繁體中文](./README.zh.md) | English

MySocialMediaAgent is a local, image-first social media drafting assistant. It uses vision-capable LLMs to turn uploaded images and short context into platform-specific drafts for Instagram, Xiaohongshu, Facebook, and Threads.

The product is intentionally staged:

- **V1 — Drafting & Review**: generate, edit, regenerate, copy, and confirm drafts.
- **V1.5 — Publishing Assist**: optional publishing flow after explicit review and confirmation.
- **V2 — Official API Publishing**: Facebook Page, Instagram Business, and Threads API publishing.
- **V2.5 — Experimental Browser Automation**: Xiaohongshu and personal-account browser automation via Playwright / Webwright-style recovery.

See `PRD.md` for the current product scope and implementation priorities.

## 🌟 Features

- **Multi-LLM Support**: OpenAI, Anthropic, Google Gemini, NVIDIA NIM, Ollama, and custom OpenAI-compatible APIs.
- **Vision Draft Generation**: upload images, provide context, and generate platform-specific copy.
- **Human Review First**: edit and confirm each platform draft before any publishing flow.
- **Prompt Preview**: inspect generated system/user prompts for debugging and iteration.
- **Optional Publishing Paths**:
  - **Facebook Page**: official API publishing.
  - **Instagram Business**: official API publishing.
  - **Threads**: official API publishing.
  - **Xiaohongshu / Personal Accounts**: experimental browser automation, not an official API path.

## ⚠️ Publishing Safety

Publishing is not the V1 MVP guarantee. Browser automation is experimental and can fail when platforms change their UI. It may also violate platform terms, so use it only after reviewing the final content and understanding the risk.

## 🚀 Getting Started

### 1. Installation

Ensure you have [Node.js](https://nodejs.org/) installed.

```bash
npm install
npm run setup:xhs
```

`setup:xhs` installs Chromium for optional browser automation.

### 2. Run the Project

```bash
npm run dev:all
```

Once started:

- Frontend UI: `http://localhost:5173`
- Backend Server: `http://localhost:3001`

### 3. Configure LLM

1. Open `http://localhost:5173`.
2. Click the **Settings (⚙️)** icon.
3. Choose an LLM provider.
4. Enter an API key if the provider requires one.
5. Use a vision-capable model; text-only models cannot analyze images.

Custom OpenAI-compatible providers must be explicitly allowed by the backend proxy:

```bash
PROXY_ALLOWED_HOSTS=api.your-provider.com npm run server
```

Built-in providers and local Ollama at `http://localhost:11434/v1/*` are already allowed.

### 4. Generate Drafts

1. Upload 1–10 images.
2. Treat the first image as the primary image.
3. Add context such as location, mood, topic, or target audience.
4. Click **Generate Drafts**.
5. Review, edit, regenerate, copy, or confirm each platform draft.

### 5. Optional Publishing

If you choose to publish, configure platform credentials in the UI and review the final platform-specific draft before continuing.

For the current scope split and implementation plan, read `PRD.md`.
