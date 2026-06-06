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

import { extractInteractiveElements, extractFocusedDialogHtml } from './dom-snapshot.js';
import { buildAgentStepPrompt } from './agent-prompts.js';
import { callAgentLLM, stripCodeFences } from './llm-client.js';

const MACRO_MODE_CODE_WARNING =
  '⚠️ Macro 模式下不允許 "code" 動作。LLM 應回傳巨集名稱（如 FILL_CAPTION），而非原始程式碼。請重試。';

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
 * @param {number} [opts.maxRounds=1]
 * @param {number} [opts.stepTimeout=15000]
 * @param {object} [opts.actionExecutor] - Map of macro action names to functions
 * @returns {Promise<{success: boolean, steps: number}>}
 */
export async function runAgentLoop(page, goal, llmConfig, opts = {}) {
  if (!llmConfig) {
    throw new Error('[Agent] llmConfig is required.');
  }

  const maxSteps = opts.maxSteps || DEFAULT_MAX_STEPS;
  const maxRounds = opts.maxRounds || 1;
  const totalStepLimit = maxSteps * maxRounds;
  const stepTimeout = opts.stepTimeout || DEFAULT_STEP_TIMEOUT;
  const llmClient = opts.llmClient || callAgentLLM;
  const actionExecutor = opts.actionExecutor || {};
  const isMacroMode = Object.keys(actionExecutor).length > 0;
  const promptBuilder = opts.promptBuilder || buildAgentStepPrompt;
  const systemPrompt = opts.systemPrompt || null;
  const uploadFiles = opts.uploadFiles || [];
  const history = [];
  let totalStep = 0;
  let consecutiveLLMFailures = 0;
  let firstLLMError = null;
  const MAX_CONSECUTIVE_LLM_FAILURES = 3;

  // Register a filechooser auto-fill listener ONLY in raw-code mode.
  // In macro mode, ATTACH_FILES macro owns filechooser handling via waitForEvent — registering
  // page.on here as well causes setFiles() to fire twice on the same chooser, doubling uploads.
  if (!isMacroMode && uploadFiles.length > 0 && typeof page.on === 'function') {
    page.on('filechooser', async fileChooser => {
      try {
        await fileChooser.setFiles(uploadFiles);
        console.log(`${C.GREEN}   📎 File chooser auto-filled with ${uploadFiles.length} file(s)${C.RESET}`);
      } catch (err) {
        console.warn(`${C.YELLOW}   ⚠️ File chooser auto-fill failed: ${err.message}${C.RESET}`);
      }
    });
  }

  console.log(`\n${C.CYAN}${'═'.repeat(60)}${C.RESET}`);
  console.log(`${C.CYAN}🤖 [WEBWRIGHT Agent] 迭代型代理引擎已啟動${C.RESET}`);
  console.log(`${C.CYAN}🎯 目標: ${goal.split('\n')[0]}${C.RESET}`);
  console.log(`${C.CYAN}📊 最大步數: ${totalStepLimit} (${maxRounds} 輪 × ${maxSteps} 步) | 每步超時: ${stepTimeout/1000}s${C.RESET}`);
  console.log(`${C.CYAN}${'═'.repeat(60)}${C.RESET}\n`);

  for (let round = 1; round <= maxRounds; round++) {
    for (let roundStep = 1; roundStep <= maxSteps; roundStep++) {
      totalStep++;
      const step = totalStep;
      console.log(`${C.CYAN}── Step ${step}/${totalStepLimit} (Round ${round}/${maxRounds}) ──${C.RESET}`);

      // 1. OBSERVE: Capture current page state
      let domSnapshot = [];
      let dialogHtml = null;
      try {
        [domSnapshot, dialogHtml] = await Promise.all([
          extractInteractiveElements(page),
          extractFocusedDialogHtml(page),
        ]);
        console.log(`${C.DIM}   📋 DOM: ${domSnapshot.length} interactive elements${dialogHtml ? ` | 🗂️ Dialog HTML: ${dialogHtml.length} chars` : ''}${C.RESET}`);
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
      const userPrompt = promptBuilder({
        goal,
        domSnapshot,
        dialogHtml,
        screenshotBase64,
        history,
        currentStep: step,
        maxSteps: totalStepLimit,
      });

      let decision;
      try {
        decision = await llmClient({ llmConfig, userPrompt, screenshotBase64, ...(systemPrompt ? { systemPrompt } : {}) });
        consecutiveLLMFailures = 0;
        firstLLMError = null;
      } catch (llmErr) {
        consecutiveLLMFailures++;
        if (!firstLLMError) firstLLMError = llmErr;
        console.error(`${C.RED}   ❌ LLM 呼叫失敗: ${llmErr.message}${C.RESET}`);
        history.push({ step, code: '(LLM call failed)', result: 'error', error: llmErr.message });
        if (consecutiveLLMFailures >= MAX_CONSECUTIVE_LLM_FAILURES) {
          const modelHint = llmConfig?.model ? `模型: ${llmConfig.model}` : '';
          throw new Error(
            `[Agent] LLM 連續失敗 ${consecutiveLLMFailures} 次，已終止。` +
            `請檢查 LLM 設定${modelHint ? `（${modelHint}）` : ''}。` +
            `錯誤: ${firstLLMError.message}`
          );
        }
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
        if (isRecoverableAgentFailure(decision)) {
          console.warn(`${C.YELLOW}   ⚠️ 代理回覆暫時不可用，將重新觀察頁面後再試: ${decision.reason}${C.RESET}`);
          history.push({
            step,
            code: '(agent response failed)',
            result: 'error',
            error: decision.reason || decision.thought || 'Recoverable agent response failure',
          });
          continue;
        }

        console.log(`\n${C.RED}${'═'.repeat(60)}${C.RESET}`);
        console.log(`${C.RED}🤖 [WEBWRIGHT Agent] ❌ 代理判斷無法完成任務${C.RESET}`);
        console.log(`${C.RED}   原因: ${decision.reason || '未知'}${C.RESET}`);
        console.log(`${C.RED}${'═'.repeat(60)}${C.RESET}\n`);
        throw new Error(`[Agent] 代理判斷無法完成: ${decision.reason}`);
      }

      // Macro mode: reject raw code — LLM must use a named macro
      if (isMacroMode && decision.action === 'code') {
        console.warn(`${C.YELLOW}   ${MACRO_MODE_CODE_WARNING}${C.RESET}`);
        history.push({ step, code: '(raw code rejected in macro mode)', result: 'error', error: MACRO_MODE_CODE_WARNING });
        continue;
      }

      // action === 'code' or macro action
      if (decision.action === 'code') {
        const code = stripCodeFences(decision.code || '');
        if (!code) {
          console.warn(`${C.YELLOW}   ⚠️ LLM 回傳空程式碼，跳過此步${C.RESET}`);
          history.push({ step, code: '(empty)', result: 'error', error: 'Empty code from LLM' });
          continue;
        }

        console.log(`${C.DIM}   ⚡ 執行: ${code.slice(0, 120)}${code.length > 120 ? '...' : ''}${C.RESET}`);

        try {
          await executeStepWithTimeout(page, code, stepTimeout);
          console.log(`${C.GREEN}   ✅ 執行成功${C.RESET}`);
          history.push({ step, code, result: 'success' });

          // Wait for page to settle after action
          await page.waitForTimeout(SETTLE_DELAY);
        } catch (execErr) {
          console.warn(`${C.RED}   ❌ 執行失敗: ${execErr.message}${C.RESET}`);
          history.push({ step, code, result: 'error', error: execErr.message });
          // Don't throw — let the loop continue so LLM can see the error and try a different approach
        }
      } else if (actionExecutor[decision.action]) {
        const actionName = decision.action;
        console.log(`${C.DIM}   🔧 執行巨集: ${actionName}${C.RESET}`);

        try {
          await actionExecutor[actionName]();
          console.log(`${C.GREEN}   ✅ 巨集執行成功${C.RESET}`);
          history.push({ step, code: `[${actionName}]`, result: 'success' });

          // Wait for page to settle after action
          await page.waitForTimeout(SETTLE_DELAY);
        } catch (macroErr) {
          console.warn(`${C.RED}   ❌ 巨集執行失敗: ${macroErr.message}${C.RESET}`);
          history.push({ step, code: `[${actionName}]`, result: 'error', error: macroErr.message });
          // Don't throw — let the loop continue
        }
      } else {
        console.warn(`${C.YELLOW}   ⚠️ 未知動作: ${decision.action}${C.RESET}`);
        history.push({ step, code: `(unknown: ${decision.action})`, result: 'error', error: `Unknown action: ${decision.action}` });
      }
    }

    if (round < maxRounds) {
      const summary = buildContinuationSummary(history, maxSteps);
      console.warn(`${C.YELLOW}   ↪️ 第 ${round} 輪已用完，帶著摘要進入下一輪${C.RESET}`);
      history.push({
        step: totalStep,
        code: '(continuation summary)',
        result: 'error',
        error: summary,
      });
    }
  }

  // All steps exhausted
  throw new Error(`[Agent] 已達最大步數 (${totalStepLimit})，流程未完成。最後 ${history.length} 步記錄已保留。`);
}

/**
 * Execute a single step of LLM-generated code with timeout.
 *
 * @param {import('playwright').Page} page
 * @param {string} code
 * @param {number} timeoutMs
 */
export async function executeStepWithTimeout(page, code, timeoutMs) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('page', code);
  const codePromise = fn(page);
  // Suppress unhandled rejection: when timeout fires first and codePromise later
  // rejects (e.g. Playwright's internal 30s timeout), Node.js 15+ crashes without this.
  codePromise.catch(() => {});

  try {
    await Promise.race([codePromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRecoverableAgentFailure(decision) {
  const reason = String(decision.reason || decision.thought || '');
  return (
    reason.includes('Empty LLM response') ||
    reason.includes('Unparseable response') ||
    reason.includes('Invalid action') ||
    reason.includes('no code field')
  );
}

function buildContinuationSummary(history, maxSteps) {
  const recentErrors = history
    .slice(-maxSteps)
    .filter(item => item.result === 'error' && item.error)
    .map(item => item.error)
    .slice(-3);

  const errorSummary = recentErrors.length > 0 ? recentErrors.join('；') : '沒有明確錯誤';
  return `上一輪已用完 ${maxSteps} 步但尚未完成。請保留目前頁面已完成的狀態，根據當前畫面繼續下一步，不要重複造成這些錯誤的策略：${errorSummary}`;
}
