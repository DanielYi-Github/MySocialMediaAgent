const DEFAULT_ALLOWED_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'integrate.api.nvidia.com',
  'generativelanguage.googleapis.com',
  'graph.facebook.com',
  'graph.instagram.com',
  'graph.threads.net',
];

const ALLOWED_METHODS = new Set(['GET', 'POST']);
const LOCAL_OLLAMA_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function getAllowedProxyHosts(envValue = '') {
  return new Set([
    ...DEFAULT_ALLOWED_HOSTS,
    ...String(envValue)
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ]);
}

export function validateProxyTarget({ url, method = 'POST', allowedHosts = getAllowedProxyHosts() }) {
  const normalizedMethod = String(method).toUpperCase();
  if (!ALLOWED_METHODS.has(normalizedMethod)) {
    throw createProxyValidationError('Proxy method is not allowed');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw createProxyValidationError('Invalid proxy url');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (isLocalOllamaUrl(parsedUrl)) {
    return { url: parsedUrl.toString(), method: normalizedMethod };
  }

  if (parsedUrl.protocol !== 'https:') {
    throw createProxyValidationError('Proxy target must use HTTPS');
  }

  if (isPrivateNetworkHost(hostname)) {
    throw createProxyValidationError('Proxy target cannot be a private network host');
  }

  if (!allowedHosts.has(hostname)) {
    throw createProxyValidationError('Proxy target host is not allowed');
  }

  return { url: parsedUrl.toString(), method: normalizedMethod };
}

export function redactSensitiveText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:access_token|api_key|key|token)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(
      /("(?:access_token|api[_-]?key|x-api-key|authorization|token)"\s*:\s*")[^"]+"/gi,
      '$1[REDACTED]"'
    );
}

export function getProxyErrorMessage(err) {
  let message = err.message;
  const responseData = err.response?.data;

  if (responseData) {
    if (Array.isArray(responseData) && responseData[0]?.error?.message) {
      message = responseData[0].error.message;
    } else if (responseData.error?.message) {
      message = responseData.error.message;
    } else if (typeof responseData.error === 'string') {
      message = responseData.error;
    }
  }

  return redactSensitiveText(message);
}

function isLocalOllamaUrl(parsedUrl) {
  return (
    parsedUrl.protocol === 'http:' &&
    LOCAL_OLLAMA_HOSTS.has(parsedUrl.hostname.toLowerCase()) &&
    parsedUrl.port === '11434' &&
    parsedUrl.pathname.startsWith('/v1/')
  );
}

function createProxyValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function isPrivateNetworkHost(hostname) {
  if (LOCAL_OLLAMA_HOSTS.has(hostname)) return true;
  if (hostname === '0.0.0.0') return true;
  if (hostname.startsWith('127.')) return true;
  if (hostname.startsWith('10.')) return true;
  if (hostname.startsWith('192.168.')) return true;
  if (hostname.startsWith('169.254.')) return true;

  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length === 4 && parts.every(Number.isInteger)) {
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }

  return false;
}
