import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { healAndExecute } from './agent/heal-engine.js';

// Persistent browser profile saves Instagram login state across sessions
const PROFILE_DIR = path.join(os.homedir(), '.mysocial-agent-ig');

// Common launch args: disable automation flag to reduce detection
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
];

/**
 * Check if the user is currently logged into Instagram personal account.
 * Detects the `sessionid` cookie which identifies a logged-in session.
 */
export async function checkLoginStatus() {
  let browser;
  try {
    browser = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      args: LAUNCH_ARGS,
    });
    const page = await browser.newPage();
    await page.goto('https://www.instagram.com', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(1500);
    const cookies = await browser.cookies('https://www.instagram.com');
    const loggedIn = cookies.some(c => c.name === 'sessionid' && c.value);
    return loggedIn;
  } catch {
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Open a visible browser window for the user to manually log into Instagram.
 * Polls every 2s until login is detected (up to 5 minutes), then closes.
 */
export async function openLoginBrowser() {
  return new Promise(async (resolve, reject) => {
    let browser;
    try {
      browser = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        viewport: { width: 1280, height: 800 },
        args: LAUNCH_ARGS,
      });
      const page = await browser.newPage();
      await page.goto('https://www.instagram.com');

      let resolved = false;

      const timeout = setTimeout(async () => {
        if (resolved) return;
        resolved = true;
        await browser.close().catch(() => {});
        reject(new Error('登入逾時（5 分鐘），請重試。'));
      }, 5 * 60 * 1000);

      const poll = setInterval(async () => {
        if (resolved) return;
        try {
          const cookies = await browser.cookies('https://www.instagram.com');
          const loggedIn = cookies.some(c => c.name === 'sessionid' && c.value);
          if (loggedIn) {
            resolved = true;
            clearInterval(poll);
            clearTimeout(timeout);
            await browser.close().catch(() => {});
            resolve({ success: true });
          }
        } catch {} // page navigating, ignore
      }, 2000);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Publish an image+text post to Instagram personal account via browser automation.
 *
 * @param {object} opts
 * @param {string} opts.caption       - Post caption
 * @param {Array}  [opts.images]      - Array of { base64, mime } (required for IG)
 */
export async function publish({ caption, images = [], llmConfig = null }) {
  if (!images || images.length === 0) {
    throw new Error('Instagram 發文必須包含圖片。');
  }

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: LAUNCH_ARGS,
  });
  const page = await browser.newPage();
  let tmpFiles = [];

  try {
    await page.goto('https://www.instagram.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Verify login
    const cookies = await browser.cookies('https://www.instagram.com');
    const loggedIn = cookies.some(c => c.name === 'sessionid' && c.value);
    if (!loggedIn) {
      throw new Error('Instagram 未登入，請先點擊「登入 Instagram」按鈕完成登入。');
    }

    await page.waitForTimeout(2000);

    // 關閉任何「開啟通知」或「稍後再說」的彈出視窗
    try {
      const notNowSelectors = [
        'button:has-text("稍後再說")',
        'button:has-text("Not Now")',
        '[role="button"]:has-text("稍後再說")',
        '[role="button"]:has-text("Not Now")'
      ];
      for (const sel of notNowSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          console.log('IG: Dismissing "Not Now" dialog.');
          await btn.click();
          await page.waitForTimeout(1000);
          break;
        }
      }
    } catch {}

    // Click the Create/New Post button (+)
    const createClicked = await tryClickCreateButton(page);
    if (!createClicked) {
      if (llmConfig) {
        console.log('IG: tryClickCreateButton failed, trying Self-Healing...');
        await healAndExecute(page, '點擊 Instagram 導覽欄中的「+」建立貼文按鈕', new Error('tryClickCreateButton: all selectors failed'), llmConfig);
        await page.waitForTimeout(1500);
      } else {
        throw new Error('找不到 Instagram 建立貼文按鈕，頁面可能已更新，請手動發文。');
      }
    }

    await page.waitForTimeout(1500);

    // Prepare temp files for upload
    tmpFiles = images.map((img, idx) => {
      const ext = (img.mime || '').includes('png') ? 'png' : 'jpg';
      const tmpPath = path.join(os.tmpdir(), `ig-${Date.now()}-${idx}.${ext}`);
      fs.writeFileSync(tmpPath, Buffer.from(img.base64, 'base64'));
      return tmpPath;
    });

    // Click "Select from computer" or directly trigger file input
    const fileAttached = await attachFile(page, tmpFiles);
    if (!fileAttached) {
      throw new Error('找不到 Instagram 圖片上傳按鈕，請手動上傳圖片。');
    }

    await page.waitForTimeout(3000); // wait for upload & crop UI

    // Click "Next" through the Crop / Filter / Alt Text steps (up to 3 times)
    for (let i = 0; i < 3; i++) {
      const advanced = await tryClickNext(page);
      if (!advanced) break;
      await page.waitForTimeout(1500);
    }

    // Fill in the caption
    await typeCaption(page, caption);
    await page.waitForTimeout(800);

    // Click Share
    const shared = await tryClickShare(page);
    if (!shared) {
      if (llmConfig) {
        console.log('IG: tryClickShare failed, trying Self-Healing...');
        await healAndExecute(page, '點擊 Instagram 分享對話框中的「分享」按鈕', new Error('tryClickShare: all selectors failed'), llmConfig);
      } else {
        throw new Error('找不到「分享」按鈕，請手動點擊分享。瀏覽器視窗保持開啟。');
      }
    }

    await page.waitForTimeout(4000);
    setTimeout(() => browser.close().catch(() => {}), 5000);

    return { success: true };
  } catch (err) {
    // Save debug artifacts to help diagnose UI selector failures
    try {
      const stamp = Date.now();
      const debugDir = path.join(os.tmpdir(), `ig-debug-${stamp}`);
      try { fs.mkdirSync(debugDir, { recursive: true }); } catch {}
      try {
        const ssPath = path.join(debugDir, 'page.png');
        await page.screenshot({ path: ssPath, fullPage: true });
      } catch (e) {}
      try {
        const html = await page.content();
        fs.writeFileSync(path.join(debugDir, 'page.html'), html, 'utf-8');
      } catch (e) {}
      console.error('ig.publish debug artifacts saved to', debugDir);
      // Append debug path to original error message to return to frontend
      const enhanced = new Error(`${err.message} (debug artifacts: ${debugDir})`);
      throw enhanced;
    } finally {
      if (tmpFiles && tmpFiles.length > 0) {
        tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
      }
      await browser.close().catch(() => {});
    }
  } finally {
    if (tmpFiles && tmpFiles.length > 0) {
      tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function tryClickCreateButton(page) {
  const selectors = [
    // Aria-label based (most stable across IG web versions)
    '[aria-label="New post"]',
    '[aria-label="建立"]',
    '[aria-label="Create"]',
    '[aria-label="新貼文"]',  // Taiwan / Chinese locale (most common current version)
    '[aria-label*="New post"]',
    '[aria-label*="建立"]',
    '[aria-label*="新增"]',
    '[aria-label*="新貼"]',
    // SVG title-based
    'svg[aria-label="New post"]',
    'svg[aria-label="建立"]',
    'svg[aria-label="新貼文"]',
    'svg[aria-label*="新"]',
    // Accessible name text
    'a[href*="create"]',
    // "+" icon link in nav
    'nav a:has(svg[aria-label*="post"])',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const visible = await el.isVisible({ timeout: 3000 });
      if (visible) {
        await el.click();
        return true;
      }
    } catch {}
  }
  return false;
}

async function attachFile(page, tmpFiles) {
  // Try clicking "Select from computer" button first
  const selectSelectors = [
    'button:has-text("Select from computer")',
    'button:has-text("從電腦選取")',
    'button:has-text("Select from")',
    '[role="button"]:has-text("Select from computer")',
    '[role="button"]:has-text("從電腦選取")',
  ];
  for (const sel of selectSelectors) {
    try {
      const el = page.locator(sel).first();
      const visible = await el.isVisible({ timeout: 3000 });
      if (visible) {
        await el.click();
        await page.waitForTimeout(500);
        break;
      }
    } catch {}
  }

  // Regardless, attach via file input
  try {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 10000 });
    await fileInput.setInputFiles(tmpFiles);
    return true;
  } catch {
    return false;
  }
}

async function tryClickNext(page) {
  // "Next" button in IG's multi-step post dialog
  const selectors = [
    'button:has-text("Next")',
    'button:has-text("下一步")',  // Taiwan / Chinese locale
    'button:has-text("繼續")',
    '[role="button"]:has-text("Next")',
    '[role="button"]:has-text("下一步")',
    '[aria-label="下一步"]',
    '[aria-label*="Next"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const visible = await el.isVisible({ timeout: 2000 });
      if (visible) {
        await el.click();
        return true;
      }
    } catch {}
  }
  return false;
}

async function getFirstVisibleLocator(page, selector, timeoutMs = 4000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      try {
        const el = locator.nth(i);
        if (await el.isVisible({ timeout: 100 })) {
          return el;
        }
      } catch {}
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function typeCaption(page, caption) {
  // IG's caption textarea (appears after the final "Next" step)
  // IG uses a contenteditable div for caption, not a textarea
  const selectors = [
    '[aria-label="撰寫說明文字……"]',  // Taiwan / Chinese locale (exact match with proper ellipsis)
    '[aria-label="撰寫說明文字..."]',  // Fallback with English ellipsis
    '[aria-label="Write a caption..."]',
    '[aria-label*="說明"]',  // Match any "說明" (description)
    '[role="textbox"][aria-label*="寫"]',
    '[contenteditable="true"][aria-label*="說明"]',
    '[contenteditable="true"][aria-label*="caption"]',
    'textarea[placeholder*="caption"]',
    'textarea[placeholder*="說明"]',
    '[contenteditable="true"]',
    'textarea',
  ];
  for (const sel of selectors) {
    try {
      const el = await getFirstVisibleLocator(page, sel);
      if (el) {
        await el.focus();
        await el.hover();
        await page.waitForTimeout(300);
        await el.type(caption, { delay: 50 });  // Slower typing for better reliability
        return true;
      }
    } catch {}
  }
  return false;
}

async function tryClickShare(page) {
  const selectors = [
    // 優先使用 Playwright 推薦的 role 定位器，並相容多國語言（英文、繁中、簡中）
    'role=button[name="分享"]',
    'role=button[name="Share"]',
    'role=button[name="發布"]',
    'role=button[name="發佈"]',
    'role=button[name="Publish"]',
    // 傳統 aria-label
    'button[aria-label="分享"]',
    'div[role="button"]:has(svg[aria-label="分享"])',
    'div[role="button"]:has(svg[aria-label*="分享"])',
    '[aria-label="分享"]',
    '[aria-label*="Share"]',
    // Text-based matching
    'button:has-text("Share")',
    'button:has-text("分享")',
    'button:has-text("發布")',
    'button:has-text("發佈")',
    '[role="button"]:has-text("Share")',
    '[role="button"]:has-text("分享")',
    '[role="button"]:has-text("發布")',
    '[role="button"]:has-text("發佈")',
  ];
  for (const sel of selectors) {
    try {
      const el = await getFirstVisibleLocator(page, sel, 4000);
      if (el) {
        await el.hover();  // Move mouse over button first
        await page.waitForTimeout(200);
        await el.click();
        return true;
      }
    } catch {}
  }
  return false;
}
