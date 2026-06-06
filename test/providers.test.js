import assert from 'node:assert';
import { buildGenerationRequest } from '../src/lib/generation.js';
import {
  buildTestRequest,
  getOptionalReadyLlmConfig,
  getReadyLlmConfig,
  normalizeConfig,
  readStoredLlmConfig,
  validateProviderConfig,
} from '../src/lib/providers.js';

console.log('🧪 Running TDD tests for provider config safety...');

const SAMPLE_IMAGE = 'data:image/png;base64,ZmFrZQ==';

try {
  const malformedStorage = {
    getItem() {
      return '{bad json';
    },
  };
  const fallbackConfig = readStoredLlmConfig(malformedStorage);
  assert.strictEqual(fallbackConfig.provider, 'openai');
  assert.strictEqual(fallbackConfig.baseUrl, 'https://api.openai.com/v1');
  console.log('✅ Test Case 1 Passed: Malformed stored config falls back to the default provider config');

  const missingKeyStorage = {
    getItem() {
      return JSON.stringify({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '   ',
        model: 'gpt-4o',
      });
    },
  };
  assert.throws(() => getReadyLlmConfig(missingKeyStorage), /API Key/);
  console.log('✅ Test Case 2 Passed: Ready helper rejects providers that still need an API key');

  assert.strictEqual(getOptionalReadyLlmConfig(missingKeyStorage), null);
  console.log('✅ Test Case 3 Passed: Optional ready helper returns null when config is not usable');

  const readyStorage = {
    getItem() {
      return JSON.stringify({
        provider: 'openai',
        baseUrl: 'https://evil.example.com/v1',
        apiKey: '  sk-test  ',
        model: 'gpt-4o',
      });
    },
  };
  const readyConfig = getReadyLlmConfig(readyStorage);
  assert.strictEqual(readyConfig.baseUrl, 'https://evil.example.com/v1');
  assert.strictEqual(readyConfig.apiKey, 'sk-test');
  console.log('✅ Test Case 4 Passed: Ready helper normalizes stored config through one shared path');

  const optionalReadyConfig = getOptionalReadyLlmConfig(readyStorage);
  assert.deepStrictEqual(optionalReadyConfig, readyConfig);
  console.log('✅ Test Case 5 Passed: Optional ready helper returns normalized config when usable');

  const normalizedOpenAi = normalizeConfig({
    provider: 'openai',
    protocol: 'openai',
    baseUrl: 'https://evil.example.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o',
  });
  assert.strictEqual(normalizedOpenAi.baseUrl, 'https://evil.example.com/v1');
  console.log('✅ Test Case 6 Passed: Provider base URL remains user-editable');

  const safeCustomConfig = validateProviderConfig({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1/',
    apiKey: 'custom-key',
    model: 'vision-model',
  });
  assert.strictEqual(safeCustomConfig.baseUrl, 'https://inference-api.nousresearch.com/v1');
  console.log('✅ Test Case 7 Passed: Custom provider accepts arbitrary HTTPS OpenAI-compatible hosts');

  assert.throws(() => validateProviderConfig({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'not-a-url',
    apiKey: 'custom-key',
    model: 'vision-model',
  }), /格式錯誤/);
  console.log('✅ Test Case 8 Passed: Custom provider still validates URL format');

  assert.throws(() => validateProviderConfig({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'http://api.allowed.example/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  }), /HTTPS/);
  console.log('✅ Test Case 9 Passed: Custom provider rejects non-HTTPS endpoints');

  const customTestRequest = buildTestRequest({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  });
  assert.strictEqual(customTestRequest.url, 'https://inference-api.nousresearch.com/v1/chat/completions');
  console.log('✅ Test Case 10 Passed: Test request builder allows arbitrary custom hosts');

  const customGenerationRequest = buildGenerationRequest({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  }, {
    imageDataUrls: [SAMPLE_IMAGE],
    userContext: 'test',
  });
  assert.strictEqual(customGenerationRequest.url, 'https://inference-api.nousresearch.com/v1/chat/completions');
  console.log('✅ Test Case 11 Passed: Generation request builder allows arbitrary custom hosts');

  console.log('\n🎉 All provider safety TDD tests passed successfully!');
} catch (error) {
  console.error('❌ Provider safety TDD Test Suite Failed:', error.message);
  process.exit(1);
}
