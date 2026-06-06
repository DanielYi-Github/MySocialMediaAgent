import React, { useState, useEffect } from 'react';
import { Settings, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import axios from 'axios';
import {
  PROVIDERS,
  buildTestRequest,
  getDefaultConfig,
  normalizeConfig,
  requiresApiKey,
  validateProviderConfig,
} from '../lib/providers';

const DEFAULT_PUBLISH_CONFIG = {
  fbPageToken: '',
  fbPageId: '',
  igUserId: '',
  imgbbKey: '',
};

export default function ConfigDrawer({ isOpen, onClose }) {
  const [config, setConfig] = useState(getDefaultConfig());
  const [publishConfig, setPublishConfig] = useState(DEFAULT_PUBLISH_CONFIG);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [tab, setTab] = useState('llm'); // 'llm' | 'publish'

  useEffect(() => {
    const saved = localStorage.getItem('llm_config');
    if (saved) setConfig(normalizeConfig(JSON.parse(saved)));
    const savedPublish = localStorage.getItem('publish_config');
    if (savedPublish) setPublishConfig(JSON.parse(savedPublish));
  }, []);

  const handleSave = () => {
    try {
      const safeConfig = validateProviderConfig(config);
      localStorage.setItem('llm_config', JSON.stringify(safeConfig));
      setConfig(safeConfig);
      setStatus('idle');
      setErrorMsg('');
    } catch (err) {
      setTab('llm');
      setStatus('error');
      setErrorMsg(err.message);
      return;
    }
    localStorage.setItem('publish_config', JSON.stringify(publishConfig));
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
    setStatus('idle');
    setErrorMsg('');
  };

  const currentProvider = PROVIDERS[config.provider] || PROVIDERS.custom;

  const testConnection = async () => {
    if (requiresApiKey(config.provider) && !config.apiKey) {
      setStatus('error');
      setErrorMsg('此供應商需要 API Key。');
      return;
    }

    setStatus('testing');
    setErrorMsg('');
    try {
      const safeConfig = validateProviderConfig(config);
      const request = buildTestRequest(safeConfig);
      const resp = await axios.post('http://localhost:3001/api/llm/proxy', {
        url: request.url,
        headers: request.headers,
        data: request.data,
      });
      if (resp.status === 200) setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error?.message || err.message);
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
                  onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
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
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
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
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder={currentProvider.model || '輸入模型名稱'}
                />
                <p className="mt-1 text-xs text-amber-500 dark:text-amber-400">⚠ 必須使用支援視覺（圖片輸入）的模型。</p>
              </div>

              <div className="pt-2">
                <button
                  onClick={testConnection}
                  disabled={status === 'testing'}
                  className="flex items-center justify-center gap-2 w-full py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded font-medium transition"
                >
                  {status === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : '測試連線'}
                  {status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  {status === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
                </button>
                {status === 'error' && (
                  <p className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">{errorMsg}</p>
                )}
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
                      <span className="ml-1 text-amber-500">（Instagram 發圖必填）</span>
                    </label>
                    <input
                      type="password"
                      className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      value={publishConfig.imgbbKey}
                      onChange={(e) => setPublishConfig({ ...publishConfig, imgbbKey: e.target.value })}
                      placeholder="從 imgbb.com 免費取得"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      Instagram API 需要圖片公開 URL，用 imgbb 中轉。免費申請：
                      <a href="https://imgbb.com/api" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline ml-0.5">imgbb.com/api</a>
                    </p>
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
