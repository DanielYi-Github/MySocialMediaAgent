/**
 * Self-Healing Agent core engine (Webwright pattern).
 *
 * When a static Playwright selector fails, this engine:
 * 1. Extracts a compact DOM snapshot from the current page
 * 2. (Optionally) takes a screenshot
 * 3. Asks the LLM to generate Playwright code for the goal
 * 4. Executes the generated code dynamically
 * 5. Retries up to MAX_RETRIES times on failure
 *
 * The generated code runs with access to the `page` object only.
 */

import { extractInteractiveElements } from './dom-snapshot.js';
import { buildHealPrompt, buildRefinePrompt } from './prompts.js';
import { callHealLLM, stripCodeFences } from './llm-client.js';

const MAX_RETRIES = 3;
const EXEC_TIMEOUT_MS = 10000;

/**
 * Main entry point: attempt to heal a failed Playwright action using an LLM.
 *
 * @param {import('playwright').Page} page
 * @param {string} goal         - Human-readable description of what to accomplish
 * @param {Error}  staticError  - The error from the failed static selector attempt
 * @param {object} llmConfig    - { protocol, baseUrl, apiKey, model }
 * @param {object} [opts]
 * @param {boolean} [opts.includeScreenshot=true] - Whether to send a screenshot to the LLM
 * @returns {Promise<boolean>}  - true if healing succeeded
 * @throws {Error} if all retries exhausted
 */
export async function healAndExecute(page, goal, staticError, llmConfig, opts = {}) {
  if (!llmConfig) {
    throw new Error('[Self-Healing] llmConfig is required for AI-assisted healing.');
  }

  const { includeScreenshot = true } = opts;

  console.log(`[Self-Healing] Static selector failed: ${staticError.message}`);
  console.log(`[Self-Healing] Goal: ${goal}`);
  console.log(`[Self-Healing] Starting AI-assisted recovery (max ${MAX_RETRIES} retries)...`);

  // Step 1: Extract DOM snapshot
  let domSnapshot = [];
  try {
    domSnapshot = await extractInteractiveElements(page);
    console.log(`[Self-Healing] DOM snapshot: ${domSnapshot.length} interactive elements`);
  } catch (snapErr) {
    console.warn('[Self-Healing] DOM snapshot failed:', snapErr.message);
  }

  // Step 2: Optional screenshot
  let screenshotBase64 = null;
  if (includeScreenshot) {
    try {
      screenshotBase64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });
      console.log('[Self-Healing] Screenshot captured.');
    } catch (ssErr) {
      console.warn('[Self-Healing] Screenshot failed:', ssErr.message);
    }
  }

  // Step 3: Iterative LLM → Execute loop
  let lastError = staticError;
  let lastCode = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[Self-Healing] Attempt ${attempt}/${MAX_RETRIES}`);

    // Build prompt
    const userPrompt = attempt === 1
      ? buildHealPrompt({ goal, error: lastError.message, domSnapshot, screenshotBase64 })
      : buildRefinePrompt({ previousCode: lastCode, executionError: lastError.message, goal });

    // Call LLM
    let rawCode;
    try {
      rawCode = await callHealLLM({
        llmConfig,
        userPrompt,
        screenshotBase64: attempt === 1 ? screenshotBase64 : null, // Only send screenshot on first attempt
      });
    } catch (llmErr) {
      console.warn(`[Self-Healing] LLM call failed on attempt ${attempt}:`, llmErr.message);
      lastError = new Error(`LLM call failed: ${llmErr.message}`);
      continue;
    }

    lastCode = stripCodeFences(rawCode);
    console.log(`[Self-Healing] Generated code (${lastCode.length} chars)`);

    // Execute the generated code with timeout
    try {
      await _executeWithTimeout(page, lastCode, EXEC_TIMEOUT_MS);
      console.log(`[Self-Healing] ✅ Execution succeeded on attempt ${attempt}!`);
      return true;
    } catch (execErr) {
      console.warn(`[Self-Healing] Execution failed on attempt ${attempt}:`, execErr.message);
      lastError = execErr;
    }
  }

  throw new Error(
    `[Self-Healing] All ${MAX_RETRIES} attempts exhausted. Last error: ${lastError.message}`
  );
}

/**
 * Execute LLM-generated Playwright code with a timeout.
 * The code has access to `page` only (no Node.js APIs).
 *
 * @param {import('playwright').Page} page
 * @param {string} code
 * @param {number} timeoutMs
 */
async function _executeWithTimeout(page, code, timeoutMs) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs)
  );

  // Deliberately limited scope: only `page` is accessible
  // Using AsyncFunction to avoid eval() with broader scope
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('page', code);

  await Promise.race([fn(page), timeoutPromise]);
}
