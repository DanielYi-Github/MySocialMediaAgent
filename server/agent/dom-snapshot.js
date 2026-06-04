/**
 * DOM Snapshot utilities for Self-Healing Agent.
 *
 * Extracts a compact, token-efficient snapshot of interactive elements
 * from a Playwright page for LLM analysis.
 */

const MAX_ELEMENTS = 100;
const MAX_OUTER_HTML = 200;

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
