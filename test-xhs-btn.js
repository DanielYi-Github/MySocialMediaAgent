import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE_DIR = path.join(os.homedir(), '.mysocial-agent-xhs');

async function run() {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true, // we can run headless just to inspect DOM
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  console.log('Navigating...');
  await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch&target=image', { waitUntil: 'load', timeout: 30000 });
  
  await page.waitForTimeout(5000); // wait for micro-app
  console.log('Finding elements with text "发布"...');
  
  const locators = page.locator('text="发布"');
  const count = await locators.count();
  console.log(`Found ${count} elements with text "发布"`);
  
  for (let i = 0; i < count; i++) {
    const el = locators.nth(i);
    const tagName = await el.evaluate(e => e.tagName);
    const className = await el.evaluate(e => e.className);
    const box = await el.boundingBox();
    console.log(`[${i}] <${tagName} class="${className}"> Box:`, box);
  }
  
  console.log('\nChecking xhs-publish-btn...');
  const widget = page.locator('xhs-publish-btn');
  if (await widget.count() > 0) {
    const box = await widget.boundingBox();
    console.log('xhs-publish-btn Box:', box);
    // dump outerHTML of widget
    const html = await widget.evaluate(e => e.outerHTML);
    console.log('Widget HTML:', html.substring(0, 500));
  } else {
    console.log('xhs-publish-btn NOT FOUND');
  }

  await browser.close();
}
run().catch(console.error);
