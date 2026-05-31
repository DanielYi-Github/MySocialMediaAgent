# MySocialMediaAgent 🤖

[繁體中文](./README.zh.md) | English

A local, automated social media agent that leverages Large Language Models (LLMs) and browser automation to help you easily generate and publish content across multiple platforms.

## 🌟 Features

- **Multi-LLM Support**: Connects to OpenAI, Anthropic (Claude), Google Gemini, NVIDIA NIM, local Ollama, or any custom OpenAI-compatible API.
- **Vision Capabilities**: Upload images and let vision-capable LLMs analyze them to write perfectly contextualized captions.
- **Cross-Platform Publishing**:
  - **Facebook**: Publish automatically to Facebook Pages via API.
  - **Instagram**: Publish automatically to Instagram Business accounts via API.
  - **Xiaohongshu (小紅書)**: Uses Playwright browser automation to log in and post automatically, bypassing official API limitations.

## 🚀 Getting Started

### 1. Installation

Ensure you have [Node.js](https://nodejs.org/) installed.

```bash
# Install dependencies
npm install

# Install Playwright browsers (Required for Xiaohongshu automation)
npm run setup:xhs
```

### 2. Run the Project

```bash
# Starts both the frontend UI and the backend server concurrently
npm run dev:all
```
Once started:
- Frontend UI: `http://localhost:5173`
- Backend Server: `http://localhost:3001`

### 3. Configuration

1. Open the Frontend UI in your browser (`http://localhost:5173`).
2. Click the **Settings (⚙️)** icon in the top right.
3. **LLM Settings**: Select your preferred provider (e.g., Google Gemini) and enter your API Key.
4. **Publishing Settings**: Enter your credentials for social media platforms (FB Page Token, IG User ID, imgbb key, etc.).

### 4. Start Publishing!

1. Upload an image and provide some context.
2. Click "Generate Drafts" to let AI create platform-specific content.
3. Review the drafts and publish them directly to your connected social media accounts with a single click.
