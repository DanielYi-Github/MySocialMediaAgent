export const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyPlaceholder: 'sk-...',
    requiresApiKey: true,
    description: '標準 OpenAI Chat Completions。',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude / Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-7-sonnet-latest',
    apiKeyPlaceholder: 'sk-ant-...',
    requiresApiKey: true,
    description: '使用 Anthropic Messages API。',
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    protocol: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.2-11b-vision-instruct',
    apiKeyPlaceholder: 'nvapi-...',
    requiresApiKey: true,
    description: 'NVIDIA NIM 視覺模型（需支援圖片輸入）。',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama Local',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llava',
    apiKeyPlaceholder: '通常可留空',
    requiresApiKey: false,
    description: '本地模型，必須使用視覺模型（如 llava、llava-llama3、moondream）。',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    apiKeyPlaceholder: 'AIzaSy...',
    requiresApiKey: true,
    description: '使用 Gemini 官方提供的 OpenAI 相容 API。',
  },
  custom: {
    id: 'custom',
    label: 'Custom Compatible API',
    protocol: 'openai',
    baseUrl: 'https://your-endpoint.example.com/v1',
    model: '',
    apiKeyPlaceholder: '依供應商格式輸入',
    requiresApiKey: true,
    description: '任何 OpenAI-compatible 供應商。',
  },
};

export function getDefaultConfig(providerId = 'openai') {
  const provider = PROVIDERS[providerId] || PROVIDERS.openai;
  return {
    provider: provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey: '',
    model: provider.model,
  };
}

export function normalizeConfig(savedConfig) {
  if (!savedConfig) {
    return getDefaultConfig();
  }

  const provider = PROVIDERS[savedConfig.provider] || PROVIDERS.custom;
  return {
    provider: provider.id,
    protocol: provider.protocol,
    baseUrl: savedConfig.baseUrl || provider.baseUrl,
    apiKey: savedConfig.apiKey || '',
    model: savedConfig.model || provider.model,
  };
}

export function readStoredLlmConfig(storage = globalThis.localStorage) {
  if (!storage?.getItem) {
    return getDefaultConfig();
  }

  try {
    return normalizeConfig(JSON.parse(storage.getItem('llm_config') || 'null'));
  } catch {
    return getDefaultConfig();
  }
}

export function validateProviderConfig(config, options = {}) {
  const normalized = normalizeConfig(config);
  const next = {
    ...normalized,
    apiKey: normalized.apiKey.trim(),
    model: (normalized.model || '').trim(),
    baseUrl: (normalized.baseUrl || '').trim(),
  };

  if (!next.model) {
    throw new Error('請填寫模型名稱。');
  }

  if (!next.baseUrl) {
    throw new Error('請填寫 API Base URL。');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(next.baseUrl);
  } catch {
    throw new Error('API Base URL 格式錯誤。');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('API Base URL 只支援 HTTP 或 HTTPS。');
  }

  if (parsedUrl.protocol === 'http:' && !isLocalHttpHost(parsedUrl.hostname)) {
    throw new Error('HTTP API Base URL 只允許本機位址；公開 provider 請使用 HTTPS。');
  }

  next.baseUrl = parsedUrl.toString().replace(/\/+$/, '');
  return next;
}

export function getReadyLlmConfig(storage = globalThis.localStorage, options = {}) {
  const config = validateProviderConfig(readStoredLlmConfig(storage), options);
  if (options.requireApiKey !== false && requiresApiKey(config.provider) && !config.apiKey) {
    throw new Error('請先在設定中填寫 API Key。');
  }
  return config;
}

export function getOptionalReadyLlmConfig(storage = globalThis.localStorage, options = {}) {
  try {
    return getReadyLlmConfig(storage, options);
  } catch {
    return null;
  }
}

export function buildTestRequest(config, options = {}) {
  const safeConfig = validateProviderConfig(config, options);
  const cleanBaseUrl = safeConfig.baseUrl.replace(/\/+$/, '');

  if (safeConfig.protocol === 'anthropic') {
    return {
      url: `${cleanBaseUrl}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': safeConfig.apiKey,
        'anthropic-version': '2023-06-01',
      },
      data: {
        model: safeConfig.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Say ok.' }],
      },
    };
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  if (safeConfig.apiKey) {
    const cleanApiKey = safeConfig.apiKey.trim();
    headers.Authorization = `Bearer ${cleanApiKey}`;
  }

  return {
    url: `${cleanBaseUrl}/chat/completions`,
    headers,
    data: {
      model: safeConfig.model,
      messages: [{ role: 'user', content: 'Say ok.' }],
      max_tokens: 16,
    },
  };
}

export function requiresApiKey(providerId) {
  return (PROVIDERS[providerId] || PROVIDERS.custom).requiresApiKey;
}

function isLocalHttpHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}
