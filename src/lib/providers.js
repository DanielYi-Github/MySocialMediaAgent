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
    supportsImage: true,
    supportsVideo: false,
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
    supportsImage: true,
    supportsVideo: false,
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
    supportsImage: true,
    supportsVideo: false,
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
    supportsImage: true,
    supportsVideo: false,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    apiKeyPlaceholder: 'AIzaSy...',
    requiresApiKey: true,
    description: '使用 Gemini 官方原生 API，支援圖片與小型影片理解。',
    supportsImage: true,
    supportsVideo: true,
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
    supportsImage: true,
    supportsVideo: false,
  },
};

export const CAPABILITY_PROBE_STORAGE_KEY = 'llm_capability_probe';

const CAPABILITY_PROBE_PROMPT = `你現在要回報「目前這個模型本身」是否具備以下能力，請只回傳 JSON，不要附帶 markdown、說明、註解。

請根據你目前這個模型與目前 API 路徑可提供的能力，回答以下欄位：
- supportsToolUse
- supportsText
- supportsImage
- supportsVideo
- supportsMultimodal
- summary

規則：
1. 每個 supports* 欄位只能填 true、false 或 "unknown"
2. summary 請用一句繁體中文簡短總結
3. 只回傳以下 JSON 結構：
{
  "supportsToolUse": true,
  "supportsText": true,
  "supportsImage": true,
  "supportsVideo": false,
  "supportsMultimodal": true,
  "summary": "支援文字、圖片理解，但不支援影片理解"
}`;

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

export function validateProviderConfig(config) {
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

export function buildCapabilityProbeRequest(config) {
  const safeConfig = validateProviderConfig(config);
  const cleanBaseUrl = safeConfig.baseUrl.replace(/\/+$/, '');

  if (safeConfig.protocol === 'gemini') {
    return {
      url: `${cleanBaseUrl}/models/${safeConfig.model}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': safeConfig.apiKey,
      },
      data: {
        contents: [
          {
            parts: [
              { text: CAPABILITY_PROBE_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
        },
      },
    };
  }

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
        max_tokens: 200,
        messages: [{ role: 'user', content: CAPABILITY_PROBE_PROMPT }],
      },
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (safeConfig.apiKey) {
    headers.Authorization = `Bearer ${safeConfig.apiKey.trim()}`;
  }

  return {
    url: `${cleanBaseUrl}/chat/completions`,
    headers,
    data: {
      model: safeConfig.model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: CAPABILITY_PROBE_PROMPT }],
      max_tokens: 200,
      temperature: 0,
    },
  };
}

export function buildTestRequest(config, options = {}) {
  const safeConfig = validateProviderConfig(config, options);
  const cleanBaseUrl = safeConfig.baseUrl.replace(/\/+$/, '');

  if (safeConfig.protocol === 'gemini') {
    return {
      url: `${cleanBaseUrl}/models/${safeConfig.model}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': safeConfig.apiKey,
      },
      data: {
        contents: [
          {
            parts: [
              { text: 'Say ok.' },
            ],
          },
        ],
      },
    };
  }

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

export function getProviderCapabilities(config) {
  const normalized = normalizeConfig(config);
  const provider = PROVIDERS[normalized.provider] || PROVIDERS.custom;

  return {
    supportsToolUse: provider.protocol === 'openai' || provider.protocol === 'gemini',
    supportsText: true,
    supportsImage: provider.supportsImage !== false,
    supportsVideo: provider.supportsVideo === true,
    supportsMultimodal: provider.supportsImage !== false || provider.supportsVideo === true,
    protocol: provider.protocol,
    providerId: provider.id,
    source: 'static-fallback',
    summary: provider.supportsVideo === true
      ? '預設判定支援文字、圖片與影片理解。'
      : '預設判定支援文字與圖片理解。',
  };
}

export function normalizeCapabilityProbeResponse(config, response) {
  const rawText = getResponseText(config, response);
  const parsed = extractJsonObject(rawText);

  if (!parsed) {
    throw new Error('模型能力偵測回覆不是有效 JSON。');
  }

  const capabilities = {
    supportsToolUse: normalizeCapabilityFlag(parsed.supportsToolUse),
    supportsText: normalizeCapabilityFlag(parsed.supportsText),
    supportsImage: normalizeCapabilityFlag(parsed.supportsImage),
    supportsVideo: normalizeCapabilityFlag(parsed.supportsVideo),
    supportsMultimodal: normalizeCapabilityFlag(parsed.supportsMultimodal),
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
  };

  const hasUnknown = Object.entries(capabilities)
    .some(([key, value]) => key !== 'summary' && value === null);

  if (hasUnknown) {
    throw new Error('模型能力偵測結果含有 unknown 或缺少必要欄位。');
  }

  if (!capabilities.summary) {
    throw new Error('模型能力偵測結果缺少 summary。');
  }

  return capabilities;
}

export function readStoredCapabilityProbe(storage = globalThis.localStorage) {
  if (!storage?.getItem) return null;
  try {
    return JSON.parse(storage.getItem(CAPABILITY_PROBE_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function isCapabilityProbeMatch(config, probeRecord) {
  if (!config || !probeRecord) return false;
  const normalized = validateProviderConfig(config);
  return probeRecord.provider === normalized.provider
    && probeRecord.baseUrl === normalized.baseUrl
    && probeRecord.model === normalized.model;
}

export function getEffectiveProviderCapabilities(config, probeRecord = null) {
  const fallback = getProviderCapabilities(config);

  if (!probeRecord || !isCapabilityProbeMatch(config, probeRecord)) {
    return fallback;
  }

  const capabilities = probeRecord.capabilities || {};
  return {
    ...fallback,
    ...capabilities,
    source: probeRecord.source || 'probe',
    detectedAt: probeRecord.detectedAt,
    summary: capabilities.summary || fallback.summary,
  };
}

function getResponseText(config, response) {
  if (config.protocol === 'anthropic') {
    const blocks = response?.content ?? [];
    return blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  if (config.protocol === 'gemini') {
    const parts = response?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((part) => part.text || '').join('\n');
  }

  return response?.choices?.[0]?.message?.content ?? '';
}

function extractJsonObject(rawText) {
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        return null;
      }
    }

    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function normalizeCapabilityFlag(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    if (normalized === 'unknown') return null;
  }
  return null;
}

function isLocalHttpHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}
