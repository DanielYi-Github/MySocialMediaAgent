import assert from 'node:assert';
import { buildHealPrompt, HEAL_SYSTEM_PROMPT } from '../../server/agent/prompts.js';

console.log('🧪 Running TDD tests for Self-Healing Prompts...');

try {
  // Test 1: HEAL_SYSTEM_PROMPT 必須包含關鍵指示
  assert.ok(HEAL_SYSTEM_PROMPT.includes('Playwright'), 'system prompt must mention Playwright');
  assert.ok(HEAL_SYSTEM_PROMPT.includes('JavaScript') || HEAL_SYSTEM_PROMPT.includes('JS'), 'system prompt must mention code type');
  console.log('✅ Test 1 Passed: HEAL_SYSTEM_PROMPT has required keywords');

  // Test 2: buildHealPrompt 基本輸出
  const domSnapshot = [
    { tagName: 'BUTTON', text: '发布', ariaLabel: null, role: null, outerHTML: '<button>发布</button>' },
    { tagName: 'INPUT', text: '', ariaLabel: '标题', role: null, outerHTML: '<input>' },
  ];
  const prompt = buildHealPrompt({
    goal: '點擊小紅書的發布按鈕',
    error: '找不到 .publish-btn',
    domSnapshot,
  });

  assert.ok(typeof prompt === 'string', 'buildHealPrompt must return a string');
  assert.ok(prompt.length > 50, 'prompt must have meaningful content');
  assert.ok(prompt.includes('點擊小紅書的發布按鈕'), 'prompt must include the goal');
  assert.ok(prompt.includes('找不到 .publish-btn'), 'prompt must include the error');
  assert.ok(prompt.includes('发布'), 'prompt must include DOM snapshot text');
  console.log('✅ Test 2 Passed: buildHealPrompt returns correct structure');

  // Test 3: 有截圖時也應包含截圖
  const promptWithScreenshot = buildHealPrompt({
    goal: '點擊按鈕',
    error: 'timeout',
    domSnapshot,
    screenshotBase64: 'iVBORw0KGgo=',  // fake base64
  });
  assert.ok(typeof promptWithScreenshot === 'string', 'prompt with screenshot is a string');
  console.log('✅ Test 3 Passed: buildHealPrompt handles screenshotBase64');

  // Test 4: 沒有 domSnapshot 時不崩潰
  const promptNoDom = buildHealPrompt({
    goal: '填寫標題',
    error: 'element not found',
    domSnapshot: [],
  });
  assert.ok(typeof promptNoDom === 'string', 'empty DOM snapshot should not crash');
  console.log('✅ Test 4 Passed: Empty DOM snapshot handled gracefully');

  console.log('\n🎉 All Prompt tests passed!');
} catch (err) {
  console.error('❌ Prompt Test Suite Failed:', err);
  process.exit(1);
}
