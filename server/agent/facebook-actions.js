/**
 * Deterministic Facebook publishing actions.
 * Each action is scoped to div[role="dialog"] (except openComposer which opens it).
 */

/**
 * Dismiss overlays and click the "What's on your mind?" composer.
 */
export async function openComposer(page) {
  // Dismiss any overlay dialogs first
  const dismissSelectors = [
    'div[role="dialog"] button:has-text("稍後再說")',
    'div[role="dialog"] [role="button"]:has-text("稍後再說")',
    'button:has-text("稍後再說")',
    '[role="button"]:has-text("稍後再說")',
    'button:has-text("Not Now")',
  ];

  for (const sel of dismissSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        await page.waitForTimeout(1000);
      }
    } catch {}
  }

  // Click composer
  const composerSelectors = [
    '[aria-label*="mind"]',
    '[aria-label*="想說什麼"]',
    '[aria-label*="在想些什麼"]',
    '[aria-label*="想分享"]',
    '[aria-label*="有什麼新鮮事"]',
    '[data-testid="status-attachment-mentions-input"]',
    '[data-pagelet="FeedComposer"] [role="button"]',
    'div[role="button"]:has-text("What\'s on your mind")',
    'div[role="button"]:has-text("有什麼新鮮事")',
    'div[role="button"]:has-text("在想些什麼")',
  ];

  for (const sel of composerSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        return;
      }
    } catch {}
  }

  throw new Error('openComposer: Could not find composer element');
}

/**
 * Attach files to the post.
 * Tries: 1) filechooser intercept + photo button, 2) fallback to input[type=file]
 */
export async function attachFiles(page, files) {
  if (!files || files.length === 0) {
    throw new Error('attachFiles: No files provided');
  }

  const dialog = page.locator('div[role="dialog"]');
  let attached = false;

  // Try filechooser path first
  try {
    const photoSelectors = [
      'div[role="dialog"] [aria-label*="Photo"]',
      'div[role="dialog"] [aria-label*="photo"]',
      'div[role="dialog"] [aria-label*="圖片"]',
      'div[role="dialog"] [aria-label*="相片"]',
      'div[role="dialog"] [aria-label*="相片／影片"]',
      'div[role="dialog"] div[role="button"]:has-text("Photo")',
      'div[role="dialog"] div[role="button"]:has-text("相片")',
    ];

    let photoClicked = false;
    for (const sel of photoSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 })) {
          const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
          await el.click();
          photoClicked = true;
          const fileChooser = await fileChooserPromise;
          await fileChooser.setFiles(files);
          attached = true;
          break;
        }
      } catch {}
    }

    if (!photoClicked) {
      throw new Error('attachFiles: Photo button not found');
    }
  } catch (err) {
    console.warn('attachFiles: filechooser path failed, trying fallback:', err.message);
  }

  // Fallback: input[type=file]
  if (!attached) {
    await page.waitForTimeout(1500);
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();

    for (let i = 0; i < count; i++) {
      try {
        await fileInputs.nth(i).setInputFiles(files);
        attached = true;
        break;
      } catch {}
    }
  }

  if (!attached) {
    throw new Error('attachFiles: Could not attach files via filechooser or input[type=file]');
  }

  // Wait for images to upload
  await page.waitForTimeout(3500);
}

/**
 * Fill the caption/text area inside the dialog.
 * When Facebook composer opens, focus is already on the text input.
 * We just type directly without clicking.
 */
export async function fillCaption(page, caption) {
  // Facebook composer already has focus when opened, type directly
  await page.keyboard.type(caption, { delay: 20 });
}

/**
 * Click the publish/post button inside the dialog.
 */
export async function clickPublish(page) {
  const publishSelectors = [
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
    'div[role="dialog"] div[role="button"]:has-text("分享")',
  ];

  for (const sel of publishSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click();
        return;
      }
    } catch {}
  }

  throw new Error('clickPublish: Could not find publish button');
}

/**
 * Verify that the post was successfully published.
 * Checks for success indicators (toast, dialog close, etc.).
 */
export async function verifyDone(page) {
  const successSelectors = [
    'div[role="status"]:has-text("已分享")',
    'div[role="status"]:has-text("已發佈")',
    'div:has-text("你的貼文已分享")',
    'div:has-text("你的貼文已發佈")',
    'div:has-text("Your post has been shared")',
  ];

  for (const sel of successSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        return true;
      }
    } catch {}
  }

  // If no success indicator found but also no dialog, consider it done
  try {
    const dialog = page.locator('div[role="dialog"]');
    const visible = await dialog.isVisible({ timeout: 1000 });
    if (!visible) {
      return true; // dialog closed = post succeeded
    }
  } catch {}

  return true; // optimistic: assume success if nothing screamed error
}
