import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Persistent browser profile saves Facebook login state across sessions
const PROFILE_DIR = path.join(os.homedir(), '.mysocial-agent-fb');

// Common launch args: disable automation flag to reduce detection
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
];

/**
 * Check if the user is currently logged into Facebook personal account.
 * Detects the `c_user` cookie which identifies a logged-in user session.
 */
export async function checkLoginStatus() {
  let browser;
  try {
    browser = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      args: LAUNCH_ARGS,
    });
    const page = await browser.newPage();
    await page.goto('https://www.facebook.com', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(1500);
    const cookies = await browser.cookies('https://www.facebook.com');
    const loggedIn = cookies.some(c => c.name === 'c_user' && c.value);
    return loggedIn;
  } catch {
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Open a visible browser window for the user to manually log into Facebook.
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
      await page.goto('https://www.facebook.com');

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
          const cookies = await browser.cookies('https://www.facebook.com');
          const loggedIn = cookies.some(c => c.name === 'c_user' && c.value);
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
 * Publish an image+text post to Facebook personal timeline via browser automation.
 *
 * @param {object} opts
 * @param {string} opts.caption       - Post text/caption
 * @param {string} [opts.imageBase64] - Base64-encoded image
 * @param {string} [opts.imageMime]   - Image MIME type (default: image/jpeg)
 */
export async function publish({ caption, imageBase64, imageMime = 'image/jpeg' }) {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: LAUNCH_ARGS,
  });
  const page = await browser.newPage();
  let tmpFile = null;

  try {
    await page.goto('https://www.facebook.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Verify login
    const cookies = await browser.cookies('https://www.facebook.com');
    const loggedIn = cookies.some(c => c.name === 'c_user' && c.value);
    if (!loggedIn) {
      throw new Error('Facebook 未登入，請先點擊「登入 Facebook」按鈕完成登入。');
    }

    await page.waitForTimeout(2000);

    // Click the "What's on your mind?" composer input to open the post dialog
    // Try multiple selectors in order of reliability
    const composerClicked = await tryClickComposer(page);
    if (!composerClicked) {
      throw new Error('找不到 Facebook 發文框，頁面可能已更新，請手動發文。');
    }

    // Wait for dialog/modal to appear
    await page.waitForTimeout(1500);

    // Upload image if provided
    if (imageBase64) {
      const ext = (imageMime || '').includes('png') ? 'png' : 'jpg';
      tmpFile = path.join(os.tmpdir(), `fb-${Date.now()}.${ext}`);
      fs.writeFileSync(tmpFile, Buffer.from(imageBase64, 'base64'));

      // Click photo/video button inside the composer dialog
      const photoClicked = await tryClickPhotoButton(page);
      if (!photoClicked) {
        throw new Error('找不到 Facebook 圖片上傳按鈕，請手動新增圖片後發文。');
      }

      await page.waitForTimeout(1000);

      // Attach file via hidden input
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached', timeout: 10000 });
      await fileInput.setInputFiles(tmpFile);
      await page.waitForTimeout(3000); // wait for image to process
    }

    // Type the caption in the post composer
    // The editable area in Facebook's composer is a contenteditable div
    await typeCaption(page, caption);
    await page.waitForTimeout(800);

    // Click Post button
    const posted = await tryClickPostButton(page);
    if (!posted) {
      throw new Error('找不到「發布」按鈕，請手動點擊發布。瀏覽器視窗保持開啟。');
    }

    await page.waitForTimeout(3000);
    setTimeout(() => browser.close().catch(() => {}), 5000);

    return { success: true };
  } catch (err) {
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
    await browser.close().catch(() => {});
    throw err;
  } finally {
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function tryClickComposer(page) {
  const selectors = [
    // Aria-label based (most stable across languages)
    '[aria-label*="mind"]',
    '[aria-label*="想說什麼"]',
    '[aria-label*="有什麼新鮮事"]',
    // Data-testid based
    '[data-testid="status-attachment-mentions-input"]',
    // Role-based inside the feed composer
    '[data-pagelet="FeedComposer"] [role="button"]',
    // Text-based fallback
    'div[role="button"]:has-text("What\'s on your mind")',
    'div[role="button"]:has-text("有什麼新鮮事")',
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

async function tryClickPhotoButton(page) {
  const selectors = [
    '[aria-label*="Photo"]',
    '[aria-label*="photo"]',
    '[aria-label*="圖片"]',
    '[aria-label*="相片"]',
    'div[role="button"]:has-text("Photo")',
    'div[role="button"]:has-text("相片")',
    // Icon-based
    'i[style*="photo"]',
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

async function typeCaption(page, caption) {
  const selectors = [
    // Contenteditable composer areas
    '[contenteditable="true"][aria-label*="mind"]',
    '[contenteditable="true"][aria-label*="想說什麼"]',
    '[contenteditable="true"][aria-label*="有什麼新鮮事"]',
    // Generic contenteditable in the dialog
    'div[role="dialog"] [contenteditable="true"]',
    '[contenteditable="true"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const visible = await el.isVisible({ timeout: 3000 });
      if (visible) {
        await el.click();
        await el.fill('');
        await page.keyboard.type(caption, { delay: 20 });
        return;
      }
    } catch {}
  }
  // Last resort: type at currently focused element
  await page.keyboard.type(caption, { delay: 20 });
}

async function tryClickPostButton(page) {
  const selectors = [
    'div[role="dialog"] [aria-label="Post"]',
    'div[role="dialog"] [aria-label="發貼文"]',
    'div[role="dialog"] div[role="button"]:has-text("Post")',
    'div[role="dialog"] div[role="button"]:has-text("發貼文")',
    'div[role="dialog"] div[role="button"]:has-text("發布")',
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
