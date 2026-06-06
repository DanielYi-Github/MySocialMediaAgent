/**
 * Backend LLM client for Self-Healing Agent.
 *
 * Supports OpenAI-compatible and Anthropic protocols.
 * Uses axios (already a project dependency) for HTTP calls.
 */

import axios from 'axios';
import https from 'https';
import http from 'http';
import { HEAL_SYSTEM_PROMPT } from './prompts.js';
import { AGENT_SYSTEM_PROMPT } from './agent-prompts.js';

const AXIOS_OPTS = {
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  httpAgent: new http.Agent({ keepAlive: true }),
};

// When server is HTTP-only but URL has https://, auto-retry with http://
async function axiosPostWithFallback(url, payload, config) {
  try {
    return await axios.post(url, payload, { ...AXIOS_OPTS, ...config });
  } catch (err) {
    if (err.code === 'EPROTO' && err.message.includes('wrong version number') && url.startsWith('https://')) {
      return axios.post(url.replace(/^https:\/\//, 'http://'), payload, { ...AXIOS_OPTS, ...config });
    }
    throw err;
  }
}

/**
 * Call the LLM to generate Playwright code for the given prompt.
 *
 * @param {object} opts
 * @param {object} opts.llmConfig      - { protocol, baseUrl, apiKey, model }
 * @param {string} opts.userPrompt     - The user-side prompt text
 * @param {string} [opts.screenshotBase64] - Optional base64 screenshot for vision models
 * @returns {Promise<string>} - Raw LLM response text (should be Playwright code)
 */
export async function callHealLLM({ llmConfig, userPrompt, screenshotBase64 }) {
  const { protocol, baseUrl, apiKey, model } = llmConfig;
  const cleanBase = baseUrl.replace(/\/+$/, '');

  const executeCall = async (opts) => {
    const isGemini = cleanBase.includes('generativelanguage.googleapis.com');
    if (isGemini && protocol !== 'anthropic') {
      return _callGeminiNative({
        cleanBase,
        apiKey,
        model,
        userPrompt: opts.userPrompt,
        screenshotBase64: opts.screenshotBase64,
        systemPrompt: HEAL_SYSTEM_PROMPT
      });
    }

    if (protocol === 'anthropic') {
      return _callAnthropicProtocol({
        cleanBase,
        apiKey,
        model,
        userPrompt: opts.userPrompt,
        screenshotBase64: opts.screenshotBase64,
        systemPrompt: HEAL_SYSTEM_PROMPT
      });
    }

    return _callOpenAICompatible({
      cleanBase,
      apiKey,
      model,
      userPrompt: opts.userPrompt,
      screenshotBase64: opts.screenshotBase64,
      systemPrompt: HEAL_SYSTEM_PROMPT
    });
  };

  return _callLLMWithVisionFallback(executeCall, { userPrompt, screenshotBase64 });
}

/**
 * Call the LLM for the iterative Agent Loop.
 * Returns a parsed JSON object: { thought, action, code?, reason? }
 *
 * @param {object} opts
 * @param {object} opts.llmConfig        - { protocol, baseUrl, apiKey, model }
 * @param {string} opts.userPrompt       - The step prompt
 * @param {string} [opts.screenshotBase64] - Current page screenshot
 * @param {string} [opts.systemPrompt]   - Optional custom system prompt (default: AGENT_SYSTEM_PROMPT)
 * @returns {Promise<{thought: string, action: string, code?: string, reason?: string}>}
 */
export async function callAgentLLM({ llmConfig, userPrompt, screenshotBase64, systemPrompt }) {
  const { protocol, baseUrl, apiKey, model } = llmConfig;
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const finalSystemPrompt = systemPrompt || AGENT_SYSTEM_PROMPT;

  const executeCall = async (opts) => {
    const isGemini = cleanBase.includes('generativelanguage.googleapis.com');
    if (isGemini && protocol !== 'anthropic') {
      return _callGeminiNative({
        cleanBase,
        apiKey,
        model,
        userPrompt: opts.userPrompt,
        screenshotBase64: opts.screenshotBase64,
        systemPrompt: finalSystemPrompt,
        maxTokens: 2000
      });
    }

    if (protocol === 'anthropic') {
      return _callAnthropicProtocol({
        cleanBase,
        apiKey,
        model,
        userPrompt: opts.userPrompt,
        screenshotBase64: opts.screenshotBase64,
        systemPrompt: finalSystemPrompt,
        maxTokens: 2000
      });
    }

    return _callOpenAICompatible({
      cleanBase,
      apiKey,
      model,
      userPrompt: opts.userPrompt,
      screenshotBase64: opts.screenshotBase64,
      systemPrompt: finalSystemPrompt,
      maxTokens: 2000
    });
  };

  const rawText = await _callLLMWithVisionFallback(executeCall, { userPrompt, screenshotBase64 });

  // Parse JSON from the response (may be wrapped in markdown fences)
  return parseAgentResponse(rawText);
}

/**
 * Helper wrapper to automatically fallback to text-only mode if vision call fails.
 */
async function _callLLMWithVisionFallback(fn, opts) {
  const { screenshotBase64 } = opts;
  if (!screenshotBase64) {
    return fn(opts);
  }

  try {
    return await fn(opts);
  } catch (err) {
    console.warn(`\x1b[1m\x1b[33m[LLM Client] ⚠️ Vision 呼叫失敗，將嘗試退回純文字模式重試。錯誤: ${err.message}\x1b[0m`);
    return fn({ ...opts, screenshotBase64: null });
  }
}

async function _callGeminiNative({ cleanBase, apiKey, model, userPrompt, screenshotBase64, systemPrompt, maxTokens = 1000 }) {
  // 移除 /openai 或 /openai/v1，取得 API 基礎路徑
  let baseUrlWithoutOpenAI = cleanBase.replace(/\/openai(\/v1)?$/, '');
  if (!baseUrlWithoutOpenAI.includes('/v1') && !baseUrlWithoutOpenAI.includes('/v1beta')) {
    baseUrlWithoutOpenAI = `${baseUrlWithoutOpenAI}/v1beta`;
  }

  const url = `${baseUrlWithoutOpenAI}/models/${model}:generateContent?key=${apiKey}`;

  const parts = [{ text: userPrompt }];
  if (screenshotBase64) {
    const cleanBase64 = _cleanBase64Image(screenshotBase64);
    if (cleanBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: cleanBase64
        }
      });
    }
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      maxOutputTokens: maxTokens
    }
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['x-goog-api-key'] = apiKey;
  }

  try {
    const res = await axiosPostWithFallback(url, payload, { headers, timeout: 60000 });
    return res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  } catch (err) {
    if (err.response) {
      console.error(`[LLM Client] HTTP ${err.response.status} from Gemini Native API`);
      console.error(`[LLM Client] Response:`, JSON.stringify(err.response.data).slice(0, 500));
      console.error(`[LLM Client] Model: ${model}, Screenshot attached: ${!!screenshotBase64}`);
      if (err.response.status === 404) {
        throw new Error(`Gemini 模型 "${model}" 不存在（HTTP 404）。請確認模型名稱，例如 gemini-2.0-flash 或 gemini-2.5-flash。`);
      }
    }
    throw err;
  }
}

async function _callOpenAICompatible({ cleanBase, apiKey, model, userPrompt, screenshotBase64, systemPrompt, maxTokens = 1000 }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const cleanScreenshot = _cleanBase64Image(screenshotBase64);

  const userContent = cleanScreenshot
    ? [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cleanScreenshot}` } },
      ]
    : userPrompt;

  const payload = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };

  try {
    const res = await axiosPostWithFallback(
      `${cleanBase}/chat/completions`,
      payload,
      { headers, timeout: 60000 },
    );
    return res.data?.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    if (err.response) {
      console.error(`[LLM Client] HTTP ${err.response.status} from ${cleanBase}/chat/completions`);
      console.error(`[LLM Client] Response:`, JSON.stringify(err.response.data).slice(0, 500));
      console.error(`[LLM Client] Model: ${model}, Screenshot attached: ${!!screenshotBase64}`);
    }
    throw err;
  }
}

async function _callAnthropicProtocol({ cleanBase, apiKey, model, userPrompt, screenshotBase64, systemPrompt, maxTokens = 1000 }) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  const cleanScreenshot = _cleanBase64Image(screenshotBase64);

  const userContent = cleanScreenshot
    ? [
        { type: 'text', text: userPrompt },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: cleanScreenshot } },
      ]
    : [{ type: 'text', text: userPrompt }];

  const payload = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  };

  try {
    const res = await axiosPostWithFallback(
      `${cleanBase}/messages`,
      payload,
      { headers, timeout: 60000 },
    );
    const blocks = res.data?.content ?? [];
    return blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
  } catch (err) {
    if (err.response) {
      console.error(`[LLM Client] HTTP ${err.response.status} from ${cleanBase}/messages`);
      console.error(`[LLM Client] Response:`, JSON.stringify(err.response.data).slice(0, 500));
      console.error(`[LLM Client] Model: ${model}, Screenshot attached: ${!!screenshotBase64}`);
    }
    throw err;
  }
}

/**
 * Parse the LLM's JSON response for the Agent Loop.
 * Handles cases where the JSON may be wrapped in markdown fences.
 *
 * @param {string} raw
 * @returns {{thought: string, action: string, code?: string, reason?: string}}
 */
export function parseAgentResponse(raw) {
  if (!raw) {
    return { thought: 'LLM returned empty response', action: 'fail', reason: 'Empty LLM response' };
  }

  const cleaned = stripOuterCodeFence(raw.trim());
  const jsonCandidate = extractBalancedJsonObject(cleaned);

  try {
    const parsed = JSON.parse(jsonCandidate || cleaned);
    // Validate required fields
    if (!parsed.action) {
      return { thought: parsed.thought || 'Missing action', action: 'fail', reason: 'Missing action field' };
    }
    if (parsed.action === 'code' && !parsed.code) {
      return { thought: parsed.thought || '', action: 'fail', reason: 'LLM returned action=code but no code field' };
    }
    return parsed;
  } catch {
    // If JSON parsing fails, try to extract code from the raw text as fallback
    console.warn('[Agent] Failed to parse JSON response, attempting code extraction fallback');
    const codeMatch = raw.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
    if (codeMatch) {
      return { thought: 'Fallback: extracted code from non-JSON response', action: 'code', code: codeMatch[1].trim() };
    }
    // Last resort: treat entire response as code if it looks like Playwright
    if (looksLikeStandalonePlaywrightCode(cleaned)) {
      return { thought: 'Fallback: treating raw response as code', action: 'code', code: cleaned };
    }
    return { thought: 'Failed to parse LLM response', action: 'fail', reason: `Unparseable response: ${raw.slice(0, 200)}` };
  }
}

function stripOuterCodeFence(raw) {
  const match = raw.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : raw;
}

function extractBalancedJsonObject(raw) {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const char = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }

  return null;
}

function looksLikeStandalonePlaywrightCode(raw) {
  return (
    !raw.includes('"action"') &&
    !raw.trim().startsWith('{') &&
    raw.includes('page.') &&
    raw.includes('await')
  );
}

/**
 * Strip markdown fences from LLM response to get raw code.
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripCodeFences(raw) {
  if (!raw) return '';
  // Remove ```javascript / ```js / ``` fences
  const match = raw.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  return raw.trim();
}

/**
 * Clean base64 image data to remove prefix and whitespace, supporting both String and Buffer types.
 */
function _cleanBase64Image(screenshotBase64) {
  if (!screenshotBase64) return null;
  let str = screenshotBase64;
  if (typeof screenshotBase64 !== 'string') {
    if (Buffer.isBuffer(screenshotBase64)) {
      str = screenshotBase64.toString('base64');
    } else {
      str = String(screenshotBase64);
    }
  }
  return str.replace(/^data:image\/[a-z]+;base64,/, '').replace(/\s/g, '');
}

