/**
 * LLM Prompt templates for Self-Healing Agent.
 */

import { formatElementsForPrompt } from './dom-snapshot.js';

export const HEAL_SYSTEM_PROMPT = `You are an expert Playwright (JavaScript) automation engineer.
Your job: given a failing browser automation task, analyze the current page state (DOM elements + optional screenshot) and generate a single JavaScript code snippet that uses the Playwright \`page\` object to accomplish the goal.

Rules:
1. Return ONLY executable JavaScript code. No markdown fences, no explanation.
2. The code must use only the \`page\` variable (already bound to the current Playwright Page).
3. Use Playwright's built-in locators: \`page.locator()\`, \`page.getByRole()\`, \`page.getByText()\`, etc.
4. Include \`await\` for all async calls.
5. Add a short \`waitFor\` or \`waitForTimeout\` if needed for dynamic content.
6. If the element has a clear aria-label or role, prefer role-based locators over CSS selectors.
7. The code must complete the FULL goal action (e.g., click, fill, etc.), not just locate the element.

Example output:
await page.getByRole('button', { name: '发布' }).click();`;

/**
 * Build the user prompt for a heal request.
 *
 * @param {object} opts
 * @param {string} opts.goal         - What action to accomplish
 * @param {string} opts.error        - The error from the failed static attempt
 * @param {Array}  opts.domSnapshot  - Array of interactive elements from extractInteractiveElements()
 * @param {string} [opts.screenshotBase64] - Optional base64 screenshot (JPEG or PNG)
 * @returns {string} user prompt
 */
export function buildHealPrompt({ goal, error, domSnapshot, screenshotBase64 }) {
  const elementsText = formatElementsForPrompt(domSnapshot);

  const lines = [
    `## Goal`,
    goal,
    ``,
    `## Previous Error`,
    error,
    ``,
    `## Current Page Interactive Elements`,
    elementsText,
  ];

  if (screenshotBase64) {
    lines.push('');
    lines.push('(A screenshot of the current page is attached as an image.)');
  }

  lines.push('');
  lines.push('## Task');
  lines.push('Write Playwright JavaScript code to accomplish the goal. Return ONLY the code.');

  return lines.join('\n');
}

/**
 * Build a refinement prompt when previous generated code failed.
 *
 * @param {string} previousCode   - The code that was tried
 * @param {string} executionError - The error from executing it
 * @param {string} goal           - The original goal
 * @returns {string}
 */
export function buildRefinePrompt({ previousCode, executionError, goal }) {
  return [
    `## Goal`,
    goal,
    ``,
    `## Previous Code Attempt`,
    previousCode,
    ``,
    `## Execution Error`,
    executionError,
    ``,
    `## Task`,
    `The previous code failed. Fix it and return ONLY the corrected JavaScript code.`,
  ].join('\n');
}
