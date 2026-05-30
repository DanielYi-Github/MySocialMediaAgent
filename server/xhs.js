import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Persistent browser profile saves XHS login state across sessions
const PROFILE_DIR = path.join(os.homedir(), '.mysocial-agent-xhs');

/**
 * Check if the user is currently logged into XHS creator portal.
 * Uses a headless browser with saved profile to verify session.
 */
export async function checkLoginStatus() {
  let browser;
  try {
    browser = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.goto('https://creator.xiaohongshu.com', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(1500);
    const url = page.url();
    const cookies = await browser.cookies();
    const hasSession = cookies.some(c => c.name === 'web_session' || c.name === 'a1');
    return hasSession && url.includes('creator.xiaohongshu.com') && !url.includes('login');
  } catch {
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Open a visible browser window for the user to manually log into XHS.
 * Polls until login is detected (up to 5 minutes), then closes the browser.
 */
export async function openLoginBrowser() {
  return new Promise(async (resolve, reject) => {
    let browser;
    try {
      browser = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        viewport: { width: 1280, height: 800 },
      });
      const page = await browser.newPage();
      await page.goto('https://creator.xiaohongshu.com');

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
          const url = page.url();
          const cookies = await browser.cookies();
          const hasSession = cookies.some(c => c.name === 'web_session' || c.name === 'a1');
          if (hasSession && url.includes('creator.xiaohongshu.com') && !url.includes('login')) {
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
 * Publish an image+text post to XHS using browser automation.
 * Navigates to the XHS creator portal, fills in the form, and clicks publish.
 *
 * @param {object} opts
 * @param {string} opts.title        - Post title (max 20 chars)
 * @param {string} opts.content      - Post body text
 * @param {string} [opts.imageBase64] - Base64-encoded image (JPEG or PNG)
 * @param {string} [opts.imageMime]  - Image MIME type (default: image/jpeg)
 */
export async function publish({ title, content, imageBase64, imageMime = 'image/jpeg' }) {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  let tmpFile = null;

  try {
    await page.goto(
      'https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image',
      { waitUntil: 'networkidle', timeout: 30000 }
    );

    // Verify login
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('passport') || !currentUrl.includes('creator')) {
      throw new Error('小紅書未登入，請先點擊「登入小紅書」按鈕完成登入。');
    }

    // Upload image if provided
    if (imageBase64) {
      const ext = (imageMime || '').includes('png') ? 'png' : 'jpg';
      tmpFile = path.join(os.tmpdir(), `xhs-${Date.now()}.${ext}`);
      fs.writeFileSync(tmpFile, Buffer.from(imageBase64, 'base64'));

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.waitFor({ state: 'attached', timeout: 15000 });
      await fileInput.setInputFiles(tmpFile);
      // Wait for upload processing
      await page.waitForTimeout(4000);
    }

    // Fill title (XHS max: 20 chars)
    const safeTitle = title.slice(0, 20);
    // Try multiple possible title input selectors
    const titleInput = page.getByPlaceholder(/标题/).or(
      page.locator('[class*="title"] input, .title-input, input[placeholder*="title"]').first()
    );
    await titleInput.waitFor({ timeout: 15000 });
    await titleInput.fill(safeTitle);

    // Fill body content in ProseMirror via execCommand (reliable for contenteditable)
    const editor = page.locator('.ProseMirror').first();
    await editor.waitFor({ timeout: 10000 });
    await editor.click();

    await page.evaluate((text) => {
      const el = document.querySelector('.ProseMirror');
      if (!el) return;
      el.focus();
      // Select all existing content then replace
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    }, content);

    await page.waitForTimeout(800);

    // Handle optional "下一步" button (some XHS flows have a next-step before publish)
    try {
      const nextBtn = page.locator('button').filter({ hasText: /^下一步$/ });
      const isVisible = await nextBtn.isVisible({ timeout: 2000 });
      if (isVisible) {
        await nextBtn.click();
        await page.waitForTimeout(2000);
      }
    } catch {} // no next button, continue

    // Click publish button
    const publishBtn = page.locator('button').filter({ hasText: /^发布$/ });
    try {
      await publishBtn.waitFor({ timeout: 8000 });
      await publishBtn.click();
    } catch {
      throw new Error('找不到「发布」按鈕，頁面可能已更新。瀏覽器視窗保持開啟，請手動點擊發布。');
    }

    await page.waitForTimeout(3000);

    // Leave browser open briefly so user can see the result
    setTimeout(() => browser.close().catch(() => {}), 5000);

    return { success: true };
  } catch (err) {
    // Clean up temp file on error
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    await browser.close().catch(() => {});
    throw err;
  } finally {
    // Ensure temp file is cleaned up
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }
}
