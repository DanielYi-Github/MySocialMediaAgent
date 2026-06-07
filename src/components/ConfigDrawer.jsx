import { useEffect, useState } from 'react';
import { Settings, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import axios from 'axios';
import {
  CAPABILITY_PROBE_STORAGE_KEY,
  buildCapabilityProbeRequest,
  PROVIDERS,
  buildTestRequest,
  getEffectiveProviderCapabilities,
  getDefaultConfig,
  isCapabilityProbeMatch,
  normalizeConfig,
  normalizeCapabilityProbeResponse,
  readStoredCapabilityProbe,
  requiresApiKey,
  validateProviderConfig,
} from '../lib/providers';

const DEFAULT_PUBLISH_CONFIG = {
  fbPageToken: '',
  fbPageId: '',
  igUserId: '',
  imgbbKey: '',
  threadsAccountType: 'personal',
  threadsToken: '',
  threadsUserId: '',
  threadsBusinessToken: '',
  threadsBusinessUserId: '',
  cloudinaryCloudName: '',
  cloudinaryUploadPreset: '',
};

export default function ConfigDrawer({ isOpen, onClose, onSaved, onProbeUpdated, initialTab = 'llm' }) {
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('llm_config');
    return saved ? normalizeConfig(JSON.parse(saved)) : getDefaultConfig();
  });
  const [publishConfig, setPublishConfig] = useState(() => {
    const savedPublish = localStorage.getItem('publish_config');
    return savedPublish ? { ...DEFAULT_PUBLISH_CONFIG, ...JSON.parse(savedPublish) } : DEFAULT_PUBLISH_CONFIG;
  });
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [probeStatus, setProbeStatus] = useState('idle');
  const [capabilityProbeResult, setCapabilityProbeResult] = useState(() => {
    const storedProbe = readStoredCapabilityProbe(localStorage);
    if (storedProbe && isCapabilityProbeMatch(
      localStorage.getItem('llm_config')
        ? normalizeConfig(JSON.parse(localStorage.getItem('llm_config')))
        : getDefaultConfig(),
      storedProbe,
    )) {
      return storedProbe;
    }
    return null;
  });
  const [capabilityProbeError, setCapabilityProbeError] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [tab, setTab] = useState('llm'); // 'llm' | 'publish'

  useEffect(() => {
    if (isOpen) setTab(initialTab);
  }, [initialTab, isOpen]);

  const handleSave = () => {
    try {
      const safeConfig = validateProviderConfig(config);
      localStorage.setItem('llm_config', JSON.stringify(safeConfig));
      setConfig(safeConfig);
      setErrorMsg('');
    } catch (err) {
      setTab('llm');
      setConnectionStatus('error');
      setErrorMsg(err.message);
      return;
    }
    localStorage.setItem('publish_config', JSON.stringify(publishConfig));
    onSaved?.();
    alert('設定已儲存！');
  };

  const updateProvider = (providerId) => {
    const nextDefaults = getDefaultConfig(providerId);
    setConfig((prev) => ({
      ...prev,
      provider: nextDefaults.provider,
      protocol: nextDefaults.protocol,
      baseUrl: nextDefaults.baseUrl,
      model: nextDefaults.model,
    }));
    setConnectionStatus('idle');
    setProbeStatus('idle');
    setCapabilityProbeError('');
    setErrorMsg('');
  };

  const currentProvider = PROVIDERS[config.provider] || PROVIDERS.custom;
  const matchedStoredProbe = readStoredCapabilityProbe(localStorage);
  const resolvedProbeResult = capabilityProbeResult && isCapabilityProbeMatch(config, capabilityProbeResult)
    ? capabilityProbeResult
    : matchedStoredProbe && isCapabilityProbeMatch(config, matchedStoredProbe)
      ? matchedStoredProbe
      : null;
  const effectiveCapabilities = resolvedProbeResult
    ? getEffectiveProviderCapabilities(config, resolvedProbeResult)
    : getEffectiveProviderCapabilities(config, null);

  const updateConfigField = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setConnectionStatus('idle');
    setProbeStatus('idle');
    setCapabilityProbeError('');
    setErrorMsg('');
  };

  const testConnection = async () => {
    if (requiresApiKey(config.provider) && !config.apiKey) {
      setConnectionStatus('error');
      setErrorMsg('此供應商需要 API Key。');
      return;
    }

    setConnectionStatus('testing');
    setProbeStatus('idle');
    setCapabilityProbeResult(null);
    setCapabilityProbeError('');
    setErrorMsg('');
    try {
      const safeConfig = validateProviderConfig(config);
      try {
        const request = buildTestRequest(safeConfig);
        const resp = await axios.post('http://localhost:3001/api/llm/proxy', {
          url: request.url,
          headers: request.headers,
          data: request.data,
        });
        if (resp.status === 200) {
          setConnectionStatus('success');
        }
      } catch (err) {
        const connectionError = err.response?.data?.error?.message || err.message;
        setConnectionStatus('error');
        setErrorMsg(connectionError);
        return;
      }

      setProbeStatus('testing');

      try {
        const probeRequest = buildCapabilityProbeRequest(safeConfig);
        const probeResp = await axios.post('http://localhost:3001/api/llm/proxy', {
          url: probeRequest.url,
          headers: probeRequest.headers,
          data: probeRequest.data,
        });
        const normalizedCapabilities = normalizeCapabilityProbeResponse(safeConfig, probeResp.data);
        const probeRecord = {
          provider: safeConfig.provider,
          baseUrl: safeConfig.baseUrl,
          model: safeConfig.model,
          source: 'probe',
          detectedAt: new Date().toISOString(),
          capabilities: normalizedCapabilities,
        };
        localStorage.setItem(CAPABILITY_PROBE_STORAGE_KEY, JSON.stringify(probeRecord));
        setCapabilityProbeResult(probeRecord);
        setProbeStatus('success');
        onProbeUpdated?.(probeRecord);
      } catch (err) {
        const probeError = err.response?.data?.error?.message || err.message;
        const fallbackRecord = {
          provider: safeConfig.provider,
          baseUrl: safeConfig.baseUrl,
          model: safeConfig.model,
          source: 'static-fallback',
          detectedAt: new Date().toISOString(),
          capabilities: getEffectiveProviderCapabilities(safeConfig, null),
        };
        localStorage.setItem(CAPABILITY_PROBE_STORAGE_KEY, JSON.stringify(fallbackRecord));
        setCapabilityProbeResult(fallbackRecord);
        setProbeStatus('fallback');
        setCapabilityProbeError(probeError);
        onProbeUpdated?.(fallbackRecord);
      }
    } catch (err) {
      setConnectionStatus('error');
      setErrorMsg(err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden text-left font-sans">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-96 bg-white shadow-xl flex flex-col dark:bg-slate-900 dark:text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b dark:border-slate-700 flex-shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5" /> 設定
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded dark:hover:bg-slate-800">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b dark:border-slate-700 flex-shrink-0">
          <button
            onClick={() => setTab('llm')}
            className={`flex-1 py-2.5 text-sm font-medium transition ${tab === 'llm' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            🤖 LLM 設定
          </button>
          <button
            onClick={() => setTab('publish')}
            className={`flex-1 py-2.5 text-sm font-medium transition ${tab === 'publish' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            📢 發文設定
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'llm' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">LLM Provider</label>
                <select
                  className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 text-sm"
                  value={config.provider}
                  onChange={(e) => updateProvider(e.target.value)}
                >
                  {Object.values(PROVIDERS).map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{currentProvider.description}</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">API Base URL</label>
                <input
                  type="text"
                  className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-sm"
                  value={config.baseUrl}
                  onChange={(e) => updateConfigField('baseUrl', e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">可依供應商文件自由調整 endpoint；公開 provider 請使用 HTTPS，本機 provider 可用 localhost HTTP。</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">API Key</label>
                <input
                  type="password"
                  className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-sm"
                  value={config.apiKey}
                  onChange={(e) => updateConfigField('apiKey', e.target.value)}
                  placeholder={currentProvider.apiKeyPlaceholder}
                />
                {!requiresApiKey(config.provider) && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">此供應商可不填 API Key。</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Model Name</label>
                <input
                  type="text"
                  className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-sm"
                  value={config.model}
                  onChange={(e) => updateConfigField('model', e.target.value)}
                  placeholder={currentProvider.model || '輸入模型名稱'}
                />
                <p className="mt-1 text-xs text-amber-500 dark:text-amber-400">⚠ 必須使用支援視覺（圖片輸入）的模型。</p>
              </div>

              <div className="pt-2">
                <button
                  onClick={testConnection}
                  disabled={connectionStatus === 'testing' || probeStatus === 'testing'}
                  className="flex items-center justify-center gap-2 w-full py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded font-medium transition"
                >
                  {connectionStatus === 'testing' || probeStatus === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : '測試連線'}
                  {connectionStatus === 'success' && probeStatus !== 'testing' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  {connectionStatus === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
                </button>
                {connectionStatus === 'error' && (
                  <p className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">{errorMsg}</p>
                )}
                <CapabilityProbePanel
                  connectionStatus={connectionStatus}
                  probeStatus={probeStatus}
                  capabilityProbeResult={resolvedProbeResult}
                  capabilityProbeError={capabilityProbeError}
                  effectiveCapabilities={effectiveCapabilities}
                />
              </div>
            </div>
          )}

          {tab === 'publish' && (
            <div className="space-y-5">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300 space-y-1.5">
                <p className="font-semibold">Facebook / Instagram 商業帳號 API 憑證</p>
                <p>⚠ <strong>Facebook</strong>：API 僅支援<strong>粉絲專頁（Page）</strong>發文，個人 Profile 無法透過 API 發文，此為 Meta 平台限制。</p>
                <p>⚠ <strong>Instagram</strong>：需為<strong>商業或創作者帳號</strong>（純個人帳號不支援 Content Publishing API）。此處填的是商業帳號（連結 FB 粉絲專頁）流程；創作者帳號請在各平台卡片的「⚙ API 憑證設定」中切換填入。</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span className="w-5 h-5 bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center rounded">fb</span>
                  Facebook 設定
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">Page Access Token</label>
                    <input
                      type="password"
                      className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      value={publishConfig.fbPageToken}
                      onChange={(e) => setPublishConfig({ ...publishConfig, fbPageToken: e.target.value })}
                      placeholder="EAAxxxxxx..."
                    />
                    <p className="mt-0.5 text-[10px] text-slate-400">在 Graph API Explorer 中取得 pages_manage_posts 權限的 Token</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">Page ID</label>
                    <input
                      type="text"
                      className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      value={publishConfig.fbPageId}
                      onChange={(e) => setPublishConfig({ ...publishConfig, fbPageId: e.target.value })}
                      placeholder="123456789012345"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400">IG</div>
                  Instagram 設定
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">Instagram Business User ID</label>
                    <input
                      type="text"
                      className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      value={publishConfig.igUserId}
                      onChange={(e) => setPublishConfig({ ...publishConfig, igUserId: e.target.value })}
                      placeholder="17841xxxxxxxxxx"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-400">商業帳號（需連結至 Facebook 粉絲專頁）的 IG 用戶 ID。創作者帳號請改用各平台卡片的「⚙ API 憑證設定」。</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">
                      imgbb API Key
                      <span className="ml-1 text-amber-500">（純圖片 API 發布必填）</span>
                    </label>
                    <input
                      type="password"
                      className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      value={publishConfig.imgbbKey}
                      onChange={(e) => setPublishConfig({ ...publishConfig, imgbbKey: e.target.value })}
                      placeholder="從 imgbb.com 免費取得"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      純圖片 API 發布可用 imgbb 中轉公開 URL。免費申請：
                      <a href="https://imgbb.com/api" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline ml-0.5">imgbb.com/api</a>
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span className="w-5 h-5 bg-black text-white text-[10px] font-bold flex items-center justify-center rounded-full">T</span>
                  Threads API 設定
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">帳號型態</label>
                    <div className="flex gap-2">
                      {['personal', 'business'].map((type) => (
                        <button
                          type="button"
                          key={type}
                          onClick={() => setPublishConfig({ ...publishConfig, threadsAccountType: type })}
                          className={`px-3 py-2 rounded-lg text-xs border ${
                            (publishConfig.threadsAccountType || 'personal') === type
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {type === 'personal' ? '個人帳號' : '商業帳號'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(publishConfig.threadsAccountType || 'personal') === 'business' ? (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">Threads Business Access Token</label>
                        <input
                          type="password"
                          className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                          value={publishConfig.threadsBusinessToken}
                          onChange={(e) => setPublishConfig({ ...publishConfig, threadsBusinessToken: e.target.value })}
                          placeholder="THQWJRxxxxxx..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">Threads Business User ID</label>
                        <input
                          type="text"
                          className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                          value={publishConfig.threadsBusinessUserId}
                          onChange={(e) => setPublishConfig({ ...publishConfig, threadsBusinessUserId: e.target.value })}
                          placeholder="1234567890"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">Threads Access Token</label>
                        <input
                          type="password"
                          className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                          value={publishConfig.threadsToken}
                          onChange={(e) => setPublishConfig({ ...publishConfig, threadsToken: e.target.value })}
                          placeholder="THQWJRxxxxxx..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">Threads User ID</label>
                        <input
                          type="text"
                          className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                          value={publishConfig.threadsUserId}
                          onChange={(e) => setPublishConfig({ ...publishConfig, threadsUserId: e.target.value })}
                          placeholder="1234567890"
                        />
                      </div>
                    </>
                  )}

                  <details className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-500 dark:text-slate-400">
                    <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200">Threads Token / User ID 取得指引</summary>
                    <div className="mt-2 space-y-1.5 leading-relaxed">
                      <p>1. 到 Meta for Developers 建立或選擇 App，加入 Threads API 或 Threads use case。</p>
                      <p>2. 到 Graph API Explorer，右上角主機選擇 graph.threads.net，勾選 threads_basic 與 threads_content_publish。</p>
                      <p>3. 產生 Access Token 後，在 Explorer 呼叫 /me 取得 id，填入 Threads User ID。</p>
                      <p>4. 純圖片貼文需要 imgbb 公開圖片網址；單支影片或混合素材需要 Cloudinary 公開媒體網址。</p>
                      <p>5. 多素材會走 Threads carousel，單次需介於 2-20 個素材。</p>
                      <p>
                        入口：
                        <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline ml-1">Graph API Explorer</a>
                      </p>
                    </div>
                  </details>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span className="w-5 h-5 bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center rounded">cl</span>
                  Cloudinary 影片中轉設定
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">Cloud Name</label>
                    <input
                      type="text"
                      className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      value={publishConfig.cloudinaryCloudName}
                      onChange={(e) => setPublishConfig({ ...publishConfig, cloudinaryCloudName: e.target.value })}
                      placeholder="your-cloud-name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-slate-600 dark:text-slate-400">
                      Unsigned Upload Preset
                      <span className="ml-1 text-amber-500">（API 發影片或混合素材必填）</span>
                    </label>
                    <input
                      type="text"
                      className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      value={publishConfig.cloudinaryUploadPreset}
                      onChange={(e) => setPublishConfig({ ...publishConfig, cloudinaryUploadPreset: e.target.value })}
                      placeholder="unsigned-upload-preset"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      API 發布影片需要公開 HTTPS URL；請使用 unsigned upload preset，不要在前端放 API Secret。
                    </p>
                    <details className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-500 dark:text-slate-400">
                      <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200">Cloudinary Cloud Name / Upload Preset 取得指引</summary>
                      <div className="mt-2 space-y-1.5 leading-relaxed">
                        <p>1. 到 Cloudinary Dashboard 複製 Cloud Name。</p>
                        <p>2. 到 Settings / Upload / Upload presets 建立 unsigned preset。</p>
                        <p>3. 只填 preset name，不要在前端填 API Secret。</p>
                        <p>
                          入口：
                          <a href="https://cloudinary.com/console" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline ml-1">Cloudinary Console</a>
                        </p>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Save Button */}
        <div className="px-6 py-4 border-t dark:border-slate-700 flex-shrink-0">
          <button
            onClick={handleSave}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition shadow-md"
          >
            儲存所有設定
          </button>
        </div>
      </div>
    </div>
  );
}

function CapabilityProbePanel({
  connectionStatus,
  probeStatus,
  capabilityProbeResult,
  capabilityProbeError,
  effectiveCapabilities,
}) {
  if (connectionStatus === 'idle' && probeStatus === 'idle' && !capabilityProbeResult) return null;

  const capabilityItems = [
    { key: 'supportsToolUse', label: '工具使用' },
    { key: 'supportsText', label: '文字理解' },
    { key: 'supportsImage', label: '圖片理解' },
    { key: 'supportsVideo', label: '影片理解' },
    { key: 'supportsMultimodal', label: '多模態' },
  ];

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/20 p-3 space-y-3">
      {probeStatus === 'testing' && (
        <p className="text-xs text-indigo-500 dark:text-indigo-300">正在檢測模型能力...</p>
      )}

      {capabilityProbeResult && (
        <>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">模型自我回報能力</p>
            <div className="flex flex-wrap gap-2">
              {capabilityItems.map((item) => (
                <span
                  key={item.key}
                  className={`px-2 py-1 rounded-full text-[11px] font-medium border ${
                    capabilityProbeResult.capabilities?.[item.key]
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800'
                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                  }`}
                >
                  {item.label}：{capabilityProbeResult.capabilities?.[item.key] ? '支援' : '不支援'}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {capabilityProbeResult.capabilities?.summary || '無摘要'}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">目前前端實際採用的能力判斷</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              來源：{capabilityProbeResult.source === 'probe' ? '模型自我回報' : '靜態預設 fallback'}
            </p>
            <div className="flex flex-wrap gap-2">
              {capabilityItems.map((item) => (
                <span
                  key={`effective-${item.key}`}
                  className={`px-2 py-1 rounded-full text-[11px] font-medium border ${
                    effectiveCapabilities?.[item.key]
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800'
                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                  }`}
                >
                  {item.label}：{effectiveCapabilities?.[item.key] ? '啟用' : '停用'}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {probeStatus === 'fallback' && (
        <p className="text-xs text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
          偵測失敗，已回退為預設能力判斷。{capabilityProbeError ? `原因：${capabilityProbeError}` : ''}
        </p>
      )}
    </div>
  );
}
