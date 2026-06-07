import { chromium } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { healAndExecute } from './agent/heal-engine.js';
import { runAgentLoop } from './agent/agent-loop.js';
import { buildFacebookPublishGoal } from './agent/publish-goals.js';
import { openComposer, attachFiles, fillCaption, clickPublish, verifyDone } from './agent/facebook-actions.js';
import { buildFacebookMacroPrompt, FACEBOOK_MACRO_SYSTEM_PROMPT } from './agent/agent-prompts.js';

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
 * @param {Array}  [opts.assets]      - Array of { base64, mime }
 */
export async function publish({ caption, assets = [], images = [], llmConfig = null, forceWebwright = false }) {
  const mediaAssets = assets.length > 0 ? assets : images;
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

    if (mediaAssets && mediaAssets.length > 0) {
      tmpFiles = mediaAssets.map((img, idx) => {
        const ext = getFileExtension(img.mime);
        const tmpPath = path.join(os.tmpdir(), `fb-${Date.now()}-${idx}.${ext}`);
        fs.writeFileSync(tmpPath, Buffer.from(img.base64, 'base64'));
        return tmpPath;
      });
    }

    if (forceWebwright) {
      console.log('FB: forceWebwright is true. Using macro-action agent...');
      const goal = buildFacebookPublishGoal({ caption, tmpFiles });
      const actionExecutor = {
        OPEN_COMPOSER: () => openComposer(page),
        ATTACH_FILES: () => attachFiles(page, tmpFiles),
        FILL_CAPTION: () => fillCaption(page, caption),
        CLICK_PUBLISH: () => clickPublish(page),
        VERIFY_DONE: () => verifyDone(page),
      };
      const result = await runAgentLoop(page, goal, llmConfig, {
        maxSteps: 8,
        maxRounds: 2,
        stepTimeout: 15000,
        uploadFiles: tmpFiles,
        actionExecutor,
        promptBuilder: buildFacebookMacroPrompt,
        systemPrompt: FACEBOOK_MACRO_SYSTEM_PROMPT,
      });
      await page.waitForTimeout(4000);
      setTimeout(() => browser.close().catch(() => {}), 5000);
      return result;
    }

    // Main deterministic flow (no macro, no raw code)
    try {
      await openComposer(page);
      await page.waitForTimeout(2000);

      if (mediaAssets && mediaAssets.length > 0) {
        await attachFiles(page, tmpFiles);
      }

      await fillCaption(page, caption);
      await page.waitForTimeout(1000);

      await clickPublish(page);

      // Clear secondary dialogs
      for (let step = 0; step < 2; step++) {
        await page.waitForTimeout(2000);
        try {
          await clickPublish(page);
        } catch {
          break; // no more buttons
        }
      }

      await page.waitForTimeout(2000);
      console.log('FB: Post process finished. Closing browser.');
    } catch (err) {
      if (llmConfig) {
        console.log('FB: Deterministic path failed, trying Self-Healing:', err.message);
        await healAndExecute(page, '完成 Facebook 發文流程', err, llmConfig);
      } else {
        throw err;
      }
    }

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

function getFileExtension(mime = '') {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mov')) return 'mov';
  if (mime.includes('mp4')) return 'mp4';
  return 'jpg';
}
