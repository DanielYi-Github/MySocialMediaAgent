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

const app = express();
const PORT = 3001;

// Allow requests from the Vite dev server and built preview
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json({ limit: '30mb' }));

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
  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (method === 'POST' && !data) return res.status(400).json({ error: 'Missing data' });
  try {
    let response;
    if (method === 'GET') {
      response = await axios.get(url, { headers, params: data });
    } else {
      response = await axios.post(url, data, { headers });
    }
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 502;
    const message = err.response?.data?.error?.message || err.message;
    res.status(status).json({ error: { message } });
  }
});

// --- Publish to XHS ---
// POST /api/xhs/publish → { title, content, imageBase64?, imageMime?, topics? }
app.post('/api/xhs/publish', async (req, res) => {
  const { title, content, imageBase64, imageMime, topics } = req.body;
  try {
    const result = await publish({ title, content, imageBase64, imageMime, topics });
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

// POST /api/fb/publish → { caption, imageBase64?, imageMime? }
app.post('/api/fb/publish', async (req, res) => {
  const { caption, imageBase64, imageMime } = req.body;
  try {
    const result = await fbPublish({ caption, imageBase64, imageMime });
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

// POST /api/ig/publish → { caption, imageBase64, imageMime? }
app.post('/api/ig/publish', async (req, res) => {
  const { caption, imageBase64, imageMime } = req.body;
  try {
    const result = await igPublish({ caption, imageBase64, imageMime });
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
