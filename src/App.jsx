import React, { useState, useCallback } from 'react';
import { Settings, Upload, Wand2, MapPin, Sparkles, Palette, Loader2, X, Send, CheckCircle2, AlertCircle, ClipboardCopy } from 'lucide-react';
import axios from 'axios';
import ConfigDrawer from './components/ConfigDrawer';
import PlatformCard from './components/PlatformCard';
import { normalizeConfig, requiresApiKey } from './lib/providers';
import { buildGenerationRequest, normalizeGenerationResponse } from './lib/generation';
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
  // 統一使用單一事實來源 publishConfig，不再另外維護會重置的本地狀態

  const [results, setResults] = useState({
    analyzer: { landmark: '', mood: '', tone: '' },
    drafts: { instagram: '', xhs: '', facebook: '', threads: '' }
  });

  // Update a single credential field and auto-save to localStorage
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
      // XHS uses Playwright browser automation (no official API); Threads/IG/FB use official APIs
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
              // Quick validation: check that the provided Page Access Token is valid
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
          // Extract title from first non-empty line (XHS limit: 20 chars)
          const xhsContent = results.drafts.xhs;
          const firstLine = xhsContent.split('\n').find(l => l.trim()) || '';
          const xhsTitle = firstLine.replace(/^[#＃\s]+/, '').slice(0, 20) || '小紅書貧文';
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
    // reset input so same file can be re-selected
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

      setResults(normalizeGenerationResponse(config, response.data));
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Navbar */}
      <header className="flex items-center justify-between px-8 h-16 bg-white dark:bg-slate-900 border-b dark:border-slate-800 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight m-0">SocialMedia Agent</h1>
        </div>
        <button 
          onClick={() => setIsConfigOpen(true)}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition"
        >
          <Settings className="w-6 h-6" />
        </button>
      </header>

      <main className="flex-1 w-full px-4 md:px-8 py-8 space-y-10">
        {/* Input Section */}
        <section className="flex flex-col xl:flex-row gap-6 items-start text-left">
          {/* Uploader */}
          <div className="xl:w-[400px] w-full shrink-0 h-72 bg-white dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden relative group transition-colors hover:border-indigo-400">
            {previews.length === 0 ? (
              <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer">
                <Upload className="w-12 h-12 text-slate-300 mb-4 group-hover:scale-110 transition" />
                <span className="text-sm font-medium text-slate-500">點擊或拖放圖片（最多 10 張）</span>
                <input type="file" className="hidden" onChange={handleImageChange} accept="image/*" multiple />
              </label>
            ) : (
              <div className="w-full h-full grid grid-cols-4 gap-1 p-1">
                {previews.map((src, i) => (
                  <div key={i} className="relative overflow-hidden rounded-lg">
                    <img src={src} className="w-full h-full object-cover" alt={`preview-${i}`} />
                    {i === 0 && (
                      <span className="absolute bottom-1 left-1 bg-indigo-600/80 text-white text-[9px] font-bold px-1 rounded">主圖</span>
                    )}
                    <button
                      onClick={() => setPreviews((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-black/60 p-1 rounded-full text-white hover:bg-black/80"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {previews.length < 10 && (
                  <label className="flex flex-col items-center justify-center cursor-pointer rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-400 transition min-h-[80px]">
                    <Upload className="w-6 h-6 text-slate-400" />
                    <span className="text-xs text-slate-400 mt-1">新增</span>
                    <input type="file" className="hidden" onChange={handleImageChange} accept="image/*" multiple />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Context & Tags */}
          <div className="flex-1 min-w-0 space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-bold uppercase tracking-wider text-slate-400 block">內容描述 Context</label>
              <textarea 
                className="w-full h-32 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none shadow-sm"
                placeholder="輸入一些背景資訊，例如：地點、當前心情..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </div>

            {/* Vision Insight Tags */}
            <div className="space-y-2">
              <label className="text-sm font-bold uppercase tracking-wider text-slate-400 block">AI Vision Insights</label>
              <div className="flex flex-wrap gap-2">
                {results.analyzer.landmark && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-semibold border border-indigo-100 dark:border-indigo-800">
                    <MapPin className="w-3 h-3" /> {results.analyzer.landmark}
                  </span>
                )}
                {results.analyzer.mood && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full text-xs font-semibold border border-amber-100 dark:border-amber-800">
                    <Sparkles className="w-3 h-3" /> {results.analyzer.mood}
                  </span>
                )}
                {results.analyzer.tone && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-indigo-400 rounded-full text-xs font-semibold border border-emerald-100 dark:border-emerald-800">
                    <Palette className="w-3 h-3" /> {results.analyzer.tone}
                  </span>
                )}
                {!results.analyzer.landmark && <span className="text-xs text-slate-400 italic">尚未分析...</span>}
              </div>
            </div>

            <button 
              onClick={generateContent}
              disabled={!previews.length || isLoading}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl font-bold text-lg transition shadow-lg flex items-center justify-center gap-3"
            >
              {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Wand2 className="w-6 h-6" />}
              {isLoading ? '魔法生成中...' : '開始產出草稿'}
            </button>
          </div>
        </section>

        {/* 2x2 Grid Output */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-l-4 border-indigo-600 pl-3">
            <h2 className="text-2xl font-bold tracking-tight m-0">Universal Reviewer 4×1</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-left">
            {Object.entries(results.drafts).map(([platform, content]) => (
              <PlatformCard
                key={platform}
                platform={platform}
                content={content}
                isLoading={isLoading}
                confirmed={confirmed[platform]}
                onConfirm={() => handleConfirm(platform)}
                creds={publishConfig}
                onCredsChange={handleCredsChange}
                onEdit={(val) => setResults({
                  ...results,
                  drafts: { ...results.drafts, [platform]: val }
                })}
              />
            ))}
          </div>

          {/* Publish Bar — only visible when ≥1 platform confirmed */}
          {confirmedPlatforms.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Send className="w-5 h-5 text-indigo-600" />
                    已確認 {confirmedPlatforms.length} 個平台：
                    <span className="text-indigo-600">{confirmedPlatforms.map(p => p === 'xhs' ? '小紅書' : p).join('、')}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">小紅書無公開 API，確認後請手動複製發布。個人帳號透過瀏覽器自動化發布。</p>
                  {/* Per-post account type toggles for Facebook and Instagram */}
                  {(confirmedPlatforms.includes('facebook') || confirmedPlatforms.includes('instagram')) && (
                    <div className="flex flex-wrap gap-3 mt-2">
                      {confirmedPlatforms.includes('facebook') && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500 font-medium">Facebook：</span>
                          {['business', 'personal'].map(t => (
                            <button
                              key={t}
                              onClick={() => handleCredsChange('fbAccountType', t)}
                              className={`px-2.5 py-1 rounded-full border font-medium transition ${
                                (publishConfig.fbAccountType || 'business') === t
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-indigo-400'
                              }`}
                            >
                              {t === 'business' ? '🏢 粉絲專頁' : '👤 個人帳號'}
                            </button>
                          ))}
                        </div>
                      )}
                      {confirmedPlatforms.includes('instagram') && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500 font-medium">Instagram：</span>
                          {['business', 'personal'].map(t => (
                            <button
                              key={t}
                              onClick={() => handleCredsChange('igAccountType', t)}
                              className={`px-2.5 py-1 rounded-full border font-medium transition ${
                                (publishConfig.igAccountType || 'business') === t
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-indigo-400'
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
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg font-bold transition shadow-md shrink-0 ml-4"
                >
                  {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {isPublishing ? '發布中...' : '開始發布'}
                </button>
              </div>

              {/* Per-platform publish results */}
              {Object.keys(publishStatus).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {confirmedPlatforms.map(platform => {
                    const ps = publishStatus[platform];
                    if (!ps) return null;
                    const statusClasses = {
                      success: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                      error: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
                      manual: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
                      loading: 'bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700',
                    };
                    return (
                      <div key={platform} className={`p-3 rounded-lg text-xs border flex flex-col gap-1 ${statusClasses[ps.status] || statusClasses.loading}`}>
                        <div className="font-semibold capitalize flex items-center gap-1">
                          {ps.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {ps.status === 'error' && <AlertCircle className="w-3.5 h-3.5" />}
                          {ps.status === 'manual' && <ClipboardCopy className="w-3.5 h-3.5" />}
                          {ps.status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          {platform === 'xhs' ? '小紅書' : platform}
                        </div>
                        {ps.message && <div className="leading-relaxed">{ps.message}</div>}
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

      <footer className="py-8 text-center text-slate-400 text-xs border-t dark:border-slate-900">
        © 2026 SocialMedia Agent - AI Copywriting for Solo Creators
      </footer>
    </div>
  );
}

export default App;
