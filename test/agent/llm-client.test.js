import assert from 'node:assert';
import { parseAgentResponse } from '../../server/agent/llm-client.js';

console.log('🧪 Running TDD tests for Agent LLM client...');

try {
  {
    const raw = `{
      "thought": "建立貼文對話框已經開啟",
      "action": "code",
      "code": "await page.locator('input[type=\\"file\\"]').nth(1).setInputFiles(['/tmp/a.jpg']);"
    }`;

    const parsed = parseAgentResponse(raw);
    assert.strictEqual(parsed.action, 'code');
    assert.ok(parsed.code.includes('setInputFiles'));
    console.log('✅ Test 1 Passed: parses normal JSON response with Playwright code');
  }

  {
    const raw = `on
{
  "thought": "建立貼文對話框已經開啟",
  "action": "code",
  "code": "await page.locator('div[aria-label=\\"相片／影片\\"]').nth(1).click();"
}`;

    const parsed = parseAgentResponse(raw);
    assert.strictEqual(parsed.action, 'code');
    assert.strictEqual(parsed.thought, '建立貼文對話框已經開啟');
    assert.ok(parsed.code.includes('.nth(1).click()'));
    console.log('✅ Test 2 Passed: extracts JSON object from noisy response prefix');
  }

  {
    const raw = `\`\`\`on
{
  "thought": "我看到建立貼文對話框",
  "action": "code",
  "code": "await page.locator('input[type=\\"file\\"]').nth(1).setInputFiles(['/tmp/a.jpg']);"
}
\`\`\``;

    const parsed = parseAgentResponse(raw);
    assert.strictEqual(parsed.action, 'code');
    assert.ok(parsed.code.includes('setInputFiles'));
    console.log('✅ Test 3 Passed: extracts JSON from malformed markdown fence labels');
  }

  {
    const raw = `{
      "thought": "我需要執行下一步",
      "action": "code"
    }`;

    const parsed = parseAgentResponse(raw);
    assert.strictEqual(parsed.action, 'fail');
    assert.match(parsed.reason, /no code field/);
    console.log('✅ Test 4 Passed: action=code without code stays a recoverable parser failure');
  }

  console.log('\n🎉 All Agent LLM client tests passed!');
} catch (err) {
  console.error('❌ Agent LLM Client Test Suite Failed:', err);
  process.exit(1);
}
