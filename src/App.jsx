import React, { useState, useCallback } from 'react';
import { Settings, Upload, Wand2, MapPin, Sparkles, Palette, Loader2, X, Send, CheckCircle2, AlertCircle, ClipboardCopy, Terminal, Eye, Code2 } from 'lucide-react';
import axios from 'axios';
import ConfigDrawer from './components/ConfigDrawer';
import PlatformCard from './components/PlatformCard';
import { normalizeConfig, requiresApiKey } from './lib/providers';
import { buildGenerationRequest, normalizeGenerationResponse, appendSignature, buildSinglePlatformGenerationRequest, normalizeSinglePlatformResponse } from './lib/generation';
import { postToFacebook, postToInstagram, postToInstagramPersonal, postToThreads, postToXhs, postToFacebookPersonal, postToInstagramBrowser } from './lib/publishing';

// Platforms with native API / automation support
const API_PLATFORMS = new Set(['facebook', 'instagram', 'threads', 'xhs']);

function loadPublishConfig() {
  try { return JSON.parse(localStorage.getItem('publish_config') || '{}'); } catch { return {}; }
}

function App() {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [previews, setPreviews] = useState([]);
  const [context, setContext] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmed, setConfirmed] = useState({ instagram: false, xhs: false, facebook: false, threads: false });
  const [publishStatus, setPublishStatus] = useState({});
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishConfig, setPublishConfig] = useState(loadPublishConfig);

  const [platformLoading, setPlatformLoading] = useState({
    instagram: false,
    xhs: false,
    facebook: false,
    threads: false
  });

  const [promptPreview, setPromptPreview] = useState({
    isOpen: false,
    systemPrompt: '',
    userPrompt: ''
  });

  const [results, setResults] = useState({
    analyzer: { landmark: '', mood: '', tone: '' },
    drafts: { instagram: '', xhs: '', facebook: '', threads: '' }
  });

  const [includeSignature, setIncludeSignature] = useState(() => {
    const saved = localStorage.getItem('include_signature');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const handleToggleSignature = useCallback((checked) => {
    setIncludeSignature(checked);
    localStorage.setItem('include_signature', JSON.stringify(checked));

    setResults(prev => {
      const nextDrafts = {};
      Object.entries(prev.drafts).forEach(([platform, content]) => {
        nextDrafts[platform] = appendSignature(content, checked);
      });
      return {
        ...prev,
        drafts: nextDrafts
      };
    });
  }, []);

  const handleCredsChange = useCallback((field, value) => {
    setPublishConfig(prev => {
      const next = { ...prev, [field]: value };
      localStorage.setItem('publish_config', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleConfirm = (platform) => {
    setConfirmed(prev => ({ ...prev, [platform]: !prev[platform] }));
    setPublishStatus(prev => { const next = { ...prev }; delete next[platform]; return next; });
  };

  const confirmedPlatforms = Object.entries(confirmed).filter(([, v]) => v).map(([k]) => k);

  const handlePublish = async () => {
    const primaryImage = previews[0] || null;
    setIsPublishing(true);

    for (const platform of confirmedPlatforms) {
      if (!API_PLATFORMS.has(platform)) {
        setPublishStatus(prev => ({ ...prev, [platform]: { status: 'manual', message: '無公開 API，請手動複製文案發布。' } }));
        continue;
      }

      setPublishStatus(prev => ({ ...prev, [platform]: { status: 'loading' } }));

      try {
        if (platform === 'facebook') {
          const fbType = publishConfig.fbAccountType || 'business';
          if (fbType === 'personal') {
            await postToFacebookPersonal({
              caption: results.drafts.facebook,
              imageDataUrl: primaryImage,
            });
          } else {
            if (!publishConfig.fbPageToken || !publishConfig.fbPageId) {
              throw new Error('請先展開下方「API 憑證設定」填入 Facebook Page Token 和 Page ID。');
            }
            await postToFacebook({
              pageId: publishConfig.fbPageId,
              pageToken: publishConfig.fbPageToken,
              message: results.drafts.facebook,
              imageDataUrl: primaryImage,
              imgbbKey: publishConfig.imgbbKey,
            });
          }
        } else if (platform === 'instagram') {
          const igType = publishConfig.igAccountType || 'business';
          if (igType === 'personal') {
            await postToInstagramBrowser({
              caption: results.drafts.instagram,
              imageDataUrl: primaryImage,
            });
          } else {
            if (!publishConfig.fbPageToken || !publishConfig.igUserId) {
              throw new Error('請先展開下方「API 憑證設定」填入 Facebook Page Token 和 Instagram User ID。');
            }
            try {
              await axios.post('http://localhost:3001/api/llm/proxy', {
                url: 'https://graph.facebook.com/v20.0/me',
                method: 'GET',
                headers: {},
                data: { access_token: publishConfig.fbPageToken },
              }, { timeout: 10000 });
            } catch (err) {
              const raw = err.response?.data || err.message || String(err);
              throw new Error(`Facebook Page Token 無效或解析失敗：${JSON.stringify(raw)}`);
            }
            await postToInstagram({
              igUserId: publishConfig.igUserId,
              pageToken: publishConfig.fbPageToken,
              caption: results.drafts.instagram,
              imageDataUrl: primaryImage,
              imgbbKey: publishConfig.imgbbKey,
            });
          }
        } else if (platform === 'threads') {
          const threadsType = publishConfig.threadsAccountType ?? 'personal';
          const token = threadsType === 'business' ? publishConfig.threadsBusinessToken : publishConfig.threadsToken;
          const userId = threadsType === 'business' ? publishConfig.threadsBusinessUserId : publishConfig.threadsUserId;
          if (!token || !userId) {
            const label = threadsType === 'business' ? '商業' : '個人';
            throw new Error(`請先展開下方「API 憑證設定」→ 切換到「${label}帳號」填入 Threads 存取權杖和用戶 ID。`);
          }
          await postToThreads({
            threadsUserId: userId,
            threadsToken: token,
            text: results.drafts.threads,
            imageDataUrl: primaryImage,
            imgbbKey: publishConfig.imgbbKey,
          });
        } else if (platform === 'xhs') {
          const xhsContent = results.drafts.xhs;
          const firstLine = xhsContent.split('\n').find(l => l.trim()) || '';
          const xhsTitle = firstLine.replace(/^[#＃\s]+/, '').slice(0, 20) || '小紅書貼文';
          await postToXhs({
            title: xhsTitle,
            content: xhsContent,
            imageDataUrl: primaryImage,
          });
        }
        setPublishStatus(prev => ({ ...prev, [platform]: { status: 'success', message: '發布成功！' } }));
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message || '發布失敗';
        setPublishStatus(prev => ({ ...prev, [platform]: { status: 'error', message: msg } }));
      }
    }

    setIsPublishing(false);
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        setPreviews((prev) => (prev.length < 10 ? [...prev, reader.result] : prev));
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const generateContent = async () => {
    const config = normalizeConfig(JSON.parse(localStorage.getItem('llm_config') || 'null'));
    if (requiresApiKey(config.provider) && !config.apiKey) {
      alert('請先在設定中填寫 API Key');
      setIsConfigOpen(true);
      return;
    }

    if (!previews.length) {
      alert('請先上傳圖片。');
      return;
    }

    setIsLoading(true);
    try {
      const request = buildGenerationRequest(config, {
        imageDataUrls: previews,
        userContext: context,
      });

      const response = await axios.post('http://localhost:3001/api/llm/proxy', {
        url: request.url,
        headers: request.headers,
        data: request.data,
      });

      const rawRes = normalizeGenerationResponse(config, response.data);
      if (includeSignature) {
        Object.keys(rawRes.drafts).forEach(key => {
          rawRes.drafts[key] = appendSignature(rawRes.drafts[key], true);
        });
      }
      setResults(rawRes);
    } catch (err) {
      const rawMsg = err.response?.data?.error?.message
        || err.response?.data?.message
        || err.message
        || '';

      const isVisionError =
        rawMsg.includes('multimodal') ||
        rawMsg.includes('vision') ||
        rawMsg.includes('image') ||
        rawMsg.includes('does not support');

      const message = isVisionError
        ? '此模型不支援圖片輸入。\n\n請在設定中換成視覺模型：\n• Ollama: llava / llava-llama3 / moondream\n• OpenAI: gpt-4o / gpt-4-turbo\n• Claude: claude-3-5-sonnet-latest\n• NVIDIA: meta/llama-3.2-11b-vision-instruct'
        : '草稿生成失敗: ' + rawMsg;

      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreviewPrompt = () => {
    const config = normalizeConfig(JSON.parse(localStorage.getItem('llm_config') || 'null'));
    if (!previews.length) {
      alert('請先上傳圖片，才能拼裝與預覽完整的提示詞喔！');
      return;
    }

    try {
      const request = buildGenerationRequest(config, {
        imageDataUrls: previews,
        userContext: context,
      });

      setPromptPreview({
        isOpen: true,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt
      });
    } catch (err) {
      alert('拼裝提示詞失敗: ' + err.message);
    }
  };

  const handlePreviewSinglePrompt = (platform) => {
    const config = normalizeConfig(JSON.parse(localStorage.getItem('llm_config') || 'null'));
    if (!previews.length) {
      alert('請先上傳圖片，才能拼裝與預覽單平台的提示詞喔！');
      return;
    }

    try {
      const request = buildSinglePlatformGenerationRequest(config, platform, {
        imageDataUrls: previews,
        userContext: context,
        currentContent: results.drafts[platform]
      });

      setPromptPreview({
        isOpen: true,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt
      });
    } catch (err) {
      alert('拼裝單平台提示詞失敗: ' + err.message);
    }
  };

  const generateSinglePlatformContent = async (platform) => {
    const config = normalizeConfig(JSON.parse(localStorage.getItem('llm_config') || 'null'));
    if (requiresApiKey(config.provider) && !config.apiKey) {
      alert('請先在設定中填寫 API Key');
      setIsConfigOpen(true);
      return;
    }

    if (!previews.length) {
      alert('請先上傳圖片以重新生成文案。');
      return;
    }

    setPlatformLoading(prev => ({ ...prev, [platform]: true }));
    try {
      const request = buildSinglePlatformGenerationRequest(config, platform, {
        imageDataUrls: previews,
        userContext: context,
        currentContent: results.drafts[platform]
      });

      const response = await axios.post('http://localhost:3001/api/llm/proxy', {
        url: request.url,
        headers: request.headers,
        data: request.data,
      });

      let singleText = normalizeSinglePlatformResponse(config, response.data);
      if (includeSignature) {
        singleText = appendSignature(singleText, true);
      }

      setResults(prev => ({
        ...prev,
        drafts: {
          ...prev.drafts,
          [platform]: singleText
        }
      }));
    } catch (err) {
      console.error(err);
      const rawMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message || '';
      alert(`針對 ${platform === 'xhs' ? '小紅書' : platform} 的重新生成失敗: ` + rawMsg);
    } finally {
      setPlatformLoading(prev => ({ ...prev, [platform]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-transparent font-sans text-slate-800 dark:text-slate-200 flex flex-col transition-colors duration-300">
      {/* Navbar */}
      <header className="flex items-center justify-between px-8 h-16 bg-white/70 dark:bg-slate-900/60 border-b border-slate-200/50 dark:border-slate-800/50 sticky top-0 z-40 backdrop-blur-lg">
        <div className="flex items-center gap-2 select-none">
          <div className="w-9 h-9 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-black tracking-tight m-0 bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 dark:from-indigo-400 dark:via-purple-400 dark:to-pink-400">
            SocialMedia Agent
          </h1>
        </div>
        <button 
          onClick={() => setIsConfigOpen(true)}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 border border-transparent hover:border-slate-200/60 dark:hover:border-slate-700/60"
        >
          <Settings className="w-5 h-5 text-slate-600 dark:text-slate-300" />
        </button>
      </header>

      <main className="flex-1 w-full px-4 md:px-8 py-8 space-y-10 max-w-[1600px] mx-auto">
        {/* Input Section */}
        <section className="flex flex-col xl:flex-row gap-8 items-start text-left">
          {/* Uploader */}
          <div className="xl:w-[420px] w-full shrink-0 h-80 bg-white/40 dark:bg-slate-900/40 border-2 border-dashed border-slate-300/80 dark:border-slate-800/80 rounded-2xl overflow-hidden relative group transition-all duration-300 hover:border-indigo-500/80 hover:bg-indigo-50/10 dark:hover:bg-indigo-950/5 backdrop-blur-md shadow-md">
            {previews.length === 0 ? (
              <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer">
                <Upload className="w-12 h-12 text-slate-400/80 mb-4 group-hover:scale-110 group-hover:text-indigo-500 transition-all duration-300" />
                <span className="text-sm font-bold text-slate-600 dark:text-slate-400">拖放或點擊上傳圖片</span>
                <span className="text-xs text-slate-400 mt-1">最多可選擇 10 張（首張為主圖）</span>
                <input type="file" className="hidden" onChange={handleImageChange} accept="image/*" multiple />
              </label>
            ) : (
              <div className="w-full h-full grid grid-cols-4 gap-2 p-3 overflow-y-auto">
                {previews.map((src, i) => (
                  <div key={i} className="relative overflow-hidden rounded-xl aspect-square shadow-sm group/item">
                    <img src={src} className="w-full h-full object-cover" alt={`preview-${i}`} />
                    {i === 0 && (
                      <span className="absolute bottom-1.5 left-1.5 bg-indigo-600/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md shadow-sm">主圖</span>
                    )}
                    <button
                      onClick={() => setPreviews((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1.5 right-1.5 bg-black/60 p-1.5 rounded-full text-white hover:bg-black/80 transition opacity-0 group-hover/item:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {previews.length < 10 && (
                  <label className="flex flex-col items-center justify-center cursor-pointer rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-400 transition-colors duration-200 min-h-[80px] aspect-square bg-white/20 dark:bg-slate-800/10">
                    <Upload className="w-5 h-5 text-slate-400" />
                    <span className="text-[10px] text-slate-400 mt-1 font-bold">新增</span>
                    <input type="file" className="hidden" onChange={handleImageChange} accept="image/*" multiple />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Context & Controls */}
          <div className="flex-1 min-w-0 space-y-6 glass-panel rounded-2xl p-6 md:p-8 shadow-xl">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wider text-slate-400/80 block">內容描述 Context</label>
              <textarea 
                className="w-full h-32 p-4 bg-slate-50/60 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none shadow-inner transition-all text-sm leading-relaxed"
                placeholder="輸入一些背景資訊，例如：拍攝地點、當前心情、希望強調的特色..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </div>

            {/* Toggle Signature */}
            <div className="flex items-center justify-between p-4 bg-slate-50/40 dark:bg-slate-900/20 border border-slate-200/50 dark:border-slate-800/50 rounded-xl hover:border-slate-300 dark:hover:border-slate-700 transition duration-200">
              <div className="space-y-0.5 text-left">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">附加 AI 產生標記</span>
                <p className="text-xs text-slate-400">在文案尾部加上「本篇貼文由 social media agent 產生」</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={includeSignature} 
                  onChange={(e) => handleToggleSignature(e.target.checked)} 
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {/* Vision Insight Tags */}
            <div className="space-y-2 text-left">
              <label className="text-xs font-black uppercase tracking-wider text-slate-400/80 block">AI Vision Insights</label>
              <div className="flex flex-wrap gap-2 min-h-[30px]">
                {results.analyzer.landmark && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-semibold border border-indigo-100 dark:border-indigo-900/60 shadow-sm transition-all duration-300 hover:scale-105">
                    <MapPin className="w-3.5 h-3.5" /> {results.analyzer.landmark}
                  </span>
                )}
                {results.analyzer.mood && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50/80 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-full text-xs font-semibold border border-amber-100 dark:border-amber-900/60 shadow-sm transition-all duration-300 hover:scale-105">
                    <Sparkles className="w-3.5 h-3.5" /> {results.analyzer.mood}
                  </span>
                )}
                {results.analyzer.tone && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-semibold border border-emerald-100 dark:border-emerald-900/60 shadow-sm transition-all duration-300 hover:scale-105">
                    <Palette className="w-3.5 h-3.5" /> {results.analyzer.tone}
                  </span>
                )}
                {!results.analyzer.landmark && <span className="text-xs text-slate-400/80 italic py-1">尚未上傳分析...</span>}
              </div>
            </div>

            {/* Action buttons row */}
            <div className="flex flex-col sm:flex-row gap-4 pt-2">
              <button 
                onClick={generateContent}
                disabled={!previews.length || isLoading}
                className="flex-1 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-300 dark:disabled:from-slate-800 dark:disabled:to-slate-800 text-white rounded-xl font-bold text-base transition-all shadow-lg hover:shadow-indigo-500/20 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-3 cursor-pointer disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                {isLoading ? '生成中，魔法調配裡...' : '開始產出多平台文案'}
              </button>
              
              <button 
                type="button"
                onClick={handlePreviewPrompt}
                disabled={!previews.length || isLoading}
                className="px-6 py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-md flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
              >
                <Terminal className="w-4 h-4 text-indigo-500" />
                預覽提示詞
              </button>
            </div>
          </div>
        </section>

        {/* 2x2 Grid Output */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 border-l-4 border-indigo-600 pl-3">
            <h2 className="text-xl font-extrabold tracking-tight m-0">平台草稿預覽 4×1</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 text-left">
            {Object.entries(results.drafts).map(([platform, content]) => (
              <PlatformCard
                key={platform}
                platform={platform}
                content={content}
                isLoading={isLoading || platformLoading[platform]}
                isPlatformLoading={platformLoading[platform]}
                confirmed={confirmed[platform]}
                onConfirm={() => handleConfirm(platform)}
                creds={publishConfig}
                onCredsChange={handleCredsChange}
                onRegenerate={() => generateSinglePlatformContent(platform)}
                onPreviewPrompt={() => handlePreviewSinglePrompt(platform)}
                onEdit={(val) => setResults({
                  ...results,
                  drafts: { ...results.drafts, [platform]: val }
                })}
              />
            ))}
          </div>

          {/* Publish Bar */}
          {confirmedPlatforms.length > 0 && (
            <div className="glass-panel border border-slate-200/50 dark:border-slate-800/50 rounded-2xl p-6 space-y-4 mt-6 shadow-lg text-left">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Send className="w-5 h-5 text-indigo-600" />
                    已確認 {confirmedPlatforms.length} 個平台草稿：
                    <span className="text-indigo-600">{confirmedPlatforms.map(p => p === 'xhs' ? '小紅書' : p).join('、')}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">小紅書無公開 API，確認後需手動複製發布。個人帳號將透過瀏覽器自動模擬發文。</p>
                  {(confirmedPlatforms.includes('facebook') || confirmedPlatforms.includes('instagram')) && (
                    <div className="flex flex-wrap gap-4 mt-3">
                      {confirmedPlatforms.includes('facebook') && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-slate-500 font-semibold">Facebook：</span>
                          {['business', 'personal'].map(t => (
                            <button
                              key={t}
                              onClick={() => handleCredsChange('fbAccountType', t)}
                              className={`px-3 py-1 rounded-full border text-[11px] font-bold transition ${
                                (publishConfig.fbAccountType || 'business') === t
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-600/20'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                              }`}
                            >
                              {t === 'business' ? '🏢 粉絲專頁' : '👤 個人帳號'}
                            </button>
                          ))}
                        </div>
                      )}
                      {confirmedPlatforms.includes('instagram') && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-slate-500 font-semibold">Instagram：</span>
                          {['business', 'personal'].map(t => (
                            <button
                              key={t}
                              onClick={() => handleCredsChange('igAccountType', t)}
                              className={`px-3 py-1 rounded-full border text-[11px] font-bold transition ${
                                (publishConfig.igAccountType || 'business') === t
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-600/20'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                              }`}
                            >
                              {t === 'business' ? '🏢 商業帳號' : '👤 個人帳號'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={handlePublish}
                  disabled={isPublishing}
                  className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-300 dark:disabled:from-slate-800 dark:disabled:to-slate-800 text-white rounded-xl font-bold transition shadow-md hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                >
                  {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {isPublishing ? '發布中...' : '開始發布'}
                </button>
              </div>

              {/* Per-platform publish results */}
              {Object.keys(publishStatus).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                  {confirmedPlatforms.map(platform => {
                    const ps = publishStatus[platform];
                    if (!ps) return null;
                    const statusClasses = {
                      success: 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/60 shadow-sm shadow-emerald-500/5',
                      error: 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900/60 shadow-sm shadow-red-500/5',
                      manual: 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/60 shadow-sm shadow-amber-500/5',
                      loading: 'bg-slate-50 dark:bg-slate-800/40 text-slate-500 border-slate-200 dark:border-slate-700',
                    };
                    return (
                      <div key={platform} className={`p-3 rounded-xl text-xs border flex flex-col gap-1 ${statusClasses[ps.status] || statusClasses.loading}`}>
                        <div className="font-bold capitalize flex items-center gap-1.5">
                          {ps.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {ps.status === 'error' && <AlertCircle className="w-3.5 h-3.5" />}
                          {ps.status === 'manual' && <ClipboardCopy className="w-3.5 h-3.5" />}
                          {ps.status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          {platform === 'xhs' ? '小紅書' : platform}
                        </div>
                        {ps.message && <div className="leading-relaxed font-medium mt-0.5 opacity-90">{ps.message}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <ConfigDrawer isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} />

      {/* Prompt Preview Modal */}
      {promptPreview.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden glass-panel text-left">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-800/60">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-500" />
                LLM 提示詞預覽 (Prompt Preview)
              </h3>
              <button 
                onClick={() => setPromptPreview(prev => ({ ...prev, isOpen: false }))}
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
                    onClick={() => {
                      navigator.clipboard.writeText(promptPreview.systemPrompt);
                      alert('已複製 System Prompt 到剪貼簿！');
                    }}
                    className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600 font-bold cursor-pointer"
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" /> 複製
                  </button>
                </div>
                <pre className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 rounded-xl text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                  {promptPreview.systemPrompt}
                </pre>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">User Prompt</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(promptPreview.userPrompt);
                      alert('已複製 User Prompt 到剪貼簿！');
                    }}
                    className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600 font-bold cursor-pointer"
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" /> 複製
                  </button>
                </div>
                <pre className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 rounded-xl text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                  {promptPreview.userPrompt}
                </pre>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-200/60 dark:border-slate-800/60 flex justify-end">
              <button
                onClick={() => setPromptPreview(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition cursor-pointer"
              >
                關閉預覽
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="py-8 text-center text-slate-400/80 text-xs border-t border-slate-200/40 dark:border-slate-900/40 mt-12 select-none">
        © 2026 SocialMedia Agent - AI Copywriting for Solo Creators
      </footer>
    </div>
  );
}

export default App;
