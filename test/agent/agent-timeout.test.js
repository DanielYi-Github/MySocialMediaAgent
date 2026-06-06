import assert from 'node:assert';
import { executeStepWithTimeout } from '../../server/agent/agent-loop.js';

console.log('🧪 Running TDD tests for Agent step timeout cleanup...');

try {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    await assert.rejects(
      () => executeStepWithTimeout({}, 'throw new Error("boom");', 20),
      /boom/
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(unhandled.length, 0);
    console.log('✅ Test 1 Passed: failed step clears timeout without delayed unhandled rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }

  console.log('\n🎉 All Agent timeout tests passed!');
} catch (err) {
  console.error('❌ Agent Timeout Test Suite Failed:', err);
  process.exit(1);
}
