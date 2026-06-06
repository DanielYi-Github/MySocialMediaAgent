import assert from 'node:assert';
import { runAgentLoop } from '../../server/agent/agent-loop.js';

console.log('🧪 Running TDD tests for Agent Loop...');

function makeMockPage() {
  return {
    evaluate: async () => [],
    screenshot: async () => '',
    waitForTimeout: async () => {},
  };
}

function makeMockFileChooserPage() {
  const page = makeMockPage();
  let fileChooserHandler = null;
  page.uploadedFiles = null;
  page.on = (eventName, handler) => {
    if (eventName === 'filechooser') fileChooserHandler = handler;
  };
  page.__triggerFileChooser = async () => {
    await fileChooserHandler({
      setFiles: async files => {
        page.uploadedFiles = files;
      },
    });
  };
  return page;
}

function makeMockConfig() {
  return {
    protocol: 'openai',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
  };
}

try {
  {
    const decisions = [
      { thought: 'LLM returned empty response', action: 'fail', reason: 'Empty LLM response' },
      { thought: 'Recovered on next observation', action: 'done', reason: 'Posted successfully' },
    ];

    const result = await runAgentLoop(makeMockPage(), '完成 Facebook 發文', makeMockConfig(), {
      maxSteps: 3,
      llmClient: async () => decisions.shift(),
    });

    assert.deepStrictEqual(result, { success: true, steps: 2 });
    console.log('✅ Test 1 Passed: recoverable empty LLM response does not stop the agent loop');
  }

  {
    await assert.rejects(
      () => runAgentLoop(makeMockPage(), '完成 Facebook 發文', makeMockConfig(), {
        maxSteps: 3,
        llmClient: async () => ({ thought: '頁面顯示未登入', action: 'fail', reason: '未登入' }),
      }),
      /未登入/
    );
    console.log('✅ Test 2 Passed: explicit terminal fail still stops the agent loop');
  }

  {
    const prompts = [];
    const decisions = [
      { thought: 'First attempt used the wrong button', action: 'code', code: 'throw new Error("wrong upload path");' },
      { thought: 'LLM returned empty response', action: 'fail', reason: 'Empty LLM response' },
      { thought: 'Continue from previous round', action: 'done', reason: 'Posted successfully after continuation' },
    ];

    const result = await runAgentLoop(makeMockPage(), '完成 Facebook 發文', makeMockConfig(), {
      maxSteps: 2,
      maxRounds: 2,
      llmClient: async ({ userPrompt }) => {
        prompts.push(userPrompt);
        return decisions.shift();
      },
    });

    assert.deepStrictEqual(result, { success: true, steps: 3 });
    assert.match(prompts[2], /上一輪已用完 2 步/);
    assert.match(prompts[2], /wrong upload path/);
    console.log('✅ Test 3 Passed: agent can continue with prior-round summary after max steps');
  }

  {
    const page = makeMockFileChooserPage();
    const uploadFiles = ['/tmp/prepared-image.jpg'];
    const decisions = [
      { thought: 'Trigger upload chooser', action: 'code', code: 'await page.__triggerFileChooser();' },
      { thought: 'Upload completed', action: 'done', reason: 'Posted successfully' },
    ];

    const result = await runAgentLoop(page, '完成 Facebook 發文', makeMockConfig(), {
      maxSteps: 2,
      uploadFiles,
      llmClient: async () => decisions.shift(),
    });

    assert.deepStrictEqual(result, { success: true, steps: 2 });
    assert.deepStrictEqual(page.uploadedFiles, uploadFiles);
    console.log('✅ Test 4 Passed: file chooser is auto-filled with prepared upload files');
  }

  // ── Test 5: macro action dispatches to actionExecutor ─────────────────────
  {
    const executed = [];
    const decisions = [
      { thought: 'Need to open composer', action: 'OPEN_COMPOSER' },
      { thought: 'Need to attach files', action: 'ATTACH_FILES' },
      { thought: 'Done posting', action: 'done', reason: '發佈成功' },
    ];

    const result = await runAgentLoop(makeMockPage(), 'FB 發文', makeMockConfig(), {
      maxSteps: 5,
      llmClient: async () => decisions.shift(),
      actionExecutor: {
        OPEN_COMPOSER: async () => { executed.push('OPEN_COMPOSER'); },
        ATTACH_FILES: async () => { executed.push('ATTACH_FILES'); },
      },
    });

    assert.deepStrictEqual(result, { success: true, steps: 3 });
    assert.deepStrictEqual(executed, ['OPEN_COMPOSER', 'ATTACH_FILES']);
    console.log('✅ Test 5 Passed: macro actions dispatch to actionExecutor');
  }

  // ── Test 6: failed macro action records error but loop continues ───────────
  {
    const decisions = [
      { thought: 'Try open composer', action: 'OPEN_COMPOSER' },
      { thought: 'Retry open composer', action: 'OPEN_COMPOSER' },
      { thought: 'Done', action: 'done', reason: '成功' },
    ];
    let callCount = 0;

    const result = await runAgentLoop(makeMockPage(), 'FB 發文', makeMockConfig(), {
      maxSteps: 5,
      llmClient: async () => decisions.shift(),
      actionExecutor: {
        OPEN_COMPOSER: async () => {
          callCount++;
          if (callCount === 1) throw new Error('Composer not found');
        },
      },
    });

    assert.deepStrictEqual(result, { success: true, steps: 3 });
    assert.strictEqual(callCount, 2, 'Should retry macro after failure');
    console.log('✅ Test 6 Passed: failed macro action is recorded but loop continues');
  }

  console.log('\n🎉 All Agent Loop tests passed!');
} catch (err) {
  console.error('❌ Agent Loop Test Suite Failed:', err);
  process.exit(1);
}
