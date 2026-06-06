import assert from 'node:assert';
import {
  buildFacebookPublishGoal,
  buildInstagramPublishGoal,
  buildXhsPublishGoal,
} from '../../server/agent/publish-goals.js';

console.log('🧪 Running TDD tests for publish goals...');

try {
  const tmpFiles = ['/tmp/social-image-1.jpg', '/tmp/social-image-2.png'];

  for (const goal of [
    buildFacebookPublishGoal({ caption: 'hello', tmpFiles }),
    buildInstagramPublishGoal({ caption: 'hello', tmpFiles }),
    buildXhsPublishGoal({ title: 'title', content: 'content', tmpFiles }),
  ]) {
    assert.match(goal, /setInputFiles/);
    assert.match(goal, /input\[type="file"\]/);
    assert.match(goal, /不要開啟作業系統檔案選擇視窗/);
    assert.match(goal, /不要要求使用者手動選檔/);
    assert.match(goal, /\/tmp\/social-image-1\.jpg/);
    assert.doesNotMatch(goal, /當出現選擇檔案時/);
  }

  const noImageGoal = buildFacebookPublishGoal({ caption: 'text only', tmpFiles: [] });
  assert.doesNotMatch(noImageGoal, /setInputFiles/);

  console.log('✅ Test Passed: publish goals force direct file injection, not manual file picking');
  console.log('\n🎉 All publish goal tests passed!');
} catch (err) {
  console.error('❌ Publish Goal Test Suite Failed:', err);
  process.exit(1);
}
