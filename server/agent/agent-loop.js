/**
 * Iterative ReAct Agent Loop for Webwright.
 *
 * Unlike healAndExecute (single-shot repair), this engine:
 * 1. Observes the current page (DOM + screenshot) at EVERY step
 * 2. Asks the LLM to decide ONE action
 * 3. Executes that single action
 * 4. Loops until the LLM reports "done" or max steps reached
 *
 * This is the core engine for "Force Webwright" mode.
 */

import { extractInteractiveElements } from './dom-snapshot.js';
import { buildAgentStepPrompt } from './agent-prompts.js';
import { callAgentLLM, stripCodeFences } from './llm-client.js';

const DEFAULT_MAX_STEPS = 15;
const DEFAULT_STEP_TIMEOUT = 15000; // 15s per step
const SETTLE_DELAY = 2000; // wait for page to settle after each action

// ANSI colors for terminal output
const C = {
  CYAN:    '\x1b[1m\x1b[36m',
  YELLOW:  '\x1b[1m\x1b[33m',
  GREEN:   '\x1b[1m\x1b[32m',
  RED:     '\x1b[1m\x1b[31m',
  DIM:     '\x1b[2m',
  RESET:   '\x1b[0m',
};

/**
 * Run the iterative agent loop.
 *
 * @param {import('playwright').Page} page
 * @param {string} goal           - Human-readable goal (e.g., "完成小紅書發文流程")
 * @param {object} llmConfig      - { protocol, baseUrl, apiKey, model }
 * @param {object} [opts]
 * @param {number} [opts.maxSteps=15]
 * @param {number} [opts.stepTimeout=15000]
 * @returns {Promise<{success: boolean, steps: number}>}
 */
export async function runAgentLoop(page, goal, llmConfig, opts = {}) {
  if (!llmConfig) {
    throw new Error('[Agent] llmConfig is required.');
  }

  const maxSteps = opts.maxSteps || DEFAULT_MAX_STEPS;
  const stepTimeout = opts.stepTimeout || DEFAULT_STEP_TIMEOUT;
  const history = [];

  console.log(`\n${C.CYAN}${'═'.repeat(60)}${C.RESET}`);
  console.log(`${C.CYAN}🤖 [WEBWRIGHT Agent] 迭代型代理引擎已啟動${C.RESET}`);
  console.log(`${C.CYAN}🎯 目標: ${goal.split('\n')[0]}${C.RESET}`);
  console.log(`${C.CYAN}📊 最大步數: ${maxSteps} | 每步超時: ${stepTimeout/1000}s${C.RESET}`);
  console.log(`${C.CYAN}${'═'.repeat(60)}${C.RESET}\n`);

  for (let step = 1; step <= maxSteps; step++) {
    console.log(`${C.CYAN}── Step ${step}/${maxSteps} ──${C.RESET}`);

    // 1. OBSERVE: Capture current page state
    let domSnapshot = [];
    try {
      domSnapshot = await extractInteractiveElements(page);
      console.log(`${C.DIM}   📋 DOM: ${domSnapshot.length} interactive elements${C.RESET}`);
    } catch (err) {
      console.warn(`${C.YELLOW}   ⚠️ DOM snapshot failed: ${err.message}${C.RESET}`);
    }

    let screenshotBase64 = null;
    try {
      screenshotBase64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });
      console.log(`${C.DIM}   📸 Screenshot captured${C.RESET}`);
    } catch (err) {
      console.warn(`${C.YELLOW}   ⚠️ Screenshot failed: ${err.message}${C.RESET}`);
    }

    // 2. THINK: Ask LLM to decide next action
    const userPrompt = buildAgentStepPrompt({
      goal,
      domSnapshot,
      screenshotBase64,
      history,
      currentStep: step,
      maxSteps,
    });

    let decision;
    try {
      decision = await callAgentLLM({ llmConfig, userPrompt, screenshotBase64 });
    } catch (llmErr) {
      console.error(`${C.RED}   ❌ LLM 呼叫失敗: ${llmErr.message}${C.RESET}`);
      history.push({ step, code: '(LLM call failed)', result: 'error', error: llmErr.message });
      continue;
    }

    // Log the LLM's thought process
    if (decision.thought) {
      console.log(`${C.YELLOW}   🧠 思考: ${decision.thought}${C.RESET}`);
    }

    // 3. ACT: Execute based on the decision
    if (decision.action === 'done') {
      console.log(`\n${C.GREEN}${'═'.repeat(60)}${C.RESET}`);
      console.log(`${C.GREEN}🤖 [WEBWRIGHT Agent] ✅ 任務完成！(共 ${step} 步)${C.RESET}`);
      console.log(`${C.GREEN}   原因: ${decision.reason || '目標已達成'}${C.RESET}`);
      console.log(`${C.GREEN}${'═'.repeat(60)}${C.RESET}\n`);
      return { success: true, steps: step };
    }

    if (decision.action === 'fail') {
      console.log(`\n${C.RED}${'═'.repeat(60)}${C.RESET}`);
      console.log(`${C.RED}🤖 [WEBWRIGHT Agent] ❌ 代理判斷無法完成任務${C.RESET}`);
      console.log(`${C.RED}   原因: ${decision.reason || '未知'}${C.RESET}`);
      console.log(`${C.RED}${'═'.repeat(60)}${C.RESET}\n`);
      throw new Error(`[Agent] 代理判斷無法完成: ${decision.reason}`);
    }

    // action === 'code'
    const code = stripCodeFences(decision.code || '');
    if (!code) {
      console.warn(`${C.YELLOW}   ⚠️ LLM 回傳空程式碼，跳過此步${C.RESET}`);
      history.push({ step, code: '(empty)', result: 'error', error: 'Empty code from LLM' });
      continue;
    }

    console.log(`${C.DIM}   ⚡ 執行: ${code.slice(0, 120)}${code.length > 120 ? '...' : ''}${C.RESET}`);

    try {
      await _executeStepWithTimeout(page, code, stepTimeout);
      console.log(`${C.GREEN}   ✅ 執行成功${C.RESET}`);
      history.push({ step, code, result: 'success' });

      // Wait for page to settle after action
      await page.waitForTimeout(SETTLE_DELAY);
    } catch (execErr) {
      console.warn(`${C.RED}   ❌ 執行失敗: ${execErr.message}${C.RESET}`);
      history.push({ step, code, result: 'error', error: execErr.message });
      // Don't throw — let the loop continue so LLM can see the error and try a different approach
    }
  }

  // All steps exhausted
  throw new Error(`[Agent] 已達最大步數 (${maxSteps})，流程未完成。最後 ${history.length} 步記錄已保留。`);
}

/**
 * Execute a single step of LLM-generated code with timeout.
 *
 * @param {import('playwright').Page} page
 * @param {string} code
 * @param {number} timeoutMs
 */
async function _executeStepWithTimeout(page, code, timeoutMs) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs)
  );

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('page', code);

  await Promise.race([fn(page), timeoutPromise]);
}
