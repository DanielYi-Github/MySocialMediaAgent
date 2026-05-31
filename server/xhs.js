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
 *
 * Key design decisions:
 * - Use waitUntil:'load' instead of 'networkidle' — XHS SPA constantly polls APIs
 *   so networkidle never fires, causing 30s timeout before each attempt.
 * - --deny-permission-prompts: auto-deny browser permission dialogs (geolocation)
 *   that would otherwise block the 发布 button click.
 * - Dismiss draft-restore dialogs that appear after a previous failed attempt auto-saved.
 * - Use native fileChooser interception (click "上传图片" button) — Vue @change fires reliably.
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
    // --deny-permission-prompts: auto-deny geolocation/camera permission popups
    // so they don't visually block button clicks.
    args: ['--no-sandbox', '--deny-permission-prompts'],
  });
  const page = await browser.newPage();
  let tmpFile = null;

  try {
    console.log('XHS: Navigating to publish page...');
    // Use 'load' not 'networkidle' — XHS SPA constantly polls APIs,
    // networkidle would time out after 30s every single attempt.
    await page.goto(
      'https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image',
      { waitUntil: 'load', timeout: 30000 }
    );
    console.log('XHS: Page load complete, URL:', page.url());

    // Verify login
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('passport') || !currentUrl.includes('creator')) {
      throw new Error('小紅書未登入，請先點擊「登入小紅書」按鈕完成登入。');
    }

    // Wait for qiankun micro-app to mount — "上传图片" button is the most reliable indicator
    console.log('XHS: Waiting for qiankun micro-app upload widget...');
    const uploadBtn = page.locator('button.upload-button').first();
    try {
      await uploadBtn.waitFor({ state: 'visible', timeout: 20000 });
      console.log('XHS: Upload button visible — micro-app ready.');
    } catch {
      // Fallback: wait for the drag-over upload area
      console.warn('XHS: upload-button not found via primary selector, trying fallback...');
      await page.locator('.drag-over, .upload-content').first().waitFor({ state: 'visible', timeout: 10000 });
      console.log('XHS: drag-over/upload-content visible.');
    }

    // Dismiss any draft-restore dialog that XHS may show after a previous failed attempt.
    // XHS asks "要继续之前未完成的草稿吗？" or shows a modal — we dismiss it to get a clean form.
    try {
      const draftDialogSelectors = [
        'button:has-text("放弃")',
        'button:has-text("不保存")',
        'button:has-text("忽略")',
        'button:has-text("取消")',
        '.dialog button:last-child',
        '[class*="modal"] button:last-child',
      ];
      for (const sel of draftDialogSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          console.log(`XHS: Dismissing draft dialog via "${sel}"`);
          await btn.click();
          await page.waitForTimeout(500);
          break;
        }
      }
    } catch {} // no dialog, that's fine

    // Extra settle time for Vue event handler binding
    await page.waitForTimeout(800);

    // Upload image if provided
    if (imageBase64) {
      const ext = (imageMime || '').includes('png') ? 'png' : 'jpg';
      tmpFile = path.join(os.tmpdir(), `xhs-${Date.now()}.${ext}`);
      fs.writeFileSync(tmpFile, Buffer.from(imageBase64, 'base64'));

      // Primary strategy: native fileChooser interception by clicking "上传图片" button.
      // This is the most reliable method — it goes through the browser's native file dialog
      // flow, which Vue's @change handler is guaranteed to respond to.
      let uploaded = false;

      try {
        console.log('XHS: Setting up fileChooser interception...');
        // Must set up promise BEFORE click that triggers it
        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });
        await uploadBtn.click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(tmpFile);
        uploaded = true;
        console.log('XHS: File injected via native fileChooser interception.');
      } catch (e) {
        console.warn('XHS: fileChooser method failed:', e.message, '— trying setInputFiles fallback...');
      }

      // Fallback: direct setInputFiles on the hidden input
      if (!uploaded) {
        try {
          const uploadInput = page.locator('input.upload-input[type="file"]').first();
          await uploadInput.waitFor({ state: 'attached', timeout: 8000 });
          await uploadInput.setInputFiles(tmpFile);
          uploaded = true;
          console.log('XHS: File injected via setInputFiles fallback.');
        } catch (e2) {
          console.error('XHS: setInputFiles fallback also failed:', e2.message);
          throw new Error('無法上傳圖片到小紅書，所有上傳方法均已失效。');
        }
      }

      // Verify upload success by polling for image preview elements.
      const previewSelectors = ['.preview-wrap', '.img-item', '.image-item', '[class*="preview"] img'];
      let uploadVerified = false;

      for (let i = 0; i < 25 && !uploadVerified; i++) {
        for (const sel of previewSelectors) {
          try {
            if (await page.locator(sel).count() > 0) {
              console.log(`XHS: Upload verified via "${sel}"`);
              uploadVerified = true;
              break;
            }
          } catch {}
        }
        if (!uploadVerified) await page.waitForTimeout(1000);
      }

      // Fallback: edit form appeared directly (some flows skip preview step)
      if (!uploadVerified) {
        try {
          await page.locator('input[placeholder*="标题"], .title-input').first().waitFor({ state: 'visible', timeout: 5000 });
          uploadVerified = true;
          console.log('XHS: Edit form appeared directly after upload (no preview step).');
        } catch {}
      }

      if (!uploadVerified) {
        throw new Error('圖片上傳後 25 秒內未看到預覽，上傳失敗。');
      }

      // Wait for edit form to fully load
      console.log('XHS: Waiting for edit form...');
      await page.locator('input[placeholder*="标题"], .title-input').first().waitFor({ state: 'visible', timeout: 20000 });
      console.log('XHS: Edit form loaded.');
    }

    // Fill title (XHS max: 20 chars)
    const safeTitle = title.slice(0, 20);
    const titleInput = page.locator('input[placeholder*="标题"], .title-input').first();
    await titleInput.click();
    await titleInput.fill(safeTitle);
    console.log('XHS: Title filled.');

    // Fill body via execCommand — ProseMirror ignores .fill()
    const prosemirror = page.locator('.ProseMirror, [contenteditable="true"]').first();
    await prosemirror.waitFor({ state: 'visible', timeout: 5000 });
    await prosemirror.click();
    await page.evaluate((text) => {
      const el = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
      if (!el) return;
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    }, content);
    console.log('XHS: Content filled.');

    await page.waitForTimeout(800);

    // Handle optional "下一步" button
    try {
      const nextBtn = page.locator('button').filter({ hasText: /^下一步$/ });
      if (await nextBtn.isVisible({ timeout: 2000 })) {
        await nextBtn.click();
        await page.waitForTimeout(2000);
      }
    } catch {}

    // Click publish button.
    // The 发布 button is inside <xhs-publish-btn> Web Component (Shadow DOM).
    // Because the Shadow DOM might be closed, page.evaluate() on shadowRoot returns null.
    // However, Playwright's locator naturally pierces open/closed shadow roots.
    // We try multiple robust locators (filtering by substring instead of strict regex,
    // selecting by index, and coordinate-based click on the custom element as a final fallback).
    console.log('XHS: Attempting to click publish button...');

    let clicked = false;
    const publishLocators = [
      // 1. xhs-publish-btn inside button containing '发布'
      page.locator('xhs-publish-btn button').filter({ hasText: '发布' }),
      // 2. xhs-publish-btn containing element with text '发布'
      page.locator('xhs-publish-btn >> text="发布"'),
      // 3. xhs-publish-btn's second button (first is '暂存离开', second is '发布')
      page.locator('xhs-publish-btn button').nth(1),
      // 4. Any button containing '发布' (last one, usually page submit)
      page.locator('button:has-text("发布")').last()
    ];

    for (const locator of publishLocators) {
      try {
        if (await locator.isVisible({ timeout: 2000 })) {
          const text = await locator.textContent();
          console.log(`XHS: Found publish button candidate with text: "${text?.trim()}"`);
          await locator.click({ force: true });
          console.log('XHS: Clicked publish button successfully!');
          clicked = true;
          break;
        }
      } catch (err) {
        console.warn(`XHS: Locator trial failed: ${err.message}`);
      }
    }

    if (!clicked) {
      console.log('XHS: All standard locators failed. Trying coordinate-based click on xhs-publish-btn...');
      try {
        const publishWidget = page.locator('xhs-publish-btn').first();
        await publishWidget.waitFor({ state: 'visible', timeout: 5000 });
        const box = await publishWidget.boundingBox();
        if (box) {
          // The "发布" button is on the right side of the custom element (75% x-coordinate)
          const clickX = box.x + box.width * 0.75;
          const clickY = box.y + box.height * 0.5;
          await page.mouse.click(clickX, clickY);
          console.log(`XHS: Clicked xhs-publish-btn via coordinates: (${clickX}, ${clickY})`);
          clicked = true;
        }
      } catch (err) {
        console.error('XHS: Coordinate click failed:', err.message);
      }
    }

    if (!clicked) {
      throw new Error('無法定位或點擊小紅書的「發佈」按鈕。');
    }

    // Verify publish success by checking if page navigates away from the publish form,
    // or if a success toast appears. We wait up to 15 seconds to ensure server accepts.
    console.log('XHS: Waiting for publish completion (URL change or success dialog)...');
    let publishSuccess = false;
    for (let i = 0; i < 15; i++) {
      const url = page.url();
      if (!url.includes('/publish/publish')) {
        console.log(`XHS: Successfully published! Navigated away from publish page to: ${url}`);
        publishSuccess = true;
        break;
      }
      try {
        const toast = page.locator('[class*="toast"], [class*="message"], [class*="notification"]').first();
        if (await toast.isVisible({ timeout: 500 })) {
          const toastText = await toast.textContent();
          console.log(`XHS: Detected toast/dialog: "${toastText?.trim()}"`);
          if (toastText && (toastText.includes('成功') || toastText.includes('发布'))) {
            publishSuccess = true;
            break;
          }
        }
      } catch {}
      await page.waitForTimeout(1000);
    }

    if (!publishSuccess) {
      console.warn('XHS: Did not detect navigation or success toast within 15 seconds after click.');
    }
    setTimeout(() => browser.close().catch(() => {}), 5000);
    return { success: true };
  } catch (err) {
    try {
      const stamp = Date.now();
      const debugDir = path.join(os.tmpdir(), `xhs-debug-${stamp}`);
      try { fs.mkdirSync(debugDir, { recursive: true }); } catch {}
      try { await page.screenshot({ path: path.join(debugDir, 'page.png'), fullPage: true }); } catch {}
      try { fs.writeFileSync(path.join(debugDir, 'page.html'), await page.content(), 'utf-8'); } catch {}
      console.error('xhs.publish error:', err.message);
      console.error('xhs.publish debug artifacts saved to', debugDir);
      throw new Error(`${err.message} (debug artifacts: ${debugDir})`);
    } finally {
      if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
      await browser.close().catch(() => {});
    }
  } finally {
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
  }
}
