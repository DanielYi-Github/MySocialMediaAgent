import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { checkLoginStatus, openLoginBrowser, publish } from './xhs.js';
import {
  checkLoginStatus as fbCheckLogin,
  openLoginBrowser as fbOpenLogin,
  publish as fbPublish,
} from './fb.js';
import {
  checkLoginStatus as igCheckLogin,
  openLoginBrowser as igOpenLogin,
  publish as igPublish,
} from './ig.js';
import {
  getProxyErrorMessage,
  validateProxyTarget,
} from './proxy-security.js';

const app = express();
const PORT = 3001;

// Allow requests from the Vite dev server and built preview
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json({ limit: '100mb' }));

// --- XHS login status ---
// GET /api/xhs/status → { loggedIn: boolean }
app.get('/api/xhs/status', async (req, res) => {
  try {
    const loggedIn = await checkLoginStatus();
    res.json({ loggedIn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Trigger manual login ---
// POST /api/xhs/login → opens visible browser, waits for user to login
app.post('/api/xhs/login', async (req, res) => {
  try {
    const result = await openLoginBrowser();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- LLM / Publishing proxy (avoids browser CORS restrictions) ---
// POST /api/llm/proxy → { url, method?, headers, data } → forwards to external API
// method defaults to 'POST'; use 'GET' for status polling (data becomes query params)
app.post('/api/llm/proxy', async (req, res) => {
  const { url, method = 'POST', headers, data } = req.body;
  const normalizedMethod = String(method).toUpperCase();
  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (normalizedMethod === 'POST' && !data) return res.status(400).json({ error: 'Missing data' });
  try {
    const target = validateProxyTarget({ url, method: normalizedMethod });
    let response;
    if (target.method === 'GET') {
      response = await axios.get(target.url, { headers, params: data });
    } else {
      response = await axios.post(target.url, data, { headers });
    }
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || err.statusCode || 502;
    const message = getProxyErrorMessage(err);
    res.status(status).json({ error: { message } });
  }
});

// --- Publish to XHS ---
// POST /api/xhs/publish → { title, content, images?: [{base64, mime}], imageBase64?, imageMime?, llmConfig?, forceWebwright? }
app.post('/api/xhs/publish', async (req, res) => {
  const { title, content, images, imageBase64, imageMime, llmConfig, forceWebwright } = req.body;
  if (!content) return res.status(400).json({ error: '內容不可為空' });

  try {
    const finalImages = images || (imageBase64 ? [{ base64: imageBase64, mime: imageMime }] : []);
    const result = await publish({ title, content, images: finalImages, llmConfig, forceWebwright });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Facebook Personal ───────────────────────────────────────────────────────

// GET /api/fb/status → { loggedIn: boolean }
app.get('/api/fb/status', async (req, res) => {
  try {
    const loggedIn = await fbCheckLogin();
    res.json({ loggedIn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fb/login → opens visible browser for user to login
app.post('/api/fb/login', async (req, res) => {
  try {
    const result = await fbOpenLogin();
    res.json(result);
  } catch (err) {
    console.error('fb/login error:', err.message);
    const msg = String(err.message || err);
    if (msg.includes('Executable doesn\'t exist') || msg.includes('Please run the following command to download new browsers') || msg.includes('Looks like Playwright was just installed')) {
      return res.status(500).json({ error: 'Playwright browsers 未安裝或遺失。請在專案目錄執行：npx playwright install（或 npx playwright install chromium），然後重啟後台服務。' });
    }
    res.status(500).json({ error: msg });
  }
});

// POST /api/fb/publish → { caption, images?: [{base64, mime}], imageBase64?, imageMime?, llmConfig? }
app.post('/api/fb/publish', async (req, res) => {
  const { caption, images, imageBase64, imageMime, llmConfig, forceWebwright } = req.body;
  try {
    const finalImages = images || (imageBase64 ? [{ base64: imageBase64, mime: imageMime }] : []);
    const result = await fbPublish({ caption, images: finalImages, llmConfig, forceWebwright });
    res.json(result);
  } catch (err) {
    console.error('fb/publish error:', err.message);
    const msg = String(err.message || err);
    if (msg.includes('Executable doesn\'t exist') || msg.includes('Please run the following command to download new browsers') || msg.includes('Looks like Playwright was just installed')) {
      return res.status(500).json({ error: 'Playwright browsers 未安裝或遺失。請在專案目錄執行：npx playwright install（或 npx playwright install chromium），然後重啟後台服務。' });
    }
    res.status(500).json({ error: msg });
  }
});

// ─── Instagram Personal ──────────────────────────────────────────────────────

// GET /api/ig/status → { loggedIn: boolean }
app.get('/api/ig/status', async (req, res) => {
  try {
    const loggedIn = await igCheckLogin();
    res.json({ loggedIn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ig/login → opens visible browser for user to login
app.post('/api/ig/login', async (req, res) => {
  try {
    const result = await igOpenLogin();
    res.json(result);
  } catch (err) {
    console.error('ig/login error:', err.message);
    const msg = String(err.message || err);
    if (msg.includes('Executable doesn\'t exist') || msg.includes('Please run the following command to download new browsers') || msg.includes('Looks like Playwright was just installed')) {
      return res.status(500).json({ error: 'Playwright browsers 未安裝或遺失。請在專案目錄執行：npx playwright install（或 npx playwright install chromium），然後重啟後台服務。' });
    }
    res.status(500).json({ error: msg });
  }
});

// POST /api/ig/publish → { caption, images?: [{base64, mime}], imageBase64?, imageMime?, llmConfig?, forceWebwright? }
app.post('/api/ig/publish', async (req, res) => {
  const { caption, images, imageBase64, imageMime, llmConfig, forceWebwright } = req.body;
  try {
    const finalImages = images || (imageBase64 ? [{ base64: imageBase64, mime: imageMime }] : []);
    const result = await igPublish({ caption, images: finalImages, llmConfig, forceWebwright });
    res.json(result);
  } catch (err) {
    console.error('ig/publish error:', err.message);
    const msg = String(err.message || err);
    if (msg.includes('Executable doesn\'t exist') || msg.includes('Please run the following command to download new browsers') || msg.includes('Looks like Playwright was just installed')) {
      return res.status(500).json({ error: 'Playwright browsers 未安裝或遺失。請在專案目錄執行：npx playwright install（或 npx playwright install chromium），然後重啟後台服務。' });
    }
    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`XHS 自動化服務已啟動：http://localhost:${PORT}`);
  console.log('等待前端請求...');
});
