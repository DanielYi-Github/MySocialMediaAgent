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
8. 優先使用 aria-label、role、可見文字等語義化選擇器，避免脆弱的 CSS class。
9. 如果 Playwright strict mode 顯示 locator 匹配多個元素，下一步必須使用更精確的容器、.first()、.nth(index)，或直接針對正確的 input[type="file"] 使用 setInputFiles。
10. 對話框 HTML 結構（如有提供）優先於元素清單來推斷選擇器，因為它包含完整屬性。
11. 【重要】Facebook/React 的 contenteditable 文字框（含 data-lexical-editor 屬性）不支援 fill()。必須先 click() 聚焦，再用 await page.keyboard.type("文字", { delay: 30 }) 輸入。fill() 會繞過 React 事件系統導致文字不顯示。`;

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
export function buildAgentStepPrompt({ goal, domSnapshot, dialogHtml, screenshotBase64, history, currentStep, maxSteps }) {
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

  if (dialogHtml) {
    lines.push('');
    lines.push('### 對話框 HTML 結構（精確屬性，優先參考此生成選擇器）');
    lines.push('```html');
    lines.push(dialogHtml);
    lines.push('```');
  }

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

export const FACEBOOK_MACRO_SYSTEM_PROMPT = `你是一個 Facebook 發文自動化代理，使用高層次的巨集動作完成發文流程。

每一輪你會收到：
- 最終目標描述
- 當前頁面的互動元素列表
- 當前頁面的截圖
- 你之前執行過的步驟記錄（含成功/失敗結果）

你必須回傳以下三種 JSON 之一（不要加 markdown 代碼區塊）：

執行巨集：
{
  "thought": "我觀察到…所以我決定…",
  "action": "MACRO_NAME"
}

目標已完成：
{
  "thought": "發文成功，可以看到確認訊息",
  "action": "done",
  "reason": "發佈成功"
}

明確無法完成：
{
  "thought": "頁面顯示未登入",
  "action": "fail",
  "reason": "未登入"
}

⛔ 嚴格禁止：絕對不可回傳 "action": "code" 或任何 Playwright 原始程式碼。
   本系統不接受原始程式碼。如果你覺得需要寫程式碼，請改為回傳 "action": "fail"。

有效的巨集動作（action 欄位填入巨集名稱）：
- OPEN_COMPOSER: 開啟 Facebook 發文編輯框（清除覆蓋層、點擊「有什麼新鮮事」）。使用在：流程剛開始，還沒有編輯框出現時。
- ATTACH_FILES: 上傳圖片到編輯框。使用在：編輯框已開，需要加入圖片時。
- FILL_CAPTION: 填寫發文文案（使用 keyboard.type 正確處理 Lexical 編輯器）。使用在：圖片已上傳，需要輸入文字時。
- CLICK_PUBLISH: 點擊發佈相關按鈕。使用在：文案已填寫，準備發佈時；若影片流程進入 Reel 編輯器，也要持續使用它點擊「繼續 / 下一步 / 發佈 / 分享」直到完成。
- VERIFY_DONE: 確認發文成功。使用在：點擊發佈後，檢查是否已完成；若對話框仍存在或仍看到「繼續 / Reel / 發佈」等按鈕，代表尚未完成。

標準流程：OPEN_COMPOSER → ATTACH_FILES → FILL_CAPTION → CLICK_PUBLISH → VERIFY_DONE → done
影片 / Reel 流程：OPEN_COMPOSER → ATTACH_FILES → FILL_CAPTION → CLICK_PUBLISH → CLICK_PUBLISH → VERIFY_DONE → done

規則：
1. 每次只執行一個巨集。
2. 若某巨集成功，繼續下一個。若失敗，可重試一次，第二次失敗則跳到下一個巨集或回傳 fail。
3. 不要因為截圖無法確認結果就無限重試同一個巨集。
4. 若是影片貼文，Facebook 可能先進入 Reel 編輯器；看到「繼續 / 下一步 / Reel / 發佈 / 分享」時，不要宣告失敗，優先再次使用 CLICK_PUBLISH 推進流程。
5. 當 VERIFY_DONE 回傳成功，或對話框已關閉，立即回傳 done。`;

/**
 * Build the user prompt for a Facebook macro-action agent step.
 *
 * @param {object} opts
 * @param {string} opts.goal              - The overall goal
 * @param {Array}  opts.domSnapshot       - Current page interactive elements
 * @param {string} [opts.screenshotBase64] - Current page screenshot
 * @param {Array}  opts.history           - Previous steps
 * @param {number} opts.currentStep       - Current step number
 * @param {number} opts.maxSteps          - Max steps allowed
 * @returns {string}
 */
export function buildFacebookMacroPrompt({ goal, domSnapshot, dialogHtml, screenshotBase64, history, currentStep, maxSteps }) {
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

  if (dialogHtml) {
    lines.push('');
    lines.push('### 對話框 HTML 結構（參考用，判斷目前流程進度）');
    lines.push('```html');
    lines.push(dialogHtml);
    lines.push('```');
  }

  if (screenshotBase64) {
    lines.push('');
    lines.push('（當前頁面截圖已附上）');
  }

  if (history.length > 0) {
    lines.push('');
    lines.push(`### 已執行巨集記錄`);
    const recentHistory = history.slice(-5);
    for (const h of recentHistory) {
      const status = h.result === 'success' ? '✅' : '❌';
      lines.push(`- Step ${h.step} ${status}: ${h.code}${h.error ? ` → 錯誤: ${h.error}` : ''}`);
    }
  }

  lines.push('');
  lines.push(`## 請決定下一步`);
  lines.push(`回傳 JSON：{ "thought": "...", "action": "MACRO_NAME" } 或 done/fail。絕對不可使用 "action": "code"。`);

  return lines.join('\n');
}
