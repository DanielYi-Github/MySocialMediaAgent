/**
 * Prompt templates for the iterative ReAct Agent Loop.
 *
 * Unlike the single-shot heal prompts, these instruct the LLM to:
 * - Return structured JSON (not raw code)
 * - Perform ONE action per step
 * - Report "done" or "fail" when appropriate
 */

import { formatElementsForPrompt } from './dom-snapshot.js';

export const AGENT_SYSTEM_PROMPT = `你是一個瀏覽器自動化代理，使用 Playwright (JavaScript) 逐步完成使用者的目標。

每一輪你會收到：
- 最終目標描述
- 當前頁面的互動元素列表
- 當前頁面的截圖
- 你之前執行過的步驟記錄（含成功/失敗結果）

你必須回傳一個 JSON 物件（不要加 markdown 代碼區塊）：
{
  "thought": "我觀察到…所以我決定…",
  "action": "code",
  "code": "await page.locator('...').click();"
}

或者，當目標已完成時：
{
  "thought": "我看到成功訊息/頁面已跳轉，任務完成",
  "action": "done",
  "reason": "發佈成功"
}

或者，當明確無法完成時：
{
  "thought": "頁面顯示未登入，無法繼續",
  "action": "fail",
  "reason": "未登入"
}

嚴格規則：
1. 每次只執行「一個」動作（一次點擊、一次填寫、一次上傳等）。不要嘗試在一步內完成多個操作。
2. 使用 Playwright 的 page 物件，所有非同步呼叫必須加 await。
3. 對於檔案上傳，使用 page.locator('input[type="file"]').setInputFiles([...])。
4. 在 code 中不要使用 waitForTimeout 超過 3000ms。
5. 如果之前的步驟失敗了，根據當前畫面狀態嘗試替代方案。
6. 回傳的 JSON 不要包含任何 markdown 格式或代碼區塊標記。
7. 如果你看到成功提示、URL 跳轉到成功頁面、或發文完成的跡象，立即回傳 action: "done"。
8. 優先使用 aria-label、role、可見文字等語義化選擇器，避免脆弱的 CSS class。`;

/**
 * Build the user prompt for a single agent step.
 *
 * @param {object} opts
 * @param {string} opts.goal              - The overall goal
 * @param {Array}  opts.domSnapshot       - Current page interactive elements
 * @param {string} [opts.screenshotBase64] - Current page screenshot
 * @param {Array}  opts.history           - Previous steps [{step, code, result, error?}]
 * @param {number} opts.currentStep       - Current step number
 * @param {number} opts.maxSteps          - Max steps allowed
 * @returns {string}
 */
export function buildAgentStepPrompt({ goal, domSnapshot, screenshotBase64, history, currentStep, maxSteps }) {
  const elementsText = formatElementsForPrompt(domSnapshot);

  const lines = [
    `## 最終目標`,
    goal,
    ``,
    `## 當前狀態（步驟 ${currentStep}/${maxSteps}）`,
    ``,
    `### 頁面互動元素`,
    elementsText,
  ];

  if (screenshotBase64) {
    lines.push('');
    lines.push('（當前頁面截圖已附上）');
  }

  if (history.length > 0) {
    lines.push('');
    lines.push(`### 已執行步驟記錄`);
    // Only keep last 5 steps to save tokens
    const recentHistory = history.slice(-5);
    for (const h of recentHistory) {
      const status = h.result === 'success' ? '✅' : '❌';
      lines.push(`- Step ${h.step} ${status}: \`${h.code.slice(0, 120)}\`${h.error ? ` → 錯誤: ${h.error}` : ''}`);
    }
  }

  lines.push('');
  lines.push(`## 請決定下一步`);
  lines.push(`回傳 JSON 物件，包含 thought、action、code（或 reason）。`);

  return lines.join('\n');
}
