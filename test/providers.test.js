import assert from 'node:assert';
import process from 'node:process';
import { buildGenerationRequest } from '../src/lib/generation.js';
import {
  buildCapabilityProbeRequest,
  buildTestRequest,
  getEffectiveProviderCapabilities,
  getProviderCapabilities,
  isCapabilityProbeMatch,
  getOptionalReadyLlmConfig,
  getReadyLlmConfig,
  normalizeConfig,
  normalizeCapabilityProbeResponse,
  readStoredLlmConfig,
  validateProviderConfig,
} from '../src/lib/providers.js';

console.log('🧪 Running TDD tests for provider config safety...');

const SAMPLE_IMAGE = 'data:image/png;base64,ZmFrZQ==';
const SAMPLE_VIDEO = 'data:video/mp4;base64,ZmFrZV92aWRlbw==';

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

  const customVideoGenerationRequest = buildGenerationRequest({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  }, {
    assets: [
      {
        id: 'video-1',
        type: 'video',
        mime: 'video/mp4',
        sourceUrl: SAMPLE_VIDEO,
        isPrimary: true,
      },
    ],
    userContext: 'video test',
    primaryAssetId: 'video-1',
  }, {
    capabilities: {
      supportsImage: true,
      supportsVideo: true,
    },
  });
  assert.strictEqual(customVideoGenerationRequest.data.messages[1].content[1].type, 'video_url');
  console.log('✅ Test Case 11-1 Passed: OpenAI-compatible generation request uses video_url when video capability is enabled');

  const videoFrameFallbackRequest = buildGenerationRequest({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  }, {
    assets: [
      {
        id: 'frame-1',
        type: 'image',
        mime: 'image/jpeg',
        sourceUrl: SAMPLE_IMAGE,
        isPrimary: true,
      },
      {
        id: 'frame-2',
        type: 'image',
        mime: 'image/jpeg',
        sourceUrl: SAMPLE_IMAGE,
        isPrimary: false,
      },
      {
        id: 'frame-3',
        type: 'image',
        mime: 'image/jpeg',
        sourceUrl: SAMPLE_IMAGE,
        isPrimary: false,
      },
    ],
    userContext: 'video fallback test',
    primaryAssetId: 'frame-1',
  }, {
    capabilities: {
      supportsImage: true,
      supportsVideo: false,
    },
    analysisMode: 'video_frames',
  });
  assert.strictEqual(videoFrameFallbackRequest.data.messages[1].content.length, 4);
  assert.strictEqual(videoFrameFallbackRequest.data.messages[1].content[1].type, 'image_url');
  assert.strictEqual(videoFrameFallbackRequest.data.messages[1].content[2].type, 'image_url');
  assert.strictEqual(videoFrameFallbackRequest.data.messages[1].content[3].type, 'image_url');
  console.log('✅ Test Case 11-1b Passed: Video frame fallback sends multiple image_url parts in one request');

  assert.throws(() => buildGenerationRequest({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  }, {
    assets: [
      {
        id: 'video-1',
        type: 'video',
        mime: 'video/mp4',
        sourceUrl: SAMPLE_VIDEO,
        isPrimary: true,
      },
    ],
    userContext: 'video test',
    primaryAssetId: 'video-1',
  }, {
    capabilities: {
      supportsImage: true,
      supportsVideo: false,
    },
  }), /尚未確認支援影片理解/);
  console.log('✅ Test Case 11-2 Passed: Video generation still blocks when capability probe does not enable video');

  const geminiCapabilities = getProviderCapabilities({
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'AIza-test',
    model: 'gemini-2.5-flash',
  });
  assert.strictEqual(geminiCapabilities.supportsVideo, true);
  console.log('✅ Test Case 12 Passed: Gemini provider advertises native video support');

  const geminiTestRequest = buildTestRequest({
    provider: 'gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'AIza-test',
    model: 'gemini-2.5-flash',
  });
  assert.strictEqual(geminiTestRequest.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  console.log('✅ Test Case 13 Passed: Gemini test request uses the native generateContent endpoint');

  const anthropicProbeRequest = buildCapabilityProbeRequest({
    provider: 'anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    model: 'claude-3-7-sonnet-latest',
  });
  assert.strictEqual(anthropicProbeRequest.url, 'https://api.anthropic.com/v1/messages');
  console.log('✅ Test Case 14 Passed: Capability probe request uses the Anthropic Messages endpoint');

  const openAiProbeRequest = buildCapabilityProbeRequest({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  });
  assert.strictEqual(openAiProbeRequest.url, 'https://inference-api.nousresearch.com/v1/chat/completions');
  console.log('✅ Test Case 15 Passed: Capability probe request uses the OpenAI-compatible endpoint');

  const normalizedProbe = normalizeCapabilityProbeResponse(
    { protocol: 'openai' },
    {
      choices: [
        {
          message: {
            content: JSON.stringify({
              supportsToolUse: true,
              supportsText: true,
              supportsImage: true,
              supportsVideo: true,
              supportsMultimodal: true,
              summary: '支援文字、圖片、影片理解與工具使用',
            }),
          },
        },
      ],
    },
  );
  assert.strictEqual(normalizedProbe.supportsVideo, true);
  assert.strictEqual(normalizedProbe.supportsToolUse, true);
  console.log('✅ Test Case 16 Passed: Capability probe response parses valid JSON output');

  assert.throws(() => normalizeCapabilityProbeResponse(
    { protocol: 'openai' },
    {
      choices: [
        {
          message: {
            content: '{"supportsToolUse":"unknown","supportsText":true,"supportsImage":true,"supportsVideo":true,"supportsMultimodal":true,"summary":"未知"}',
          },
        },
      ],
    },
  ), /unknown|缺少必要欄位/);
  console.log('✅ Test Case 17 Passed: Capability probe rejects unknown capability flags');

  const probeRecord = {
    provider: 'custom',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    model: 'vision-model',
    source: 'probe',
    detectedAt: '2026-06-07T12:34:56.000Z',
    capabilities: {
      supportsToolUse: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: true,
      supportsMultimodal: true,
      summary: 'probe',
    },
  };
  assert.strictEqual(isCapabilityProbeMatch({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  }, probeRecord), true);
  const effectiveCapabilities = getEffectiveProviderCapabilities({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  }, probeRecord);
  assert.strictEqual(effectiveCapabilities.supportsVideo, true);
  assert.strictEqual(effectiveCapabilities.source, 'probe');
  console.log('✅ Test Case 18 Passed: Probe results override static fallback capabilities when config matches');

  const fallbackCapabilities = getEffectiveProviderCapabilities({
    provider: 'custom',
    protocol: 'openai',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    apiKey: 'custom-key',
    model: 'vision-model',
  }, null);
  assert.strictEqual(fallbackCapabilities.source, 'static-fallback');
  console.log('✅ Test Case 19 Passed: Effective capabilities fall back to static provider defaults when no probe exists');

  console.log('\n🎉 All provider safety TDD tests passed successfully!');
} catch (error) {
  console.error('❌ Provider safety TDD Test Suite Failed:', error.message);
  process.exit(1);
}
