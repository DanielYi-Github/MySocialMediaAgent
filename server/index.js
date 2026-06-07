import express from 'express';
import cors from 'cors';
import axios from 'axios';
import https from 'https';
import http from 'http';
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
import { getMediaCacheEntry, storeMediaDataUrl } from './media-cache.js';

const app = express();
const PORT = 3001;

// Allow requests from the Vite dev server and built preview
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json({ limit: '100mb' }));

app.post('/api/media-cache', async (req, res) => {
  const { dataUrl, mime, fileName } = req.body || {};
  if (!dataUrl) return res.status(400).json({ error: 'Missing dataUrl' });

  try {
    const { id, mime: resolvedMime } = storeMediaDataUrl({ dataUrl, mime, fileName });
    const host = req.get('host') || `localhost:${PORT}`;
    const protocol = req.protocol || 'http';
    res.json({
      id,
      mime: resolvedMime,
      url: `${protocol}://${host}/api/media-cache/${id}`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/media-cache/:id', async (req, res) => {
  const entry = getMediaCacheEntry(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: 'Media cache entry not found' });
  }

  res.setHeader('Content-Type', entry.mime);
  res.setHeader('Cache-Control', 'private, max-age=1800');
  res.send(entry.buffer);
});

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
    const axiosConfig = {
      headers,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      httpAgent: new http.Agent({ keepAlive: true })
    };

    const doRequest = async (targetUrl) => {
      if (target.method === 'GET') {
        return axios.get(targetUrl, { ...axiosConfig, params: data });
      }
      return axios.post(targetUrl, data, axiosConfig);
    };

    let response;
    try {
      response = await doRequest(target.url);
    } catch (firstErr) {
      // EPROTO "wrong version number" = server is HTTP but we used https://
      // Auto-retry with http:// equivalent
      const isProtocolMismatch = firstErr.code === 'EPROTO' && firstErr.message.includes('wrong version number');
      if (isProtocolMismatch && target.url.startsWith('https://')) {
        const httpUrl = target.url.replace(/^https:\/\//, 'http://');
        response = await doRequest(httpUrl);
      } else {
        throw firstErr;
      }
    }

    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || err.statusCode || 502;
    const message = getProxyErrorMessage(err);
    res.status(status).json({ error: { message } });
  }
});

// --- Publish to XHS ---
// POST /api/xhs/publish → { title, content, assets?: [{base64, mime}], images?: [...], imageBase64?, imageMime?, llmConfig?, forceWebwright? }
app.post('/api/xhs/publish', async (req, res) => {
  const { title, content, assets, images, imageBase64, imageMime, llmConfig, forceWebwright } = req.body;
  if (!content) return res.status(400).json({ error: '內容不可為空' });

  try {
    const finalAssets = assets || images || (imageBase64 ? [{ base64: imageBase64, mime: imageMime }] : []);
    const result = await publish({ title, content, assets: finalAssets, llmConfig, forceWebwright });
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

// POST /api/fb/publish → { caption, assets?: [{base64, mime}], images?: [...], imageBase64?, imageMime?, llmConfig? }
app.post('/api/fb/publish', async (req, res) => {
  const { caption, assets, images, imageBase64, imageMime, llmConfig, forceWebwright } = req.body;
  try {
    const finalAssets = assets || images || (imageBase64 ? [{ base64: imageBase64, mime: imageMime }] : []);
    const result = await fbPublish({ caption, assets: finalAssets, llmConfig, forceWebwright });
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

// POST /api/ig/publish → { caption, assets?: [{base64, mime}], images?: [...], imageBase64?, imageMime?, llmConfig?, forceWebwright? }
app.post('/api/ig/publish', async (req, res) => {
  const { caption, assets, images, imageBase64, imageMime, llmConfig, forceWebwright } = req.body;
  try {
    const finalAssets = assets || images || (imageBase64 ? [{ base64: imageBase64, mime: imageMime }] : []);
    const result = await igPublish({ caption, assets: finalAssets, llmConfig, forceWebwright });
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
