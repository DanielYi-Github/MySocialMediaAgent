import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE_DIR = path.join(os.homedir(), '.mysocial-agent-xhs');

async function run() {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(5000);

  // We need to trigger the publish button to appear by uploading an image
  const uploadBtn = page.locator('button.upload-button').first();
  if (await uploadBtn.isVisible()) {
    // create a dummy image
    const tmpFile = path.join(os.tmpdir(), `xhs-dummy.png`);
    import('fs').then(fs => fs.writeFileSync(tmpFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64')));
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadBtn.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpFile);
    
    await page.waitForTimeout(5000); // wait for upload and form
    console.log('Image uploaded, waiting for form...');
  }
  
  const widget = page.locator('xhs-publish-btn').first();
  if (await widget.isVisible()) {
    const boxWrapper = await widget.boundingBox();
    console.log('xhs-publish-btn box:', boxWrapper);
    
    // Find innermost elements containing "发布"
    const els = page.locator('xhs-publish-btn >> text="发布"');
    const count = await els.count();
    console.log(`Found ${count} elements containing "发布" inside widget`);
    for (let i = 0; i < count; i++) {
      const el = els.nth(i);
      const tag = await el.evaluate(e => e.tagName);
      const box = await el.boundingBox();
      console.log(`[${i}] <${tag}> box:`, box);
    }
  } else {
    console.log('Widget not visible');
  }

  await browser.close();
}
run().catch(console.error);
