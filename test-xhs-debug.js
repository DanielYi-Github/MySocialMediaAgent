import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE_DIR = path.join(os.homedir(), '.mysocial-agent-xhs');

async function run() {
  console.log('Starting debug script...');
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--deny-permission-prompts']
  });
  const page = await browser.newPage();
  await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image', { waitUntil: 'load', timeout: 30000 });
  
  await page.waitForTimeout(5000);
  
  const publishWidget = page.locator('xhs-publish-btn').first();
  if (await publishWidget.count() === 0) {
    console.log('xhs-publish-btn NOT FOUND on page!');
  } else {
    const box = await publishWidget.boundingBox();
    console.log('xhs-publish-btn box:', box);
    
    const clickX = box.x + box.width * 0.75;
    const clickY = box.y + box.height * 0.5;
    
    console.log(`Will draw red dot at (${clickX}, ${clickY})`);
    
    // Inject a red dot
    await page.evaluate(({ x, y }) => {
      const dot = document.createElement('div');
      dot.style.position = 'absolute';
      dot.style.left = (x - 5) + 'px';
      dot.style.top = (y - 5) + 'px';
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.backgroundColor = 'red';
      dot.style.borderRadius = '50%';
      dot.style.zIndex = '999999';
      dot.style.pointerEvents = 'none';
      document.body.appendChild(dot);
    }, { x: clickX, y: clickY });
    
    // Take screenshot
    await page.screenshot({ path: 'xhs-click-debug.png', fullPage: true });
    console.log('Saved screenshot to xhs-click-debug.png');
  }
  
  await browser.close();
}
run().catch(console.error);
