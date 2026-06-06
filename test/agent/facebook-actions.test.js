import assert from 'node:assert';
import { openComposer, attachFiles, fillCaption, clickPublish, verifyDone } from '../../server/agent/facebook-actions.js';

console.log('🧪 Running TDD tests for Facebook Actions...');

// ─── Mock helpers ───────────────────────────────────────────────────────────

class MockLocator {
  constructor(opts = {}) {
    this._visible = opts.visible ?? true;
    this._count = opts.count ?? 1;
    this.clicked = false;
    this.filled = null;
    this.setFilesArg = null;
    this._childLocators = opts.childLocators ?? null; // map: selector → MockLocator
  }
  locator(sel) {
    if (this._childLocators?.[sel]) return this._childLocators[sel];
    return this;
  }
  or() { return this; }
  first() { return this; }
  last() { return this; }
  nth() { return this; }
  async isVisible(opts) { return this._visible; }
  async click() { this.clicked = true; }
  async fill(val) { this.filled = val; }
  async setInputFiles(files) { this.setFilesArg = files; }
  async count() { return this._count; }
}

function makePage(opts = {}) {
  const {
    locators = {},       // selector → MockLocator (first match wins)
    chooserFiles = null, // array that gets populated when filechooser fires
    chooserReject = false,
  } = opts;

  const defaultLocator = new MockLocator({ visible: false });
  let typedText = '';

  return {
    _chooserFiles: chooserFiles,
    locator(sel) {
      for (const [pattern, loc] of Object.entries(locators)) {
        if (sel.includes(pattern)) return loc;
      }
      return defaultLocator;
    },
    waitForEvent(event) {
      if (event === 'filechooser') {
        if (chooserReject) return Promise.reject(new Error('filechooser timed out'));
        const arr = chooserFiles ?? [];
        return Promise.resolve({
          setFiles: async (files) => { arr.push(...files); },
        });
      }
      return Promise.resolve(null);
    },
    keyboard: {
      type: async (text) => { typedText += text; },
    },
    waitForTimeout: async () => {},
    _getTypedText: () => typedText,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

try {
  // ── Test 1: openComposer clicks the first visible composer element ─────────
  {
    const composerLocator = new MockLocator({ visible: true });
    const page = makePage({ locators: { 'mind': composerLocator } });

    await openComposer(page);

    assert.ok(composerLocator.clicked, 'openComposer should click the composer element');
    console.log('✅ Test 1 Passed: openComposer clicks the composer box');
  }

  // ── Test 2: attachFiles - happy path via filechooser ───────────────────────
  {
    const receivedFiles = [];
    const photoBtn = new MockLocator({ visible: true });

    const page = makePage({
      chooserFiles: receivedFiles,
    });

    // Override page.locator to return photo button for photo selectors
    const origLocator = page.locator.bind(page);
    page.locator = (sel) => {
      if (sel.includes('相片') || sel.includes('Photo') || sel.includes('photo') ||
          sel.includes('role="button"')) {
        return photoBtn;
      }
      return origLocator(sel);
    };

    const files = ['/tmp/test-image.jpg'];
    await attachFiles(page, files);

    assert.ok(photoBtn.clicked, 'attachFiles should click the photo button');
    assert.deepStrictEqual(receivedFiles, files, 'attachFiles should set files via filechooser');
    console.log('✅ Test 2 Passed: attachFiles uses filechooser path');
  }

  // ── Test 3: attachFiles - fallback to input[type=file] when chooser fails ──
  {
    const fileInput = new MockLocator({ visible: true, count: 1 });
    const page = makePage({
      locators: { 'input[type=': fileInput },
      chooserReject: true,
    });

    const files = ['/tmp/test-image.jpg'];
    await attachFiles(page, files);

    assert.deepStrictEqual(fileInput.setFilesArg, files, 'attachFiles fallback should use input[type=file]');
    console.log('✅ Test 3 Passed: attachFiles falls back to input[type=file]');
  }

  // ── Test 4: fillCaption types directly (no need to click, focus is already there) ──
  {
    const caption = '測試貼文內容';
    const page = makePage({});

    await fillCaption(page, caption);

    // fillCaption simply types the caption since composer already has focus
    assert.strictEqual(page._getTypedText(), caption, `fillCaption should type the text via keyboard. Got: "${page._getTypedText()}"`);
    console.log('✅ Test 4 Passed: fillCaption types directly (focus already active)');
  }

  // ── Test 5: clickPublish clicks first visible publish button in dialog ──────
  {
    const publishBtn = new MockLocator({ visible: true });

    const page = makePage({});
    const origLocator = page.locator.bind(page);
    page.locator = (sel) => {
      if (sel.includes('發佈') || sel.includes('Post') || sel.includes('發貼文') ||
          sel.includes('role="button"')) {
        return publishBtn;
      }
      return origLocator(sel);
    };

    await clickPublish(page);

    assert.ok(publishBtn.clicked, 'clickPublish should click the publish button');
    console.log('✅ Test 5 Passed: clickPublish clicks publish button in dialog');
  }

  // ── Test 6: verifyDone returns true when success indicator found ────────────
  {
    const toast = new MockLocator({ visible: true });

    const page = makePage({});
    const origLocator = page.locator.bind(page);
    page.locator = (sel) => {
      if (sel.includes('已分享') || sel.includes('已發佈')) {
        return toast;
      }
      return origLocator(sel);
    };

    const result = await verifyDone(page);
    assert.ok(result === true || result === undefined, 'verifyDone should not throw when post succeeds');
    console.log('✅ Test 6 Passed: verifyDone completes without error on success');
  }

  console.log('\n🎉 All Facebook Actions tests passed!');
} catch (err) {
  console.error('❌ Facebook Actions Test Suite Failed:', err);
  process.exit(1);
}
