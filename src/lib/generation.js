const SYSTEM_PROMPT = `你是一個擁有十年社群媒體操盤經驗的品牌文案策略師。

你的任務：
1. 根據圖片與使用者補充描述，分析畫面中的場景、地標、氛圍、色調。
2. 為 Instagram、小紅書、Facebook、Threads 各自生成一篇高品質文案草稿。

【平台詳細規格 — 必須嚴格遵守】

▸ Instagram
  - 語氣：詩意、精緻、具強烈畫面感，像是故事的開頭。
  - 篇幅：2-4 句話 + 至少 8 個相關 hashtag（#標籤格式）。
  - 技巧：用第一人稱或疑問句引發共鳴；hashtag 獨立成一行。

▸ 小紅書（xhs）
  - 語氣：像閨蜜分享，生活化、有情緒價值，充滿細節。
  - 篇幅：3-5 句話 + 6-10 個 hashtag + 適量 emoji（每句 1-2 個）。
  - 技巧：以「這次去了⋯」「真的被驚艷到了」等口語化開頭。

▸ Facebook
  - 語氣：親和自然、敘事完整，像在跟朋友分享旅行故事。
  - 篇幅：3-6 句完整段落 + 3-5 個 hashtag。
  - 技巧：有起承轉合，提到讓人印象深刻的細節或感受。

▸ Threads
  - 語氣：超短、輕盈，像即時發出的碎念或一句讓人想按愛心的金句。
  - 篇幅：1-2 句話 + 2-3 個 hashtag。
  - 技巧：可用反差感、哲理感，或一個有趣的觀察。

【輸出規則】
- 只回傳 JSON，不要附帶任何 markdown 或說明文字。
- platforms 物件中的四個平台（instagram、xhs、facebook、threads）都必須填入非空的 content 字串。
- JSON 結構如下：
{
  "vision_insight": {
    "landmark": "場景地點（簡短）",
    "mood": "整體氛圍（2-4字）",
    "tone": "色調感受（2-4字）"
  },
  "platforms": {
    "instagram": { "content": "非空字串，含 hashtag" },
    "xhs": { "content": "非空字串，含 emoji 和 hashtag" },
    "facebook": { "content": "非空字串，含 hashtag" },
    "threads": { "content": "非空字串，含 hashtag" }
  }
}`;

function extractJsonBlock(rawText) {
  if (!rawText) return null;

  // 1. try direct parse
  const directParse = tryParseJson(rawText);
  if (directParse) return directParse;

  // 2. strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const stripped = tryParseJson(fenceMatch[1].trim());
    if (stripped) return stripped;
  }

  // 3. Scan for balanced curly brace blocks (great for inline code fences, multiple duplicates, or messy wrappers)
  const candidates = findBalancedJsonCandidates(rawText);
  for (const cand of candidates) {
    const parsed = tryParseJson(cand);
    // If it's a valid JSON and looks like our target object structure, return it
    if (parsed && (parsed.platforms || parsed.vision_insight)) {
      return parsed;
    }
  }

  // 4. greedy: first { to last }
  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const sliced = tryParseJson(rawText.slice(firstBrace, lastBrace + 1));
    if (sliced) return sliced;
  }

  return null;
}

function findBalancedJsonCandidates(rawText) {
  const candidates = [];
  let depth = 0;
  let startIdx = -1;

  for (let i = 0; i < rawText.length; i++) {
    const char = rawText[i];
    if (char === '{') {
      if (depth === 0) {
        startIdx = i;
      }
      depth++;
    } else if (char === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          candidates.push(rawText.slice(startIdx, i + 1));
        }
      }
    }
  }
  return candidates;
}

function parseMarkdownFallback(rawText) {
  if (!rawText) return null;

  const result = {
    vision_insight: {
      landmark: '',
      mood: '',
      tone: ''
    },
    platforms: {
      instagram: '',
      xhs: '',
      facebook: '',
      threads: ''
    }
  };

  // 提取視覺洞察（相容中文引導與冒號）
  const sceneMatch = rawText.match(/(?:場景|地點)(?:：|:)\s*([^\n\r]+)/);
  const moodMatch = rawText.match(/氛圍(?:：|:)\s*([^\n\r]+)/);
  const toneMatch = rawText.match(/色調(?:：|:)\s*([^\n\r]+)/);

  if (sceneMatch) result.vision_insight.landmark = sceneMatch[1].trim();
  if (moodMatch) result.vision_insight.mood = moodMatch[1].trim();
  if (toneMatch) result.vision_insight.tone = toneMatch[1].trim();

  const platforms = ['instagram', 'xhs', 'facebook', 'threads'];
  const displayNames = {
    instagram: ['Instagram', 'instagram', 'IG', 'ig'],
    xhs: ['小紅書', 'xhs', 'Xhs', 'XHS'],
    facebook: ['Facebook', 'facebook', 'FB', 'fb'],
    threads: ['Threads', 'threads']
  };

  for (const p of platforms) {
    const names = displayNames[p].join('|');
    const regex = new RegExp(`\\*\\*(?:${names})\\*\\*\\s*([\\s\\S]*?)(?=\\*\\*(?:Instagram|小紅書|Facebook|Threads|平台草稿|視覺洞察)\\*\\*|$)`, 'i');
    const match = rawText.match(regex);
    if (match) {
      result.platforms[p] = match[1].trim();
    }
  }

  // 只要有任何平台文案解析成功，即判定 fallback 成功
  const hasContent = Object.values(result.platforms).some(c => c.length > 0);
  return hasContent ? result : null;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getTextFromOpenAiResponse(response) {
  return response?.choices?.[0]?.message?.content ?? '';
}

function getTextFromAnthropicResponse(response) {
  const blocks = response?.content ?? [];
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function splitDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error('圖片格式錯誤，無法解析 data URL。');
  }

  return {
    mediaType: match[1],
    base64Data: match[2],
  };
}

export function buildGenerationRequest(config, { imageDataUrls, userContext }) {
  // support single string for backward-compat
  const urls = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls];
  // Most vision models only support one image per request; always use the first (primary) image.
  const primaryUrl = urls[0];
  const userPrompt = `使用者補充描述：${userContext || '無'}。\n請根據圖片與這段描述，輸出四平台草稿。`;

  if (config.protocol === 'anthropic') {
    const { mediaType, base64Data } = splitDataUrl(primaryUrl);

    return {
      url: `${config.baseUrl}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      data: {
        model: config.model,
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
            ],
          },
        ],
      },
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: userPrompt
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  return {
    url: `${config.baseUrl}/chat/completions`,
    headers,
    data: {
      model: config.model,
      response_format: { type: 'json_object' },
      max_tokens: 3000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: primaryUrl } },
          ],
        },
      ],
    },
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: userPrompt
  };
}

export function buildSinglePlatformGenerationRequest(config, platform, { imageDataUrls, userContext, currentContent }) {
  const urls = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls];
  const primaryUrl = urls[0];
  
  const platformSpecs = {
    instagram: `▸ Instagram
  - 語氣：詩意、精緻、具強烈畫面感，像是故事的開頭。
  - 篇幅：2-4 句話 + 至少 8 個相關 hashtag（#標籤格式）。
  - 技巧：用第一人稱或疑問句引發共鳴；hashtag 獨立成一行。`,
    xhs: `▸ 小紅書（xhs）
  - 語氣：像閨蜜分享，生活化、有情緒價值，充滿細節。
  - 篇幅：3-5 句話 + 6-10 個 hashtag + 適量 emoji（每句 1-2 個）。
  - 技巧：以「這次去了⋯」「真的被驚艷到了」等口語化開頭。`,
    facebook: `▸ Facebook
  - 語氣：親和自然、敘事完整，像在跟朋友分享旅行故事。
  - 篇幅：3-6 句完整段落 + 3-5 個 hashtag。
  - 技巧：有起承轉合，提到讓人印象深刻的細節或感受。`,
    threads: `▸ Threads
  - 語氣：超短、輕盈，像即時發出的碎念或一句讓人想按愛心的金句。
  - 篇幅：1-2 句話 + 2-3 個 hashtag。
  - 技巧：可用反差感、哲理感，或一個有趣的觀察。`
  };

  const platformNameMap = {
    instagram: 'Instagram',
    xhs: '小紅書',
    facebook: 'Facebook',
    threads: 'Threads'
  };

  const spec = platformSpecs[platform] || '';
  const name = platformNameMap[platform] || platform;

  const systemPrompt = `你是一個擁有十年社群媒體操盤經驗的品牌文案策略師。
你的任務是「只」為 ${name} 平台生成一篇高品質、吸引人的社群文案草稿。

【${name} 平台詳細規格 — 必須嚴格遵守】
${spec}

${currentContent ? `【目前已生成的文案（請提供不同角度的全新創意，避免生成與此完全重複的內容）】\n${currentContent}\n` : ''}

【輸出規則】
- 只回傳 JSON，不要附帶 any markdown 或說明文字。
- JSON 結構如下，請確保包含 content 欄位，且其值為非空字串：
{
  "content": "文案內容，需包含對應的 emoji 或 hashtag"
}`;

  const userPrompt = `使用者補充描述：${userContext || '無'}。\n請根據圖片與這段描述，為 ${name} 重新生成一份最符合其特性、更加精采的文案。`;

  if (config.protocol === 'anthropic') {
    const { mediaType, base64Data } = splitDataUrl(primaryUrl);

    return {
      url: `${config.baseUrl}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      data: {
        model: config.model,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
            ],
          },
        ],
      },
      systemPrompt,
      userPrompt
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  return {
    url: `${config.baseUrl}/chat/completions`,
    headers,
    data: {
      model: config.model,
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: primaryUrl } },
          ],
        },
      ],
    },
    systemPrompt,
    userPrompt
  };
}

export function normalizeSinglePlatformResponse(config, response) {
  const rawText = config.protocol === 'anthropic'
    ? getTextFromAnthropicResponse(response)
    : getTextFromOpenAiResponse(response);

  console.log('[single generation] raw model response:', rawText);

  let parsed = extractJsonBlock(rawText);

  if (!parsed) {
    try {
      const candidates = findBalancedJsonCandidates(rawText);
      for (const cand of candidates) {
        const p = tryParseJson(cand);
        if (p && (p.content || p.text)) {
          parsed = p;
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!parsed) {
    if (rawText && rawText.trim()) {
      return rawText.trim();
    }
    throw new Error('模型沒有回傳可解析的 JSON 內容。');
  }

  // Handle nested object structure if model ignored single-platform instructions
  if (parsed.platforms) {
    const platformKeys = Object.keys(parsed.platforms);
    if (platformKeys.length > 0) {
      const firstPlatform = parsed.platforms[platformKeys[0]];
      return typeof firstPlatform === 'string' ? firstPlatform : (firstPlatform.content || '');
    }
  }

  return parsed.content || parsed.text || rawText || '';
}

export function normalizeGenerationResponse(config, response) {
  const rawText = config.protocol === 'anthropic'
    ? getTextFromAnthropicResponse(response)
    : getTextFromOpenAiResponse(response);

  console.log('[generation] raw model response:', rawText);

  let parsed = extractJsonBlock(rawText);

  if (!parsed) {
    console.warn('[generation] JSON extraction failed, trying Markdown parser fallback...');
    parsed = parseMarkdownFallback(rawText);
  }

  if (!parsed) {
    throw new Error('模型沒有回傳可解析的 JSON。');
  }

  // model sometimes returns a plain string instead of { content: "..." }
  const extractContent = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    return val.content || '';
  };

  return {
    analyzer: {
      landmark: parsed?.vision_insight?.landmark || '',
      mood: parsed?.vision_insight?.mood || '',
      tone: parsed?.vision_insight?.tone || '',
    },
    drafts: {
      instagram: extractContent(parsed?.platforms?.instagram),
      xhs: extractContent(parsed?.platforms?.xhs),
      facebook: extractContent(parsed?.platforms?.facebook),
      threads: extractContent(parsed?.platforms?.threads),
    },
  };
}

export function appendSignature(content, enabled) {
  const signature = '本篇貼文由 social media agent 產生';
  if (!content) return '';
  
  // 移除所有可能存在的 signature (包含前面可能的換行符)
  const cleanContent = content.replace(new RegExp(`\\s*${signature}\\s*$`, 'g'), '');
  
  if (enabled) {
    return `${cleanContent}\n\n${signature}`;
  }
  return cleanContent;
}