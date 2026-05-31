import assert from 'node:assert';
import { normalizeGenerationResponse } from '../src/lib/generation.js';

console.log('🧪 Running TDD tests for Robust JSON Extraction...');

// Mock configuration (OpenAI protocol)
const mockConfig = {
  protocol: 'openai',
  model: 'meta/llama-3.2-11b-vision-instruct',
};

try {
  // Test Case 1: Simple JSON without code fences
  const rawResponse1 = {
    choices: [{
      message: {
        role: 'assistant',
        content: '{"vision_insight": {"landmark": "Test Place", "mood": "chill", "tone": "bright"}, "platforms": {"instagram": {"content": "Post 1"}, "xhs": "Post 2", "facebook": "Post 3", "threads": "Post 4"}}'
      }
    }]
  };
  const parsed1 = normalizeGenerationResponse(mockConfig, rawResponse1);
  assert.strictEqual(parsed1.analyzer.landmark, 'Test Place');
  assert.strictEqual(parsed1.drafts.instagram, 'Post 1');
  console.log('✅ Test Case 1 Passed: Simple JSON parsed perfectly');

  // Test Case 2: JSON wrapped in Markdown code fences
  const rawResponse2 = {
    choices: [{
      message: {
        role: 'assistant',
        content: 'Here is your draft:\n```json\n{"vision_insight": {"landmark": "Test Fence", "mood": "happy", "tone": "warm"}, "platforms": {"instagram": {"content": "Post IG"}, "xhs": "Post XHS", "facebook": "Post FB", "threads": "Post TH"}}\n```\nHope you like it!'
      }
    }]
  };
  const parsed2 = normalizeGenerationResponse(mockConfig, rawResponse2);
  assert.strictEqual(parsed2.analyzer.landmark, 'Test Fence');
  assert.strictEqual(parsed2.drafts.instagram, 'Post IG');
  console.log('✅ Test Case 2 Passed: Fenced JSON parsed perfectly');

  // Test Case 3: The "Dali ancient city" bug (Multiple duplicate JSON objects inside Markdown headers/inline code)
  const rawResponse3 = {
    choices: [{
      message: {
        role: 'assistant',
        content: `### 圖片分析

*   圖片中顯示的建築物是古代城牆。

### 歷史小故事

大理王國是古代雲南的政權...

### Instagram草稿

\`{"vision_insight": {"landmark": "大理王國古城", "mood": "歷史", "tone": "藍色"}, "platforms": {"instagram": {"content": "古時候的雲南大理，#大理王國 #雲南歷史"}, "xhs": {"content": "小紅書大理"}, "facebook": {"content": "大理FB"}, "threads": {"content": "大理Threads"}}}\`

### 小紅書草稿

\`{"vision_insight": {"landmark": "大理王國古城", "mood": "歷史", "tone": "藍色"}, "platforms": {"instagram": {"content": "古時候的雲南大理"}, "xhs": {"content": "小紅書大理"}, "facebook": {"content": "大理FB"}, "threads": {"content": "大理Threads"}}}\``
      }
    }]
  };

  const parsed3 = normalizeGenerationResponse(mockConfig, rawResponse3);
  assert.strictEqual(parsed3.analyzer.landmark, '大理王國古城');
  assert.strictEqual(parsed3.drafts.instagram, '古時候的雲南大理，#大理王國 #雲南歷史');
  assert.strictEqual(parsed3.drafts.xhs, '小紅書大理');
  console.log('✅ Test Case 3 Passed: Multiple duplicate inline JSON blocks parsed perfectly (The Dali Ancient City case)');

  console.log('\n🎉 All JSON Extraction TDD tests passed successfully!');
} catch (error) {
  console.error('❌ JSON Extraction TDD Test Suite Failed:', error);
  process.exit(1);
}
