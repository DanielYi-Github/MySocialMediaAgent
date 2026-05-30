import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { checkLoginStatus, openLoginBrowser, publish } from './xhs.js';

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

app.listen(PORT, () => {
  console.log(`XHS 自動化服務已啟動：http://localhost:${PORT}`);
  console.log('等待前端請求...');
});
