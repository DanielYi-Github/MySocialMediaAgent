import assert from 'node:assert';
import {
  getAllowedProxyHosts,
  redactSensitiveText,
  validateProxyTarget,
} from '../server/proxy-security.js';

console.log('🧪 Running TDD tests for proxy security...');

function assertValid(url, method = 'POST', allowedHosts) {
  assert.doesNotThrow(() => validateProxyTarget({ url, method, allowedHosts }));
}

function assertInvalid(url, message, method = 'POST', allowedHosts) {
  assert.throws(() => validateProxyTarget({ url, method, allowedHosts }), message);
}

try {
  assertValid('https://api.openai.com/v1/chat/completions');
  assertValid('https://api.anthropic.com/v1/messages');
  assertValid('https://integrate.api.nvidia.com/v1/chat/completions');
  assertValid('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assertValid('https://graph.facebook.com/v20.0/me');
  assertValid('https://graph.instagram.com/v20.0/me');
  assertValid('https://graph.threads.net/v1.0/me');
  console.log('✅ Test Case 1 Passed: Official upstream hosts are allowed');

  assertValid('http://localhost:11434/v1/chat/completions');
  assertValid('http://127.0.0.1:11434/v1/chat/completions');
  assertInvalid('http://localhost:3001/api/llm/proxy', /HTTPS|private network|not allowed/);
  assertInvalid('http://127.0.0.1:3001/api/llm/proxy', /HTTPS|private network|not allowed/);
  console.log('✅ Test Case 2 Passed: Only local Ollama is allowed on localhost');

  assertInvalid('http://api.openai.com/v1/chat/completions', /HTTPS/);
  assertInvalid('https://10.0.0.2/internal', /private network/);
  assertInvalid('https://192.168.1.10/internal', /private network/);
  assertInvalid('https://172.16.0.5/internal', /private network/);
  assertInvalid('https://169.254.1.1/internal', /private network/);
  console.log('✅ Test Case 3 Passed: Insecure and private-network targets are blocked');

  assertInvalid('https://evil.example.com/v1/chat/completions', /not allowed/);
  const customHosts = getAllowedProxyHosts('custom.example.com, api.openai.com');
  assertValid('https://custom.example.com/v1/chat/completions', 'POST', customHosts);
  assertInvalid('https://evil.example.com/v1/chat/completions', /not allowed/, 'POST', customHosts);
  console.log('✅ Test Case 4 Passed: Custom hosts require explicit allowlist');

  assertInvalid('https://api.openai.com/v1/chat/completions', /method/i, 'PUT');
  assertValid('https://api.openai.com/v1/models', 'GET');
  console.log('✅ Test Case 5 Passed: Proxy methods are restricted to GET/POST');

  const redacted = redactSensitiveText({
    error: {
      message: 'Bearer sk-secret-token failed with access_token=EAAB-secret',
      api_key: 'visible-secret',
    },
  });
  assert(!redacted.includes('sk-secret-token'));
  assert(!redacted.includes('EAAB-secret'));
  assert(!redacted.includes('visible-secret'));
  assert(redacted.includes('[REDACTED]'));
  console.log('✅ Test Case 6 Passed: Error messages redact sensitive tokens');

  console.log('\n🎉 All proxy security TDD tests passed successfully!');
} catch (error) {
  console.error('❌ Proxy security TDD Test Suite Failed:', error.message);
  process.exit(1);
}
