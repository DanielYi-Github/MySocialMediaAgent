/**
 * Backend LLM client for Self-Healing Agent.
 *
 * Supports OpenAI-compatible and Anthropic protocols.
 * Uses axios (already a project dependency) for HTTP calls.
 */

import axios from 'axios';
import { HEAL_SYSTEM_PROMPT } from './prompts.js';

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

  if (protocol === 'anthropic') {
    return _callAnthropicProtocol({ cleanBase, apiKey, model, userPrompt, screenshotBase64 });
  }

  // Handles OpenAI, Gemini (OpenAI-compat), Ollama, NVIDIA NIM, any custom endpoint
  return _callOpenAICompatible({ cleanBase, apiKey, model, userPrompt, screenshotBase64 });
}

async function _callOpenAICompatible({ cleanBase, apiKey, model, userPrompt, screenshotBase64 }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const userContent = screenshotBase64
    ? [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
      ]
    : userPrompt;

  const res = await axios.post(
    `${cleanBase}/chat/completions`,
    {
      model,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: HEAL_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    },
    { headers, timeout: 30000 },
  );

  return res.data?.choices?.[0]?.message?.content ?? '';
}

async function _callAnthropicProtocol({ cleanBase, apiKey, model, userPrompt, screenshotBase64 }) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  const userContent = screenshotBase64
    ? [
        { type: 'text', text: userPrompt },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 } },
      ]
    : [{ type: 'text', text: userPrompt }];

  const res = await axios.post(
    `${cleanBase}/messages`,
    {
      model,
      max_tokens: 1000,
      system: HEAL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    },
    { headers, timeout: 30000 },
  );

  const blocks = res.data?.content ?? [];
  return blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
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
