import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Palette,
  Send,
  Settings,
  Sparkles,
  Terminal,
  Upload,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import axios from 'axios';
import ConfigDrawer from './components/ConfigDrawer';
import {
  appendSignature,
  buildGenerationRequest,
  buildSinglePlatformGenerationRequest,
  normalizeGenerationResponse,
  normalizeSinglePlatformResponse,
} from './lib/generation';
import {
  getEffectiveProviderCapabilities,
  getOptionalReadyLlmConfig,
  getReadyLlmConfig,
  readStoredCapabilityProbe,
  readStoredLlmConfig,
} from './lib/providers';
import {
  classifyAssets,
  getPlatformPublishSupport,
  postToFacebook,
  postToFacebookPersonal,
  postToInstagram,
  postToInstagramBrowser,
  postToThreads,
  postToXhs,
} from './lib/publishing';

const STEPS = [
  { id: 1, title: '設定 LLM', description: '確認模型與媒體能力' },
  { id: 2, title: '上傳素材', description: '加入圖片或影片並指定主素材' },
  { id: 3, title: '生成草稿', description: '根據主素材產出四平台文案' },
  { id: 4, title: '審核確認', description: '逐平台編修、確認與複製' },
  { id: 5, title: '發布', description: '依媒體限制選擇可行發布方式' },
];

const PLATFORM_LABELS = {
  instagram: 'Instagram',
  xhs: '小紅書',
  facebook: 'Facebook',
  threads: 'Threads',
};

const EMPTY_RESULTS = {
  mediaInsight: { landmark: '', mood: '', tone: '' },
  drafts: { instagram: '', xhs: '', facebook: '', threads: '' },
};

function loadPublishConfig() {
  try {
    return JSON.parse(localStorage.getItem('publish_config') || '{}');
  } catch {
    return {};
  }
}

function formatDuration(durationMs) {
  if (!durationMs) return '';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = `${totalSeconds % 60}`.padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function inferAssetKindLabel(media) {
  if (media.hasMixedMedia) return '混合素材';
  if (media.isSingleVideo) return '單支影片';
  if (media.isImageOnly) return media.imageCount > 1 ? '圖片組' : '單張圖片';
  return '未選擇素材';
}

function getWebwrightConfigForPlatform(platform, publishConfig = {}) {
  if (platform === 'xhs') {
    return {
      visible: true,
      field: 'forceWebwright_xhs',
      label: '小紅書',
      detail: '可切換使用 AI Webwright，或沿用原本固定的 Playwright 腳本。',
    };
  }

  if (platform === 'facebook' && (publishConfig.fbAccountType || 'business') === 'personal') {
    return {
      visible: true,
      field: 'forceWebwright_facebook',
      label: 'Facebook 個人帳號',
      detail: '可切換使用 AI Webwright，或沿用原本固定的 Playwright 腳本。',
    };
  }

  if (platform === 'instagram' && (publishConfig.igAccountType || 'business') === 'personal') {
    return {
      visible: true,
      field: 'forceWebwright_instagram',
      label: 'Instagram 個人帳號',
      detail: '可切換使用 AI Webwright，或沿用原本固定的 Playwright 腳本。',
    };
  }

  return { visible: false };
}

function getAssetTypeFromMime(mime = '') {
  return mime.startsWith('video/') ? 'video' : 'image';
}

function isLocalModelBaseUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

function extractRequestErrorMessage(err) {
  const responseData = err.response?.data;
  if (responseData?.error?.message) return responseData.error.message;
  if (typeof responseData?.error === 'string') return responseData.error;
  if (typeof responseData?.message === 'string') return responseData.message;
  if (typeof responseData?.detail === 'string') return responseData.detail;
  if (Array.isArray(responseData?.errors) && responseData.errors.length > 0) {
    return responseData.errors.map((item) => item?.message || item?.detail || JSON.stringify(item)).join('; ');
  }
  if (responseData && typeof responseData === 'object') return JSON.stringify(responseData);
  return err.message || '未知錯誤';
}

function deepCloneRequest(request) {
  return {
    ...request,
    headers: request.headers ? { ...request.headers } : request.headers,
    data: request.data ? JSON.parse(JSON.stringify(request.data)) : request.data,
  };
}

function removeResponseFormat(request) {
  const nextRequest = deepCloneRequest(request);
  if (nextRequest.data && typeof nextRequest.data === 'object') {
    delete nextRequest.data.response_format;
  }
  return nextRequest;
}

function replaceOpenAiVideoPart(request, buildPart) {
  const nextRequest = deepCloneRequest(request);
  const userMessage = nextRequest.data?.messages?.find((message) => message.role === 'user');
  if (!Array.isArray(userMessage?.content)) return null;

  const nextContent = userMessage.content.map((part) => {
    if (part?.type === 'video_url' || part?.type === 'input_video') {
      return buildPart(part);
    }
    return part;
  });

  const hasVideoPart = nextContent.some((part) => part?.type === 'video_url' || part?.type === 'input_video');
  if (!hasVideoPart) return null;

  userMessage.content = nextContent;
  return nextRequest;
}

function getVideoVariantSignature(request) {
  const userMessage = request.data?.messages?.find((message) => message.role === 'user');
  const videoPart = Array.isArray(userMessage?.content)
    ? userMessage.content.find((part) => part?.type === 'video_url' || part?.type === 'input_video')
    : null;

  if (!videoPart) {
    return `no-video|rf:${Boolean(request.data?.response_format)}`;
  }

  const payload = videoPart.type === 'video_url'
    ? videoPart.video_url
    : videoPart.input_video ?? videoPart.video_url;
  const payloadShape = typeof payload === 'string'
    ? 'string'
    : payload?.url
      ? 'object-url'
      : typeof payload;

  return `${videoPart.type}|${payloadShape}|rf:${Boolean(request.data?.response_format)}`;
}

function buildOpenAiVideoRetryVariants(request, { allowResponseFormatFallback = false } = {}) {
  const variants = [];
  const seen = new Set();

  const pushVariant = (label, candidate) => {
    if (!candidate) return;
    const signature = `${label}|${getVideoVariantSignature(candidate)}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    variants.push({ label, request: candidate });
  };

  pushVariant('openai-video_url-object', request);

  if (allowResponseFormatFallback) {
    pushVariant('openai-video_url-object-no-response-format', removeResponseFormat(request));
  }

  const stringVideoUrl = replaceOpenAiVideoPart(request, (part) => {
    const url = typeof part.video_url === 'string'
      ? part.video_url
      : part.video_url?.url || part.input_video?.url || part.input_video || '';
    return { type: 'video_url', video_url: url };
  });
  pushVariant('openai-video_url-string', stringVideoUrl);
  if (allowResponseFormatFallback && stringVideoUrl) {
    pushVariant('openai-video_url-string-no-response-format', removeResponseFormat(stringVideoUrl));
  }

  const inputVideoString = replaceOpenAiVideoPart(request, (part) => {
    const url = typeof part.video_url === 'string'
      ? part.video_url
      : part.video_url?.url || part.input_video?.url || part.input_video || '';
    return { type: 'input_video', input_video: url };
  });
  pushVariant('openai-input_video-string', inputVideoString);
  if (allowResponseFormatFallback && inputVideoString) {
    pushVariant('openai-input_video-string-no-response-format', removeResponseFormat(inputVideoString));
  }

  const inputVideoObject = replaceOpenAiVideoPart(request, (part) => {
    const url = typeof part.video_url === 'string'
      ? part.video_url
      : part.video_url?.url || part.input_video?.url || part.input_video || '';
    return { type: 'input_video', input_video: { url } };
  });
  pushVariant('openai-input_video-object', inputVideoObject);
  if (allowResponseFormatFallback && inputVideoObject) {
    pushVariant('openai-input_video-object-no-response-format', removeResponseFormat(inputVideoObject));
  }

  return variants;
}

function isOpenAiVideoTransportMismatch(errorMessage) {
  return String(errorMessage || '').includes('untagged enum OpenAIContent');
}

function createFrameAssetFromDataUrl(videoAsset, frameDataUrl, index, totalCount) {
  return {
    id: `${videoAsset.id}-frame-${index + 1}`,
    type: 'image',
    mime: 'image/jpeg',
    sourceUrl: frameDataUrl,
    thumbnailUrl: frameDataUrl,
    previewUrl: frameDataUrl,
    name: `${videoAsset.name || 'video'}-frame-${index + 1}-of-${totalCount}.jpg`,
    isPrimary: index === 0,
  };
}

async function extractVideoFrameAssets(videoAsset, frameCount = 6) {
  const src = videoAsset.previewUrl || videoAsset.sourceUrl;
  if (!src) {
    throw new Error('無法讀取影片內容來抽取關鍵畫面。');
  }

  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = src;

  await new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('影片關鍵畫面抽取失敗，無法載入影片。'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!duration || duration <= 0) {
    throw new Error('影片長度異常，無法抽取關鍵畫面。');
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('瀏覽器無法建立影片分析畫布。');
  }

  const frames = [];
  const sampleCount = Math.max(3, Math.min(frameCount, 8));
  const timeSlots = Array.from({ length: sampleCount }, (_, index) => {
    const ratio = (index + 1) / (sampleCount + 1);
    return Math.min(duration - 0.05, Math.max(0, duration * ratio));
  });

  for (const timestamp of timeSlots) {
    await new Promise((resolve, reject) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('影片關鍵畫面抽取失敗，seek 過程發生錯誤。'));
      };
      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      video.currentTime = timestamp;
    });

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL('image/jpeg', 0.82));
  }

  return frames.map((frameDataUrl, index) => createFrameAssetFromDataUrl(videoAsset, frameDataUrl, index, frames.length));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
    const previewUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : undefined;
      URL.revokeObjectURL(previewUrl);
      resolve(durationMs);
    };
    video.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      resolve(undefined);
    };
    video.src = previewUrl;
  });
}

async function fileToAsset(file, isPrimary) {
  const type = getAssetTypeFromMime(file.type);
  const sourceUrl = await fileToDataUrl(file);
  const previewUrl = URL.createObjectURL(file);
  const durationMs = type === 'video' ? await getVideoDuration(file) : undefined;

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    mime: file.type || (type === 'video' ? 'video/mp4' : 'image/jpeg'),
    sourceUrl,
    previewUrl,
    thumbnailUrl: previewUrl,
    durationMs,
    name: file.name,
    isPrimary,
  };
}

function getPlatformStatus(platform, draftMeta, confirmed) {
  if (confirmed[platform]) return '已確認';
  if (draftMeta[platform]?.edited) return '已編輯';
  if (draftMeta[platform]?.generated) return '已生成';
  return '未生成';
}

function App() {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [configSnapshot, setConfigSnapshot] = useState(() => readStoredLlmConfig(localStorage));
  const [probeSnapshot, setProbeSnapshot] = useState(() => readStoredCapabilityProbe(localStorage));
  const [assets, setAssets] = useState([]);
  const [context, setContext] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [platformLoading, setPlatformLoading] = useState({
    instagram: false,
    xhs: false,
    facebook: false,
    threads: false,
  });
  const [activePlatform, setActivePlatform] = useState('instagram');
  const [confirmed, setConfirmed] = useState({
    instagram: false,
    xhs: false,
    facebook: false,
    threads: false,
  });
  const [draftMeta, setDraftMeta] = useState({
    instagram: { generated: false, edited: false },
    xhs: { generated: false, edited: false },
    facebook: { generated: false, edited: false },
    threads: { generated: false, edited: false },
  });
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [publishStatus, setPublishStatus] = useState({});
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishConfig, setPublishConfig] = useState(loadPublishConfig);
  const [promptPreview, setPromptPreview] = useState({
    isOpen: false,
    scope: 'all',
    platform: null,
    systemPrompt: '',
    userPrompt: '',
  });
  const [includeSignature, setIncludeSignature] = useState(() => {
    const saved = localStorage.getItem('include_signature');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const objectUrlsRef = useRef(new Set());

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  const llmConfigDraft = configSnapshot;
  const providerCapabilities = useMemo(
    () => getEffectiveProviderCapabilities(llmConfigDraft, probeSnapshot),
    [llmConfigDraft, probeSnapshot],
  );
  const safeReadyConfig = getOptionalReadyLlmConfig(localStorage, { requireApiKey: false });
  const primaryAsset = useMemo(
    () => assets.find((asset) => asset.isPrimary) || assets[0] || null,
    [assets],
  );
  const mediaSummary = useMemo(() => classifyAssets(assets), [assets]);
  const confirmedPlatforms = useMemo(
    () => Object.entries(confirmed).filter(([, value]) => value).map(([platform]) => platform),
    [confirmed],
  );
  const webwrightOptions = useMemo(
    () => confirmedPlatforms
      .map((platform) => ({ platform, ...getWebwrightConfigForPlatform(platform, publishConfig) }))
      .filter((item) => item.visible),
    [confirmedPlatforms, publishConfig],
  );

  const stepStatus = useMemo(() => {
    const canConfigure = Boolean(safeReadyConfig);
    const canUpload = assets.length > 0 && primaryAsset;
    const videoBlocked = mediaSummary.videoCount > 0 && !providerCapabilities.supportsVideo;
    const hasDrafts = Object.values(draftMeta).some((meta) => meta.generated);
    const canReview = hasDrafts;
    const canPublish = confirmedPlatforms.length > 0;

    return {
      1: { complete: canConfigure },
      2: { complete: canUpload },
      3: { complete: canReview, blockedReason: videoBlocked ? '目前這個模型尚未確認支援影片理解；請先完成測試連線能力偵測，或改用支援影片的模型。' : '' },
      4: { complete: canPublish },
      5: { complete: false },
    };
  }, [assets.length, confirmedPlatforms.length, draftMeta, mediaSummary.videoCount, primaryAsset, providerCapabilities.supportsVideo, safeReadyConfig]);

  const handleCredsChange = useCallback((field, value) => {
    setPublishConfig((prev) => {
      const next = { ...prev, [field]: value };
      localStorage.setItem('publish_config', JSON.stringify(next));
      return next;
    });
  }, []);

  const resolveLlmConfig = useCallback(({ requireApiKey = true } = {}) => {
    try {
      return getReadyLlmConfig(localStorage, { requireApiKey });
    } catch (err) {
      alert(err.message || 'LLM 設定有誤');
      setIsConfigOpen(true);
      return null;
    }
  }, []);

  const markDraftGenerated = useCallback((drafts, isEdited = false) => {
    setDraftMeta((prev) => {
      const next = { ...prev };
      Object.keys(drafts).forEach((platform) => {
        if (drafts[platform]) {
          next[platform] = { generated: true, edited: isEdited };
        }
      });
      return next;
    });
  }, []);

  const handleToggleSignature = useCallback((checked) => {
    setIncludeSignature(checked);
    localStorage.setItem('include_signature', JSON.stringify(checked));
    setResults((prev) => ({
      ...prev,
      drafts: Object.fromEntries(
        Object.entries(prev.drafts).map(([platform, content]) => [platform, appendSignature(content, checked)]),
      ),
    }));
  }, []);

  const handleAssetChange = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 10 - assets.length));
    if (files.length === 0) return;

    const createdAssets = [];
    for (let index = 0; index < files.length; index += 1) {
      const asset = await fileToAsset(files[index], assets.length === 0 && index === 0);
      objectUrlsRef.current.add(asset.previewUrl);
      createdAssets.push(asset);
    }

    setAssets((prev) => {
      const next = [...prev, ...createdAssets];
      if (!next.some((asset) => asset.isPrimary) && next[0]) next[0].isPrimary = true;
      return next;
    });
    setCurrentStep(Math.max(currentStep, 2));
    event.target.value = '';
  };

  const removeAsset = (assetId) => {
    setAssets((prev) => {
      const removed = prev.find((asset) => asset.id === assetId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
        objectUrlsRef.current.delete(removed.previewUrl);
      }
      const next = prev.filter((asset) => asset.id !== assetId);
      if (next.length > 0 && !next.some((asset) => asset.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  };

  const setPrimaryAsset = (assetId) => {
    setAssets((prev) => prev.map((asset) => ({ ...asset, isPrimary: asset.id === assetId })));
  };

  const ensurePrimaryAssetRequestReady = useCallback(async (config) => {
    if (!primaryAsset) return { assets, primaryAsset: null };
    if (primaryAsset.type !== 'video') return { assets, primaryAsset };
    if (config.protocol === 'gemini') return { assets, primaryAsset };
    if (!primaryAsset.sourceUrl.startsWith('data:')) return { assets, primaryAsset };

    if (!isLocalModelBaseUrl(config.baseUrl)) {
      throw new Error('目前影片素材對非本機 OpenAI-compatible 端點需要可被上游服務讀取的 URL；本系統尚未接上這種影片傳輸方式。');
    }

    if (primaryAsset.transportUrl) {
      const preparedAsset = { ...primaryAsset, sourceUrl: primaryAsset.transportUrl };
      const preparedAssets = assets.map((asset) => asset.id === primaryAsset.id ? preparedAsset : asset);
      return { assets: preparedAssets, primaryAsset: preparedAsset };
    }

    const response = await axios.post('http://localhost:3001/api/media-cache', {
      dataUrl: primaryAsset.sourceUrl,
      mime: primaryAsset.mime,
      fileName: primaryAsset.name,
    });
    const transportUrl = response.data?.url;
    if (!transportUrl) {
      throw new Error('建立影片暫存 URL 失敗。');
    }

    setAssets((prev) => prev.map((asset) => (
      asset.id === primaryAsset.id
        ? { ...asset, transportUrl }
        : asset
    )));

    const preparedAsset = { ...primaryAsset, transportUrl, sourceUrl: transportUrl };
    const preparedAssets = assets.map((asset) => asset.id === primaryAsset.id ? preparedAsset : asset);
    return { assets: preparedAssets, primaryAsset: preparedAsset };
  }, [assets, primaryAsset]);

  const getVideoFrameFallbackAssets = useCallback(async () => {
    if (!primaryAsset || primaryAsset.type !== 'video') {
      throw new Error('目前沒有可供多幀分析的主影片。');
    }
    if (Array.isArray(primaryAsset.analysisFrameAssets) && primaryAsset.analysisFrameAssets.length > 0) {
      return primaryAsset.analysisFrameAssets;
    }

    const frameAssets = await extractVideoFrameAssets(primaryAsset);
    setAssets((prev) => prev.map((asset) => (
      asset.id === primaryAsset.id
        ? { ...asset, analysisFrameAssets: frameAssets }
        : asset
    )));
    return frameAssets;
  }, [primaryAsset]);

  const postGenerationProxyRequest = useCallback(async (request, { allowResponseFormatFallback = false } = {}) => {
    const isOpenAiVideoRequest = request.url?.includes('/chat/completions')
      && Array.isArray(request.data?.messages)
      && request.data.messages.some((message) => Array.isArray(message?.content)
        && message.content.some((part) => part?.type === 'video_url' || part?.type === 'input_video'));

    if (!isOpenAiVideoRequest) {
      try {
        return await axios.post('http://localhost:3001/api/llm/proxy', {
          url: request.url,
          headers: request.headers,
          data: request.data,
        });
      } catch (err) {
        const shouldRetry = allowResponseFormatFallback
          && err.response?.status === 400
          && Boolean(request.data?.response_format);

        if (!shouldRetry) throw err;

        const retryRequest = removeResponseFormat(request);
        return axios.post('http://localhost:3001/api/llm/proxy', {
          url: retryRequest.url,
          headers: retryRequest.headers,
          data: retryRequest.data,
        });
      }
    }

    const variants = buildOpenAiVideoRetryVariants(request, { allowResponseFormatFallback });
    const failures = [];

    for (const variant of variants) {
      try {
        return await axios.post('http://localhost:3001/api/llm/proxy', {
          url: variant.request.url,
          headers: variant.request.headers,
          data: variant.request.data,
        });
      } catch (err) {
        const message = extractRequestErrorMessage(err);
        failures.push(`${variant.label}: ${message}`);
        if (err.response?.status !== 400) {
          throw err;
        }
      }
    }

    throw new Error(`影片請求格式自動重試皆失敗。已嘗試：${failures.join(' ｜ ')}`);
  }, []);

  const tryVideoFrameFallbackGeneration = useCallback(async ({
    config,
    overrides,
    platform = null,
    currentContent = '',
  }) => {
    const frameAssets = await getVideoFrameFallbackAssets();
    const fallbackOptions = {
      capabilities: {
        ...getEffectiveProviderCapabilities(config, probeSnapshot),
        supportsImage: true,
        supportsVideo: false,
      },
      analysisMode: 'video_frames',
    };

    const request = platform
      ? buildSinglePlatformGenerationRequest(config, platform, {
        assets: frameAssets,
        userContext: context,
        currentContent,
        primaryAssetId: frameAssets[0]?.id,
      }, fallbackOptions)
      : buildGenerationRequest(config, {
        assets: frameAssets,
        userContext: context,
        primaryAssetId: frameAssets[0]?.id,
      }, fallbackOptions);

    if (overrides?.systemPrompt || overrides?.userPrompt) {
      if (config.protocol === 'anthropic') {
        if (overrides.systemPrompt) request.data.system = overrides.systemPrompt;
        if (overrides.userPrompt) request.data.messages[0].content[0].text = overrides.userPrompt;
      } else if (config.protocol === 'gemini') {
        if (platform) {
          request.data.contents[0].parts[frameAssets.length].text = [overrides.systemPrompt, overrides.userPrompt].filter(Boolean).join('\n\n');
        } else {
          request.data.contents[0].parts[frameAssets.length].text = [overrides.systemPrompt, overrides.userPrompt].filter(Boolean).join('\n\n');
        }
      } else {
        if (overrides.systemPrompt) request.data.messages[0].content = overrides.systemPrompt;
        if (overrides.userPrompt) request.data.messages[1].content[0].text = overrides.userPrompt;
      }
    }

    const response = await postGenerationProxyRequest(request, {
      allowResponseFormatFallback: false,
    });
    setAnalysisNotice('目前這個模型端點不接受影片直送；系統已改用多個關鍵畫面進行影片文案分析。');
    return response;
  }, [context, getVideoFrameFallbackAssets, postGenerationProxyRequest, probeSnapshot]);

  const generateContent = async (overrides = null) => {
    const config = resolveLlmConfig();
    if (!config) return;
    if (!primaryAsset) {
      alert('請先上傳素材。');
      return;
    }
    if (mediaSummary.videoCount > 0 && !getEffectiveProviderCapabilities(config, probeSnapshot).supportsVideo) {
      alert('目前這個模型不支援影片理解，請先完成測試連線或改用支援影片的模型。');
      setCurrentStep(1);
      return;
    }

    setIsLoading(true);
    setAnalysisNotice('');
    try {
      const prepared = await ensurePrimaryAssetRequestReady(config);
      const request = buildGenerationRequest(config, {
        assets: prepared.assets,
        userContext: context,
        primaryAssetId: prepared.primaryAsset?.id || primaryAsset.id,
      }, {
        capabilities: getEffectiveProviderCapabilities(config, probeSnapshot),
      });

      if (overrides?.systemPrompt || overrides?.userPrompt) {
        if (config.protocol === 'anthropic') {
          if (overrides.systemPrompt) request.data.system = overrides.systemPrompt;
          if (overrides.userPrompt) request.data.messages[0].content[0].text = overrides.userPrompt;
        } else if (config.protocol === 'gemini') {
          if (overrides.systemPrompt || overrides.userPrompt) {
            request.data.contents[0].parts[1].text = [overrides.systemPrompt, overrides.userPrompt].filter(Boolean).join('\n\n');
          }
        } else {
          if (overrides.systemPrompt) request.data.messages[0].content = overrides.systemPrompt;
          if (overrides.userPrompt) request.data.messages[1].content[0].text = overrides.userPrompt;
        }
      }

      let response;
      try {
        response = await postGenerationProxyRequest(request, {
          allowResponseFormatFallback: prepared.primaryAsset?.type === 'video' && config.protocol === 'openai',
        });
      } catch (err) {
        const rawMsg = extractRequestErrorMessage(err);
        if (
          prepared.primaryAsset?.type === 'video'
          && config.protocol === 'openai'
          && isOpenAiVideoTransportMismatch(rawMsg)
        ) {
          response = await tryVideoFrameFallbackGeneration({ config, overrides });
        } else {
          throw err;
        }
      }

      const rawRes = normalizeGenerationResponse(config, response.data);
      const drafts = Object.fromEntries(
        Object.entries(rawRes.drafts).map(([platform, content]) => [platform, includeSignature ? appendSignature(content, true) : content]),
      );

      setResults({
        mediaInsight: rawRes.mediaInsight || rawRes.analyzer,
        drafts,
      });
      markDraftGenerated(drafts);
      setCurrentStep(4);
    } catch (err) {
      const rawMsg = extractRequestErrorMessage(err);
      alert(`草稿生成失敗：${rawMsg}`);
    } finally {
      setIsLoading(false);
    }
  };

  const generateSinglePlatformContent = async (platform, overrides = null) => {
    const config = resolveLlmConfig();
    if (!config || !primaryAsset) return;

    setPlatformLoading((prev) => ({ ...prev, [platform]: true }));
    setAnalysisNotice('');
    try {
      const prepared = await ensurePrimaryAssetRequestReady(config);
      const request = buildSinglePlatformGenerationRequest(config, platform, {
        assets: prepared.assets,
        userContext: context,
        currentContent: results.drafts[platform],
        primaryAssetId: prepared.primaryAsset?.id || primaryAsset.id,
      }, {
        capabilities: getEffectiveProviderCapabilities(config, probeSnapshot),
      });

      if (overrides?.systemPrompt || overrides?.userPrompt) {
        if (config.protocol === 'anthropic') {
          if (overrides.systemPrompt) request.data.system = overrides.systemPrompt;
          if (overrides.userPrompt) request.data.messages[0].content[0].text = overrides.userPrompt;
        } else if (config.protocol === 'gemini') {
          request.data.contents[0].parts[1].text = [overrides.systemPrompt, overrides.userPrompt].filter(Boolean).join('\n\n');
        } else {
          if (overrides.systemPrompt) request.data.messages[0].content = overrides.systemPrompt;
          if (overrides.userPrompt) request.data.messages[1].content[0].text = overrides.userPrompt;
        }
      }

      let response;
      try {
        response = await postGenerationProxyRequest(request, {
          allowResponseFormatFallback: prepared.primaryAsset?.type === 'video' && config.protocol === 'openai',
        });
      } catch (err) {
        const rawMsg = extractRequestErrorMessage(err);
        if (
          prepared.primaryAsset?.type === 'video'
          && config.protocol === 'openai'
          && isOpenAiVideoTransportMismatch(rawMsg)
        ) {
          response = await tryVideoFrameFallbackGeneration({
            config,
            overrides,
            platform,
            currentContent: results.drafts[platform],
          });
        } else {
          throw err;
        }
      }

      const nextContent = includeSignature
        ? appendSignature(normalizeSinglePlatformResponse(config, response.data), true)
        : normalizeSinglePlatformResponse(config, response.data);

      setResults((prev) => ({
        ...prev,
        drafts: { ...prev.drafts, [platform]: nextContent },
      }));
      setDraftMeta((prev) => ({ ...prev, [platform]: { generated: true, edited: false } }));
    } catch (err) {
      const rawMsg = extractRequestErrorMessage(err);
      alert(`${PLATFORM_LABELS[platform]} 重新生成失敗：${rawMsg}`);
    } finally {
      setPlatformLoading((prev) => ({ ...prev, [platform]: false }));
    }
  };

  const openPromptPreview = (scope, platform = null) => {
    if (!primaryAsset) {
      alert('請先上傳素材。');
      return;
    }
    const config = resolveLlmConfig({ requireApiKey: false });
    if (!config) return;

    const request = scope === 'all'
      ? buildGenerationRequest(config, { assets, userContext: context, primaryAssetId: primaryAsset.id }, {
        capabilities: getEffectiveProviderCapabilities(config, probeSnapshot),
      })
      : buildSinglePlatformGenerationRequest(config, platform, {
        assets,
        userContext: context,
        currentContent: results.drafts[platform],
        primaryAssetId: primaryAsset.id,
      }, {
        capabilities: getEffectiveProviderCapabilities(config, probeSnapshot),
      });

    setPromptPreview({
      isOpen: true,
      scope,
      platform,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
    });
  };

  const applyPromptPreview = async () => {
    const overrides = {
      systemPrompt: promptPreview.systemPrompt,
      userPrompt: promptPreview.userPrompt,
    };
    setPromptPreview((prev) => ({ ...prev, isOpen: false }));
    if (promptPreview.scope === 'all') {
      await generateContent(overrides);
      return;
    }
    await generateSinglePlatformContent(promptPreview.platform, overrides);
  };

  const handleEditDraft = (platform, value) => {
    setResults((prev) => ({
      ...prev,
      drafts: { ...prev.drafts, [platform]: value },
    }));
    setDraftMeta((prev) => ({
      ...prev,
      [platform]: { generated: true, edited: true },
    }));
    if (confirmed[platform]) {
      setConfirmed((prev) => ({ ...prev, [platform]: false }));
    }
  };

  const toggleConfirm = (platform) => {
    setConfirmed((prev) => ({ ...prev, [platform]: !prev[platform] }));
    setPublishStatus((prev) => {
      const next = { ...prev };
      delete next[platform];
      return next;
    });
    setCurrentStep(5);
  };

  const handlePublish = async () => {
    const llmConfig = getOptionalReadyLlmConfig(localStorage);
    setIsPublishing(true);

    for (const platform of confirmedPlatforms) {
      const support = getPlatformPublishSupport(platform, assets, publishConfig);
      if (!support.canPublish) {
        setPublishStatus((prev) => ({
          ...prev,
          [platform]: { status: 'blocked', message: support.reason },
        }));
        continue;
      }

      setPublishStatus((prev) => ({ ...prev, [platform]: { status: 'loading', message: support.reason } }));

      try {
        if (platform === 'facebook') {
          const fbType = publishConfig.fbAccountType || 'business';
          if (fbType === 'personal') {
            await postToFacebookPersonal({
              caption: results.drafts.facebook,
              assets,
              llmConfig,
              forceWebwright: publishConfig.forceWebwright_facebook,
            });
          } else {
            if (!publishConfig.fbPageToken || !publishConfig.fbPageId) {
              throw new Error('請先完成 Facebook 粉專憑證設定。');
            }
            await postToFacebook({
              pageId: publishConfig.fbPageId,
              pageToken: publishConfig.fbPageToken,
              message: results.drafts.facebook,
              assets,
              imgbbKey: publishConfig.imgbbKey,
            });
          }
        } else if (platform === 'instagram') {
          const igType = publishConfig.igAccountType || 'business';
          if (igType === 'personal') {
            await postToInstagramBrowser({
              caption: results.drafts.instagram,
              assets,
              llmConfig,
              forceWebwright: publishConfig.forceWebwright_instagram,
            });
          } else {
            if (!publishConfig.fbPageToken || !publishConfig.igUserId) {
              throw new Error('請先完成 Instagram 商業帳號憑證設定。');
            }
            await postToInstagram({
              igUserId: publishConfig.igUserId,
              pageToken: publishConfig.fbPageToken,
              caption: results.drafts.instagram,
              assets,
              imgbbKey: publishConfig.imgbbKey,
            });
          }
        } else if (platform === 'threads') {
          const threadsType = publishConfig.threadsAccountType ?? 'personal';
          const token = threadsType === 'business' ? publishConfig.threadsBusinessToken : publishConfig.threadsToken;
          const userId = threadsType === 'business' ? publishConfig.threadsBusinessUserId : publishConfig.threadsUserId;
          if (!token || !userId) throw new Error('請先完成 Threads 憑證設定。');
          await postToThreads({
            threadsUserId: userId,
            threadsToken: token,
            text: results.drafts.threads,
            assets,
            imgbbKey: publishConfig.imgbbKey,
          });
        } else if (platform === 'xhs') {
          const content = results.drafts.xhs;
          const title = (content.split('\n').find((line) => line.trim()) || '小紅書貼文').replace(/^[#＃\s]+/, '').slice(0, 20);
          await postToXhs({
            title,
            content,
            assets,
            llmConfig,
            forceWebwright: publishConfig.forceWebwright_xhs,
          });
        }

        setPublishStatus((prev) => ({
          ...prev,
          [platform]: { status: 'success', message: '發布成功！' },
        }));
      } catch (err) {
        const msg = extractRequestErrorMessage(err) || '發布失敗';
        setPublishStatus((prev) => ({
          ...prev,
          [platform]: { status: 'error', message: msg },
        }));
      }
    }

    setIsPublishing(false);
  };

  const primaryProviderLabel = llmConfigDraft.provider ? llmConfigDraft.provider.toUpperCase() : '未設定';
  const generationBlockedReason = mediaSummary.videoCount > 0 && !providerCapabilities.supportsVideo
    ? '目前所選模型尚未確認支援影片理解；請先完成測試連線能力偵測。'
    : '';
  const activeSupport = getPlatformPublishSupport(activePlatform, assets, publishConfig);

  return (
    <div className="min-h-screen bg-transparent font-sans text-slate-800 dark:text-slate-200 flex flex-col transition-colors duration-300">
      <header className="flex items-center justify-between px-5 md:px-8 h-16 bg-white/70 dark:bg-slate-900/60 border-b border-slate-200/50 dark:border-slate-800/50 sticky top-0 z-40 backdrop-blur-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-black tracking-tight m-0 bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500">
              SocialMedia Agent
            </h1>
            <p className="text-[11px] md:text-xs text-slate-500 m-0">步驟式素材到貼文工作流</p>
          </div>
        </div>
        <button
          onClick={() => setIsConfigOpen(true)}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-xl transition-all duration-200 border border-transparent hover:border-slate-200/60 dark:hover:border-slate-700/60"
        >
          <Settings className="w-5 h-5 text-slate-600 dark:text-slate-300" />
        </button>
      </header>

      <main className="flex-1 w-full px-4 md:px-8 py-6 md:py-8 max-w-[1600px] mx-auto space-y-6">
        <StepProgress
          currentStep={currentStep}
          stepStatus={stepStatus}
          onSelectStep={setCurrentStep}
        />

        <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_360px] gap-6">
          <div className="glass-panel rounded-3xl p-5 md:p-7 shadow-xl space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                  Step {currentStep}
                </p>
                <h2 className="text-2xl font-black m-0">{STEPS.find((step) => step.id === currentStep)?.title}</h2>
                <p className="text-sm text-slate-500 mt-2">
                  {STEPS.find((step) => step.id === currentStep)?.description}
                </p>
              </div>
              {currentStep < 5 && (
                <button
                  type="button"
                  onClick={() => setCurrentStep((prev) => Math.min(5, prev + 1))}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  下一步 <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {currentStep === 1 && (
              <section className="space-y-4">
                <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/60 dark:bg-slate-950/30 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="m-0 text-base font-bold">目前模型能力摘要</h3>
                      <p className="text-sm text-slate-500 mt-1">
                        Provider：<span className="font-semibold text-slate-700 dark:text-slate-200">{primaryProviderLabel}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => setIsConfigOpen(true)}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold"
                    >
                      開啟設定
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <CapabilityCard
                      title="圖片理解"
                      supported={providerCapabilities.supportsImage}
                      description={providerCapabilities.supportsImage ? '可分析主圖片內容並生成草稿。' : '目前模型不支援圖片理解。'}
                    />
                    <CapabilityCard
                      title="影片理解"
                      supported={providerCapabilities.supportsVideo}
                      description={providerCapabilities.supportsVideo ? '可直接用主影片生成文案。' : '目前此模型尚未確認支援影片理解，請先完成測試連線能力偵測。'}
                    />
                  </div>

                  {!safeReadyConfig && (
                    <InlineAlert type="error" message="目前設定尚未完成。請先填好 API Key、Base URL 與模型名稱。" />
                  )}
                  {safeReadyConfig && (
                    <InlineAlert type="success" message="LLM 設定可用，你可以繼續上傳素材。" />
                  )}
                </div>
              </section>
            )}

            {currentStep === 2 && (
              <section className="space-y-5">
                <div className="rounded-2xl border border-dashed border-slate-300/80 dark:border-slate-700 p-6 bg-white/30 dark:bg-slate-950/20">
                  <label className="flex flex-col items-center justify-center text-center cursor-pointer gap-3">
                    <Upload className="w-10 h-10 text-indigo-500" />
                    <div>
                      <p className="font-bold">拖放或點擊上傳圖片／影片</p>
                      <p className="text-sm text-slate-500 mt-1">支援混合素材，最多 10 個檔案。請指定一個主素材作為生成依據。</p>
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,video/*"
                      multiple
                      onChange={handleAssetChange}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {assets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      onRemove={removeAsset}
                      onSetPrimary={setPrimaryAsset}
                    />
                  ))}
                </div>

                {assets.length === 0 && (
                  <InlineAlert type="info" message="還沒有素材。建議先上傳 1 張主圖或 1 支主影片，再補充說明文字。" />
                )}
              </section>
            )}

            {currentStep === 3 && (
              <section className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400/80 block">補充描述</label>
                  <textarea
                    className="w-full h-36 p-4 bg-slate-50/60 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none shadow-inner transition-all text-sm leading-relaxed"
                    placeholder="例如：這支影片想強調海邊日落的鬆弛感、想吸引旅行系創作者、語氣希望自然溫柔。"
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                  />
                </div>

                <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 p-4 bg-slate-50/40 dark:bg-slate-900/20 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-sm">主素材</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {primaryAsset ? `${primaryAsset.name} · ${primaryAsset.type === 'video' ? '影片' : '圖片'}` : '尚未指定主素材'}
                      </p>
                    </div>
                    <div className="text-xs px-3 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                      {inferAssetKindLabel(mediaSummary)}
                    </div>
                  </div>

                  <label className="flex items-center justify-between p-3 rounded-xl bg-white/60 dark:bg-slate-950/30 border border-slate-200/60 dark:border-slate-800/60">
                    <div>
                      <p className="text-sm font-bold">附加 AI 產生標記</p>
                      <p className="text-xs text-slate-500 mt-1">會在文案尾端補上識別字樣。</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={includeSignature}
                      onChange={(event) => handleToggleSignature(event.target.checked)}
                      className="w-4 h-4 accent-indigo-600"
                    />
                  </label>

                  {generationBlockedReason && <InlineAlert type="error" message={generationBlockedReason} />}
                  {!generationBlockedReason && analysisNotice && <InlineAlert type="warning" message={analysisNotice} />}
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => generateContent()}
                    disabled={!primaryAsset || isLoading || Boolean(generationBlockedReason)}
                    className="flex-1 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-300 text-white rounded-2xl font-bold transition-all shadow-lg flex items-center justify-center gap-3"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                    {isLoading ? '生成中...' : '開始產出多平台文案'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openPromptPreview('all')}
                    disabled={!primaryAsset || isLoading}
                    className="px-5 py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center justify-center gap-2"
                  >
                    <Terminal className="w-4 h-4 text-indigo-500" />
                    預覽提示詞
                  </button>
                </div>
              </section>
            )}

            {currentStep === 4 && (
              <section className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-5 min-h-[580px]">
                <aside className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/40 dark:bg-slate-950/30 p-3 space-y-2">
                  {Object.keys(results.drafts).map((platform) => (
                    <button
                      key={platform}
                      onClick={() => setActivePlatform(platform)}
                      className={`w-full text-left rounded-2xl p-4 border transition ${
                        activePlatform === platform
                          ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30'
                          : 'border-slate-200/70 dark:border-slate-800 bg-white/50 dark:bg-slate-900/20 hover:border-indigo-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold">{PLATFORM_LABELS[platform]}</span>
                        <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                          {getPlatformStatus(platform, draftMeta, confirmed)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-2">
                        {getPlatformPublishSupport(platform, assets, publishConfig).reason}
                      </p>
                    </button>
                  ))}
                </aside>

                <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/40 dark:bg-slate-950/30 p-5 flex flex-col gap-4">
                  {analysisNotice && <InlineAlert type="warning" message={analysisNotice} />}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <h3 className="m-0 text-xl font-bold">{PLATFORM_LABELS[activePlatform]}</h3>
                      <p className="text-sm text-slate-500 mt-1">
                        素材：{inferAssetKindLabel(mediaSummary)} · 發布方式：{activeSupport.method === 'api' ? 'API' : activeSupport.method === 'browser' ? '瀏覽器自動化' : '目前不可發布'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(results.drafts[activePlatform] || '')}
                        className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                      >
                        <ClipboardCopy className="w-4 h-4" /> 複製
                      </button>
                      <button
                        onClick={() => openPromptPreview('single', activePlatform)}
                        className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                      >
                        <Terminal className="w-4 h-4" /> 進階提示詞
                      </button>
                      <button
                        onClick={() => generateSinglePlatformContent(activePlatform)}
                        disabled={platformLoading[activePlatform]}
                        className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-slate-300 flex items-center gap-2"
                      >
                        {platformLoading[activePlatform] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        重新生成
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <InsightChip icon={<MapPin className="w-3.5 h-3.5" />} label={results.mediaInsight.landmark || '尚無主題'} color="indigo" />
                    <InsightChip icon={<Sparkles className="w-3.5 h-3.5" />} label={results.mediaInsight.mood || '尚無氛圍'} color="amber" />
                    <InsightChip icon={<Palette className="w-3.5 h-3.5" />} label={results.mediaInsight.tone || '尚無色調'} color="emerald" />
                  </div>

                  <textarea
                    className="flex-1 min-h-[320px] p-4 bg-slate-50/60 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none shadow-inner transition-all text-sm leading-relaxed"
                    value={results.drafts[activePlatform]}
                    onChange={(event) => handleEditDraft(activePlatform, event.target.value)}
                    placeholder={`這裡會顯示 ${PLATFORM_LABELS[activePlatform]} 草稿。`}
                  />

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <InlineAlert type={activeSupport.canPublish ? 'info' : 'warning'} message={activeSupport.reason} />
                    <button
                      onClick={() => toggleConfirm(activePlatform)}
                      className={`px-4 py-3 rounded-2xl text-sm font-bold transition ${
                        confirmed[activePlatform]
                          ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-900 text-white hover:bg-slate-800'
                      }`}
                    >
                      {confirmed[activePlatform] ? '已確認，可再點一次取消' : '確認此平台草稿'}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {currentStep === 5 && (
              <section className="space-y-5">
                <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white/40 dark:bg-slate-950/30 p-5 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <h3 className="m-0 text-lg font-bold">發布前總結</h3>
                      <p className="text-sm text-slate-500 mt-1">
                        已確認 {confirmedPlatforms.length} 個平台 · 素材型別：{inferAssetKindLabel(mediaSummary)}
                      </p>
                    </div>
                    <button
                      onClick={handlePublish}
                      disabled={isPublishing || confirmedPlatforms.length === 0}
                      className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-300 text-white font-bold flex items-center gap-2"
                    >
                      {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {isPublishing ? '發布中...' : '開始發布'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {confirmedPlatforms.map((platform) => {
                      const support = getPlatformPublishSupport(platform, assets, publishConfig);
                      const status = publishStatus[platform];
                      return (
                        <div key={platform} className="rounded-2xl border border-slate-200/70 dark:border-slate-800 p-4 bg-white/50 dark:bg-slate-900/20 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-bold">{PLATFORM_LABELS[platform]}</span>
                            <span className={`text-[11px] px-2 py-1 rounded-full ${
                              support.canPublish
                                ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                : 'bg-amber-50 text-amber-700 border border-amber-100'
                            }`}>
                              {support.method === 'api' ? 'API' : support.method === 'browser' ? '瀏覽器' : '不可發布'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-500">{support.reason}</p>
                          {status && (
                            <div className={`text-sm rounded-xl px-3 py-2 ${
                              status.status === 'success'
                                ? 'bg-emerald-50 text-emerald-700'
                                : status.status === 'error' || status.status === 'blocked'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-slate-100 text-slate-600'
                            }`}>
                              {status.message}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {confirmedPlatforms.includes('facebook') && (
                      <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 p-4 bg-white/50 dark:bg-slate-900/20 space-y-3">
                        <p className="font-bold text-sm">Facebook 帳號型態</p>
                        <div className="flex gap-2">
                          {['business', 'personal'].map((type) => (
                            <button
                              key={type}
                              onClick={() => handleCredsChange('fbAccountType', type)}
                              className={`px-3 py-2 rounded-xl text-sm border ${
                                (publishConfig.fbAccountType || 'business') === type
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {type === 'business' ? '粉絲專頁' : '個人帳號'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {confirmedPlatforms.includes('instagram') && (
                      <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 p-4 bg-white/50 dark:bg-slate-900/20 space-y-3">
                        <p className="font-bold text-sm">Instagram 帳號型態</p>
                        <div className="flex gap-2">
                          {['business', 'personal'].map((type) => (
                            <button
                              key={type}
                              onClick={() => handleCredsChange('igAccountType', type)}
                              className={`px-3 py-2 rounded-xl text-sm border ${
                                (publishConfig.igAccountType || 'business') === type
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {type === 'business' ? '商業帳號' : '個人帳號'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {webwrightOptions.length > 0 && (
                    <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 p-4 bg-white/50 dark:bg-slate-900/20 space-y-3">
                      <div>
                        <p className="font-bold text-sm">AI Webwright / 固定 Playwright</p>
                        <p className="text-xs text-slate-500 mt-1">
                          發布前可以直接選擇要使用 AI Webwright，或跑原本固定的 Playwright。
                        </p>
                      </div>
                      <div className="space-y-3">
                        {webwrightOptions.map((option) => {
                          const enabled = publishConfig[option.field] || false;
                          return (
                            <label
                              key={option.field}
                              className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200/70 dark:border-slate-800 px-4 py-3 cursor-pointer hover:border-indigo-300 transition"
                            >
                              <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{option.label}</p>
                                <p className="text-xs text-slate-500 mt-1">{option.detail}</p>
                                <p className="text-xs mt-2 text-slate-400">
                                  目前選擇：{enabled ? 'AI Webwright' : '固定 Playwright'}
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                className="mt-1 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                checked={enabled}
                                onChange={(event) => handleCredsChange(option.field, event.target.checked)}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-2xl p-4 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
                      <p className="font-bold text-amber-700 dark:text-amber-300">風險提示</p>
                      <p className="text-sm text-amber-700/90 dark:text-amber-200 mt-2">
                        小紅書與個人帳號的自動化發布屬於高風險功能，平台 UI 變更或條款限制都可能導致失敗。
                      </p>
                    </div>
                    <div className="rounded-2xl p-4 bg-sky-50/70 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40">
                      <p className="font-bold text-sky-700 dark:text-sky-300">建議流程</p>
                      <p className="text-sm text-sky-700/90 dark:text-sky-200 mt-2">
                        若是影片素材，優先使用支援影片的發布方式；若平台顯示不可發布，建議先複製草稿後手動上傳。
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-4">
            <div className="glass-panel rounded-3xl p-5 shadow-xl space-y-4">
              <h3 className="text-base font-bold m-0">流程總覽</h3>
              <div className="space-y-3">
                <SummaryRow label="主素材" value={primaryAsset ? `${primaryAsset.type === 'video' ? '影片' : '圖片'} · ${primaryAsset.name}` : '尚未指定'} />
                <SummaryRow label="素材數量" value={`${mediaSummary.total} 個`} />
                <SummaryRow label="媒體型別" value={inferAssetKindLabel(mediaSummary)} />
                <SummaryRow label="已確認平台" value={confirmedPlatforms.length ? confirmedPlatforms.map((platform) => PLATFORM_LABELS[platform]).join('、') : '尚未確認'} />
              </div>
            </div>

            <div className="glass-panel rounded-3xl p-5 shadow-xl space-y-4">
              <h3 className="text-base font-bold m-0">目前限制提醒</h3>
              <div className="space-y-3">
                <InlineAlert
                  type={providerCapabilities.supportsVideo ? 'success' : 'warning'}
                  message={providerCapabilities.supportsVideo ? '目前模型可直接理解影片。' : '若主素材是影片，請先完成測試連線能力偵測，確認影片理解已啟用。'}
                />
                <InlineAlert
                  type={mediaSummary.hasMixedMedia ? 'warning' : 'info'}
                  message={mediaSummary.hasMixedMedia ? '多數平台目前不支援圖片與影片混合素材發布。' : '若要走 API 發布，建議使用純圖片素材。'}
                />
              </div>
            </div>
          </aside>
        </section>
      </main>

      <ConfigDrawer
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        onSaved={() => {
          setConfigSnapshot(readStoredLlmConfig(localStorage));
          setProbeSnapshot(readStoredCapabilityProbe(localStorage));
        }}
        onProbeUpdated={(probeRecord) => setProbeSnapshot(probeRecord)}
      />

      {promptPreview.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden glass-panel text-left">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-800/60">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-500" />
                LLM 提示詞編輯與預覽
              </h3>
              <button
                onClick={() => setPromptPreview((prev) => ({ ...prev, isOpen: false }))}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">System Prompt</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(promptPreview.systemPrompt)}
                    className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600 font-bold"
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" /> 複製
                  </button>
                </div>
                <textarea
                  className="w-full h-72 p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 rounded-xl text-[11px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
                  value={promptPreview.systemPrompt}
                  onChange={(event) => setPromptPreview((prev) => ({ ...prev, systemPrompt: event.target.value }))}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">User Prompt</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(promptPreview.userPrompt)}
                    className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600 font-bold"
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" /> 複製
                  </button>
                </div>
                <textarea
                  className="w-full h-40 p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 rounded-xl text-[11px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
                  value={promptPreview.userPrompt}
                  onChange={(event) => setPromptPreview((prev) => ({ ...prev, userPrompt: event.target.value }))}
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-200/60 dark:border-slate-800/60 flex justify-end gap-3">
              <button
                onClick={() => setPromptPreview((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-semibold transition"
              >
                取消
              </button>
              <button
                onClick={applyPromptPreview}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition"
              >
                套用並重新生成
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="py-8 text-center text-slate-400/80 text-xs border-t border-slate-200/40 dark:border-slate-900/40 mt-8 select-none">
        © 2026 SocialMedia Agent - AI Copywriting for Solo Creators
      </footer>
    </div>
  );
}

function StepProgress({ currentStep, stepStatus, onSelectStep }) {
  return (
    <section className="glass-panel rounded-3xl p-4 md:p-5 shadow-xl">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {STEPS.map((step) => {
          const complete = stepStatus[step.id]?.complete;
          const isActive = currentStep === step.id;
          return (
            <button
              key={step.id}
              onClick={() => onSelectStep(step.id)}
              className={`text-left rounded-2xl border p-4 transition ${
                isActive
                  ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/20'
                  : complete
                    ? 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/10'
                    : 'border-slate-200/70 dark:border-slate-800 bg-white/40 dark:bg-slate-900/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">Step {step.id}</span>
                {complete && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              </div>
              <p className="font-bold mt-2 mb-1">{step.title}</p>
              <p className="text-xs text-slate-500">{step.description}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AssetCard({ asset, onRemove, onSetPrimary }) {
  return (
    <div className={`rounded-2xl border p-3 bg-white/50 dark:bg-slate-900/20 ${asset.isPrimary ? 'border-indigo-500 shadow-md shadow-indigo-500/10' : 'border-slate-200/70 dark:border-slate-800'}`}>
      <div className="relative overflow-hidden rounded-2xl aspect-video bg-slate-100 dark:bg-slate-900">
        {asset.type === 'video' ? (
          <video src={asset.previewUrl} className="w-full h-full object-cover" muted playsInline />
        ) : (
          <img src={asset.previewUrl} alt={asset.name} className="w-full h-full object-cover" />
        )}
        <div className="absolute top-2 left-2 flex gap-2">
          <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-black/60 text-white flex items-center gap-1">
            {asset.type === 'video' ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
            {asset.type === 'video' ? '影片' : '圖片'}
          </span>
          {asset.durationMs && (
            <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-black/60 text-white">
              {formatDuration(asset.durationMs)}
            </span>
          )}
        </div>
        {asset.isPrimary && (
          <span className="absolute bottom-2 left-2 px-2 py-1 rounded-full text-[11px] font-bold bg-indigo-600 text-white">
            主素材
          </span>
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{asset.name}</p>
          <p className="text-xs text-slate-500 mt-1">{asset.mime}</p>
        </div>
        <button onClick={() => onRemove(asset.id)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="w-4 h-4" />
        </button>
      </div>
      {!asset.isPrimary && (
        <button
          onClick={() => onSetPrimary(asset.id)}
          className="mt-3 w-full py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          設為主素材
        </button>
      )}
    </div>
  );
}

function CapabilityCard({ title, supported, description }) {
  return (
    <div className={`rounded-2xl border p-4 ${supported ? 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/10' : 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/10'}`}>
      <div className="flex items-center gap-2">
        {supported ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-amber-500" />}
        <span className="font-bold">{title}</span>
      </div>
      <p className="text-sm text-slate-500 mt-2">{description}</p>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-right">{value}</span>
    </div>
  );
}

function InlineAlert({ type = 'info', message }) {
  const classes = {
    info: 'bg-sky-50 text-sky-700 border-sky-100',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    error: 'bg-red-50 text-red-700 border-red-100',
  };

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${classes[type] || classes.info}`}>
      {message}
    </div>
  );
}

function InsightChip({ icon, label, color }) {
  const classes = {
    indigo: 'bg-indigo-50/80 text-indigo-600 border-indigo-100',
    amber: 'bg-amber-50/80 text-amber-600 border-amber-100',
    emerald: 'bg-emerald-50/80 text-emerald-600 border-emerald-100',
  };
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-sm font-semibold border ${classes[color] || classes.indigo}`}>
      {icon} {label}
    </div>
  );
}

export default App;
