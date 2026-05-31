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

    await page.waitForTimeout(3000);

    // Dismiss any "Remember Password" or overlay notifications
    await dismissOverlays(page);

    // Click the "What's on your mind?" composer input to open the post dialog
    const composerClicked = await tryClickComposer(page);
    if (!composerClicked) {
      throw new Error('找不到 Facebook 發文框，頁面可能已更新，請手動發文。');
    }

    // Wait for dialog/modal to appear
    await page.waitForTimeout(2000);

    // Upload image if provided
    if (imageBase64) {
      const ext = (imageMime || '').includes('png') ? 'png' : 'jpg';
      tmpFile = path.join(os.tmpdir(), `fb-${Date.now()}.${ext}`);
      fs.writeFileSync(tmpFile, Buffer.from(imageBase64, 'base64'));

      let attached = false;
      try {
        // Intercept native filechooser via clicking the photo button (prevents OS dialog from opening)
        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });
        const photoClicked = await tryClickPhotoButton(page);
        if (!photoClicked) {
          throw new Error('找不到 Facebook 圖片上傳按鈕，請手動新增圖片後發文。');
        }
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(tmpFile);
        attached = true;
        console.log('FB: Successfully uploaded image via filechooser interception.');
      } catch (uploadErr) {
        console.warn('FB: File chooser interception failed, trying direct setInputFiles fallback:', uploadErr.message);
      }

      if (!attached) {
        await page.waitForTimeout(1500);
        // Attach file via all hidden inputs (loop to handle multiple file inputs robustly)
        const fileInputs = page.locator('input[type="file"]');
        const count = await fileInputs.count();
        for (let i = 0; i < count; i++) {
          try {
            await fileInputs.nth(i).setInputFiles(tmpFile);
            attached = true;
            console.log(`FB: Successfully attached image to input file #${i} directly.`);
          } catch (e) {
            console.warn(`FB: Failed attaching to input file #${i}:`, e.message);
          }
        }
      }

      if (!attached) {
        throw new Error('無法在 Facebook 上傳圖片，找不到檔案輸入框。');
      }
      await page.waitForTimeout(3500); // wait for image to process
    }

    // Type the caption in the post composer
    await typeCaption(page, caption);
    await page.waitForTimeout(1000);

    // Click Post button (first step, e.g., "繼續" or "發佈")
    const posted = await tryClickPostButton(page);
    if (!posted) {
      throw new Error('找不到「發布」按鈕，請手動點擊發布。瀏覽器視窗保持開啟。');
    }

    // Since Facebook might show a second confirmation dialog (e.g. default audience settings, cross-posting, or final "分享")
    // we wait a moment and try clicking the post button again to clear any secondary steps
    for (let step = 0; step < 2; step++) {
      await page.waitForTimeout(2000);
      try {
        const secondaryDialogVisible = await page.locator('div[role="dialog"]').count() > 0;
        if (secondaryDialogVisible) {
          console.log(`FB: Detected active dialog on confirmation step ${step + 1}, trying to click post button again.`);
          await tryClickPostButton(page);
        } else {
          break; // no dialog, post probably finished
        }
      } catch (e) {
        break;
      }
    }

    // Wait for the active composer dialog to disappear, indicating successful publish
    try {
      await page.locator('div[role="dialog"]').waitFor({ state: 'detached', timeout: 4000 });
      console.log('FB: Post dialog detached successfully. Closing browser.');
    } catch (e) {
      console.warn('FB: Timeout waiting for post dialog to detach, closing anyway.');
    }

    await page.waitForTimeout(1000);
    await browser.close().catch(() => {});

    return { success: true };
  } catch (err) {
    // Save debug artifacts to help diagnose UI selector failures
    try {
      const stamp = Date.now();
      const debugDir = path.join(os.tmpdir(), `fb-debug-${stamp}`);
      try { fs.mkdirSync(debugDir, { recursive: true }); } catch {}
      try {
        const ssPath = path.join(debugDir, 'page.png');
        await page.screenshot({ path: ssPath, fullPage: true });
      } catch (e) {}
      try {
        const html = await page.content();
        fs.writeFileSync(path.join(debugDir, 'page.html'), html, 'utf-8');
      } catch (e) {}
      console.error('fb.publish debug artifacts saved to', debugDir);
      const enhanced = new Error(`${err.message} (debug artifacts: ${debugDir})`);
      throw enhanced;
    } finally {
      if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
      await browser.close().catch(() => {});
    }
  } finally {
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function dismissOverlays(page) {
  const selectors = [
    'div[role="dialog"] button:has-text("稍後再說")',
    'div[role="dialog"] [role="button"]:has-text("稍後再說")',
    'button:has-text("稍後再說")',
    '[role="button"]:has-text("稍後再說")',
    'div[role="dialog"] button:has-text("稍後")',
    'div[role="dialog"] button:has-text("確定")',
    'button:has-text("Not Now")',
    'button:has-text("Later")',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        await page.waitForTimeout(1000);
      }
    } catch {}
  }
}

async function tryClickComposer(page) {
  const selectors = [
    // Aria-label based (most stable across languages)
    '[aria-label*="mind"]',
    '[aria-label*="想說什麼"]',
    '[aria-label*="在想些什麼"]',
    '[aria-label*="想分享"]',
    '[aria-label*="有什麼新鮮事"]',
    '[aria-label*="新鮮事"]',
    // Data-testid based
    '[data-testid="status-attachment-mentions-input"]',
    // Role-based inside the feed composer
    '[data-pagelet="FeedComposer"] [role="button"]',
    // Text-based fallback
    'div[role="button"]:has-text("What\'s on your mind")',
    'div[role="button"]:has-text("有什麼新鮮事")',
    'div[role="button"]:has-text("在想些什麼")',
    'div[role="button"]:has-text("想分享")',
  ];

  // Try standard selectors first
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

  // Fallback: search for elements with visible text containing main phrases
  const textMatches = [
    'text="在想些什麼"',
    'text="想分享"',
    'text="What\'s on your mind"',
  ];
  for (const textSel of textMatches) {
    try {
      const el = page.locator(textSel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        return true;
      }
    } catch {}
  }

  return false;
}

async function tryClickPhotoButton(page) {
  const selectors = [
    'div[role="dialog"] [aria-label*="Photo"]',
    'div[role="dialog"] [aria-label*="photo"]',
    'div[role="dialog"] [aria-label*="圖片"]',
    'div[role="dialog"] [aria-label*="相片"]',
    'div[role="dialog"] [aria-label*="相片／影片"]',
    'div[role="dialog"] [aria-label*="相片/影片"]',
    'div[role="dialog"] div[role="button"]:has-text("Photo")',
    'div[role="dialog"] div[role="button"]:has-text("相片")',
    'div[role="dialog"] div[role="button"]:has-text("相片/影片")',
    // Icon-based inside dialog
    'div[role="dialog"] i[style*="photo"]',
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

  // Structural selector: find the container titled "新增到貼文" or "Add to your post"
  // INSIDE the active dialog box and click its very first button child
  try {
    const containers = [
      'div[role="dialog"] div:has-text("新增到貼文")',
      'div[role="dialog"] div:has-text("新增至貼文")',
      'div[role="dialog"] div:has-text("Add to your post")',
      'div[role="dialog"] div:has-text("Add to Post")',
    ];
    for (const cSel of containers) {
      const containerEl = page.locator(cSel).last(); // last in DOM is usually the active dialog box
      if (await containerEl.isVisible({ timeout: 1500 })) {
        const firstBtn = containerEl.locator('[role="button"]').first();
        if (await firstBtn.isVisible({ timeout: 1500 })) {
          await firstBtn.click();
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('Facebook structural photo button selector failed:', err.message);
  }

  return false;
}

async function typeCaption(page, caption) {
  const selectors = [
    // Contenteditable composer areas
    '[contenteditable="true"][aria-label*="mind"]',
    '[contenteditable="true"][aria-label*="想說什麼"]',
    '[contenteditable="true"][aria-label*="在想些什麼"]',
    '[contenteditable="true"][aria-label*="想分享"]',
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
    'div[role="dialog"] [aria-label="發佈"]',
    'div[role="dialog"] [aria-label="發布"]',
    'div[role="dialog"] [aria-label="分享"]',
    'div[role="dialog"] [aria-label="繼續"]',
    'div[role="dialog"] div[role="button"]:has-text("Post")',
    'div[role="dialog"] div[role="button"]:has-text("發貼文")',
    'div[role="dialog"] div[role="button"]:has-text("發布")',
    'div[role="dialog"] div[role="button"]:has-text("發佈")',
    'div[role="dialog"] div[role="button"]:has-text("繼續")',
    'div[role="dialog"] div[role="button"]:has-text("下一步")',
    'div[role="dialog"] div[role="button"]:has-text("分享")',
    'div[role="dialog"] div[role="button"]:has-text("確定")',
    'div[role="dialog"] div[role="button"]:has-text("儲存")',
    'div[role="dialog"] [role="button"]:has-text("繼續")',
    'div[role="dialog"] [role="button"]:has-text("發佈")',
    'div[role="dialog"] [role="button"]:has-text("發布")',
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

