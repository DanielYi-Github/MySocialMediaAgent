import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { healAndExecute } from './agent/heal-engine.js';

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
 * @param {Array}  [opts.images]      - Array of { base64, mime }
 */
export async function publish({ caption, images = [], llmConfig = null, forceWebwright = false }) {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: LAUNCH_ARGS,
  });
  const page = await browser.newPage();
  let tmpFiles = [];

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

    if (images && images.length > 0) {
      tmpFiles = images.map((img, idx) => {
        const ext = (img.mime || '').includes('png') ? 'png' : 'jpg';
        const tmpPath = path.join(os.tmpdir(), `fb-${Date.now()}-${idx}.${ext}`);
        fs.writeFileSync(tmpPath, Buffer.from(img.base64, 'base64'));
        return tmpPath;
      });
    }

    if (forceWebwright) {
      console.log('FB: forceWebwright is true. Handing over entirely to Webwright...');
      const uploadInstruction = tmpFiles.length > 0 
        ? `\n2. 點擊上傳圖片按鈕（綠色相片圖示），或當出現選擇檔案時，請透過找出對應 input[type="file"]，並使用 .setInputFiles([${tmpFiles.map(t => `'${t}'`).join(', ')}]) 上傳圖片。` 
        : '';
      const goal = `請幫我完成完整的 Facebook 發文流程：\n1. 點擊首頁上的「有什麼新鮮事？」發文框。${uploadInstruction}\n3. 尋找文案輸入框，並輸入內容：\n${caption}\n4. 最後點擊「發佈」按鈕完成發文。`;
      await healAndExecute(page, goal, new Error('強制啟用 Webwright 模式'), llmConfig);
      await page.waitForTimeout(4000);
      setTimeout(() => browser.close().catch(() => {}), 5000);
      return { success: true };
    }

    // Click the "What's on your mind?" composer input to open the post dialog
    const composerClicked = await tryClickComposer(page);
    if (!composerClicked) {
      if (llmConfig) {
        console.log('FB: tryClickComposer failed, trying Self-Healing...');
        await healAndExecute(page, '點擊 Facebook 首頁上的「有什麼新鮮事？」發文框', new Error('tryClickComposer: all selectors failed'), llmConfig);
        await page.waitForTimeout(2000);
      } else {
        throw new Error('找不到 Facebook 發文框，頁面可能已更新，請手動發文。');
      }
    }

    // Wait for dialog/modal to appear
    await page.waitForTimeout(2000);

    // Upload images if provided
    if (images && images.length > 0) {
      let attached = false;
      try {
        // Intercept native filechooser via clicking the photo button (prevents OS dialog from opening)
        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });
        const photoClicked = await tryClickPhotoButton(page);
        if (!photoClicked) {
          throw new Error('找不到 Facebook 圖片上傳按鈕，請手動新增圖片後發文。');
        }
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(tmpFiles);
        attached = true;
        console.log(`FB: Successfully uploaded ${tmpFiles.length} images via filechooser interception.`);
      } catch (uploadErr) {
        console.warn('FB: File chooser interception failed, trying direct setInputFiles fallback:', uploadErr.message);
      }

      if (!attached) {
        await page.waitForTimeout(1500);
        // Attach files via all hidden inputs (loop to handle multiple file inputs robustly)
        const fileInputs = page.locator('input[type="file"]');
        const count = await fileInputs.count();
        for (let i = 0; i < count; i++) {
          try {
            await fileInputs.nth(i).setInputFiles(tmpFiles);
            attached = true;
            console.log(`FB: Successfully attached images to input file #${i} directly.`);
          } catch (e) {
            console.warn(`FB: Failed attaching to input file #${i}:`, e.message);
          }
        }
      }

      if (!attached) {
        throw new Error('無法在 Facebook 上傳圖片，找不到檔案輸入框。');
      }
      await page.waitForTimeout(3500); // wait for images to process
    }

    // Type the caption in the post composer
    await typeCaption(page, caption);
    await page.waitForTimeout(1000);

    // Click Post button (first step, e.g., "繼續" or "發佈")
    const posted = await tryClickPostButton(page);
    if (!posted) {
      if (llmConfig) {
        console.log('FB: tryClickPostButton failed, trying Self-Healing...');
        await healAndExecute(page, '點擊 Facebook 發文對話框中的「發佈」按鈕', new Error('tryClickPostButton: all selectors failed'), llmConfig);
      } else {
        throw new Error('找不到「發布」按鈕，請手動點擊發布。瀏覽器視窗保持開啟。');
      }
    }

    // Since Facebook might show a second confirmation dialog (e.g. default audience settings, cross-posting, or final "分享")
    // we wait a moment and try clicking the post button again to clear any secondary steps
    for (let step = 0; step < 2; step++) {
      await page.waitForTimeout(2000);
      try {
        const clickedAgain = await tryClickPostButton(page);
        if (clickedAgain) {
          console.log(`FB: Clicked a secondary post/share button at step ${step + 1}.`);
        } else {
          console.log(`FB: No secondary post/share buttons found at step ${step + 1}. Post likely finished.`);
          break; // no more buttons to click
        }
      } catch (e) {
        break;
      }
    }

    await page.waitForTimeout(2000);
    console.log('FB: Post process finished. Closing browser.');

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
      // 極短的 timeout，因為對話框如果可見，按鈕就應該立刻被找到。避免無按鈕時卡住長達數十秒。
      const visible = await el.isVisible({ timeout: 400 });
      if (visible) {
        await el.click();
        return true;
      }
    } catch {}
  }
  return false;
}

