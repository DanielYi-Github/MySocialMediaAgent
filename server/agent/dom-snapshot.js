/**
 * DOM Snapshot utilities for Self-Healing Agent.
 *
 * Extracts a compact, token-efficient snapshot of interactive elements
 * from a Playwright page for LLM analysis.
 */

const MAX_ELEMENTS = 100;
const MAX_OUTER_HTML = 200;
const MAX_DIALOG_HTML = 4000;

/**
 * Extract interactive elements from the current page state.
 * Runs inside page.evaluate() context (browser side).
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{tagName,text,ariaLabel,role,outerHTML}>>}
 */
export async function extractInteractiveElements(page) {
  return page.evaluate(({ _max, _maxHtml }) => {
    const selector = [
      'button',
      'input',
      'select',
      'textarea',
      'a[href]',
      '[role="button"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[contenteditable="true"]',
      '[tabindex]',
    ].join(',');

    const all = Array.from(document.querySelectorAll(selector));

    return all
      .filter(el => {
        // Skip hidden elements
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
      })
      .slice(0, _max)
      .map(el => ({
        tagName: el.tagName,
        text: (el.innerText || el.value || '').trim().slice(0, 80),
        ariaLabel: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
        outerHTML: el.outerHTML.slice(0, _maxHtml),
      }));
  }, { _max: MAX_ELEMENTS, _maxHtml: MAX_OUTER_HTML });
}

/**
 * Extract the innerHTML of the currently visible dialog/modal.
 * Strips style attributes to reduce noise, then truncates.
 *
 * @param {import('playwright').Page} page
 * @param {number} [maxChars]
 * @returns {Promise<string|null>}
 */
export async function extractFocusedDialogHtml(page, maxChars = MAX_DIALOG_HTML) {
  try {
    return await page.evaluate(({ _max }) => {
      const candidates = [
        '[role="dialog"][aria-modal="true"]',
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[role="alertdialog"]',
      ];

      let dialog = null;
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          dialog = el;
          break;
        }
      }
      if (!dialog) return null;

      // Clone so we can strip noise without mutating the live DOM
      const clone = dialog.cloneNode(true);

      // Remove script/style tags and strip style/class attributes
      clone.querySelectorAll('script, style').forEach(el => el.remove());
      clone.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));
      clone.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));

      // Keep only a meaningful subset of attributes
      const KEEP_ATTRS = new Set([
        'role', 'aria-label', 'aria-placeholder', 'aria-labelledby',
        'aria-modal', 'aria-expanded', 'aria-haspopup', 'aria-autocomplete',
        'contenteditable', 'type', 'name', 'placeholder', 'value',
        'data-lexical-editor', 'tabindex', 'href', 'disabled',
      ]);
      clone.querySelectorAll('*').forEach(el => {
        for (const attr of [...el.attributes]) {
          if (!KEEP_ATTRS.has(attr.name) && !attr.name.startsWith('data-')) {
            el.removeAttribute(attr.name);
          }
        }
      });

      const html = clone.outerHTML;
      return html.length > _max ? html.slice(0, _max) + '\n<!-- truncated -->' : html;
    }, { _max: maxChars });
  } catch {
    return null;
  }
}

/**
 * Format elements into a compact text block for LLM consumption.
 *
 * @param {Array} elements
 * @returns {string}
 */
export function formatElementsForPrompt(elements) {
  if (!elements || elements.length === 0) return '(no interactive elements found)';

  return elements.map((el, i) => {
    const parts = [`[${i}] <${el.tagName.toLowerCase()}`];
    if (el.ariaLabel) parts.push(` aria-label="${el.ariaLabel}"`);
    if (el.role) parts.push(` role="${el.role}"`);
    parts.push('>');
    if (el.text) parts.push(` "${el.text}"`);
    return parts.join('');
  }).join('\n');
}
