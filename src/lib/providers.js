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
    provider: savedConfig.provider || provider.id,
    protocol: savedConfig.protocol || provider.protocol,
    baseUrl: savedConfig.baseUrl || provider.baseUrl,
    apiKey: savedConfig.apiKey || '',
    model: savedConfig.model || provider.model,
  };
}

export function buildTestRequest(config) {
  const cleanBaseUrl = config.baseUrl.replace(/\/+$/, '');

  if (config.protocol === 'anthropic') {
    return {
      url: `${cleanBaseUrl}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      data: {
        model: config.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Say ok.' }],
      },
    };
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    const cleanApiKey = config.apiKey.trim();
    headers.Authorization = `Bearer ${cleanApiKey}`;
  }

  return {
    url: `${cleanBaseUrl}/chat/completions`,
    headers,
    data: {
      model: config.model,
      messages: [{ role: 'user', content: 'Say ok.' }],
      max_tokens: 16,
    },
  };
}

export function requiresApiKey(providerId) {
  return (PROVIDERS[providerId] || PROVIDERS.custom).requiresApiKey;
}