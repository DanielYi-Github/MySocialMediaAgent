import assert from 'node:assert';
import { appendSignature } from '../src/lib/generation.js';

console.log('🧪 Running TDD tests for appendSignature...');

try {
  // Test Case 1: Append signature when enabled
  const input1 = 'Hello, this is a post #cool';
  const expected1 = 'Hello, this is a post #cool\n\n本篇貼文由 social media agent 產生';
  const result1 = appendSignature(input1, true);
  assert.strictEqual(result1, expected1, 'Test Case 1 Failed: Should append signature');
  console.log('✅ Test Case 1 Passed: Signature appended correctly');

  // Test Case 2: Do not append signature when disabled
  const input2 = 'Hello, this is a post #cool';
  const expected2 = 'Hello, this is a post #cool';
  const result2 = appendSignature(input2, false);
  assert.strictEqual(result2, expected2, 'Test Case 2 Failed: Should not append signature');
  console.log('✅ Test Case 2 Passed: Signature not appended when disabled');

  // Test Case 3: Toggle signature off if it already exists
  const input3 = 'Hello, this is a post #cool\n\n本篇貼文由 social media agent 產生';
  const expected3 = 'Hello, this is a post #cool';
  const result3 = appendSignature(input3, false);
  assert.strictEqual(result3, expected3, 'Test Case 3 Failed: Should remove existing signature');
  console.log('✅ Test Case 3 Passed: Signature removed successfully');

  // Test Case 4: Toggle signature on and off repeatedly without duplicate appends
  const input4 = 'Hello, this is a post #cool\n\n本篇貼文由 social media agent 產生';
  const expected4 = 'Hello, this is a post #cool\n\n本篇貼文由 social media agent 產生';
  const result4 = appendSignature(input4, true);
  assert.strictEqual(result4, expected4, 'Test Case 4 Failed: Should not duplicate signature if already present');
  console.log('✅ Test Case 4 Passed: No duplicate signature appended');

  console.log('\n🎉 All TDD tests passed successfully!');
} catch (error) {
  console.error('❌ TDD Test Suite Failed:', error.message);
  process.exit(1);
}
