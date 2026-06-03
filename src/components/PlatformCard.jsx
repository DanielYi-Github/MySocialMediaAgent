import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Copy, Globe2, Check, ChevronDown, ChevronUp, Eye, EyeOff, ExternalLink, Info, Terminal, Sparkles } from 'lucide-react';

const XHS_SERVER = 'http://localhost:3001';

// Generic browser-automation login widget — used for XHS, Facebook personal, Instagram personal
function BrowserLoginWidget({ statusUrl, loginUrl, platformLabel, accentColor = 'red' }) {
  const [status, setStatus] = useState('unknown');
  const [msg, setMsg] = useState('');

  useEffect(() => { checkStatus(); }, []);

  const checkStatus = async () => {
    setStatus('checking');
    setMsg('');
    try {
      const res = await axios.get(`${XHS_SERVER}${statusUrl}`, { timeout: 20000 });
      setStatus(res.data.loggedIn ? 'logged_in' : 'not_logged_in');
    } catch {
      setStatus('server_offline');
    }
  };

  const handleLogin = async () => {
    setStatus('logging_in');
    setMsg('');
    try {
      await axios.post(`${XHS_SERVER}${loginUrl}`, {}, { timeout: 320000 });
      setStatus('logged_in');
    } catch (err) {
      setStatus('not_logged_in');
      setMsg(err.response?.data?.error || err.message || '登入失敗，請重試。');
    }
  };

  const labels = {
    unknown: '—',
    checking: '檢查中...',
    logged_in: '已登入 ✓',
    not_logged_in: '未登入',
    logging_in: '等待登入中...',
    server_offline: '後台服務未啟動',
  };
  const colors = {
    logged_in: 'text-emerald-500',
    not_logged_in: 'text-amber-500',
    server_offline: 'text-red-500',
    checking: 'text-slate-400',
    logging_in: 'text-indigo-500',
    unknown: 'text-slate-400',
  };

  const accentClasses = {
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30',
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/30',
    pink: 'bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-200 dark:border-fuchsia-700 hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/30',
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-slate-500 dark:text-slate-400">登入狀態</span>
        <span className={`font-semibold ${colors[status]}`}>{labels[status]}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleLogin}
          disabled={status === 'logging_in' || status === 'server_offline'}
          className={`flex-1 py-1.5 text-[11px] font-medium border rounded-md disabled:opacity-40 transition ${accentClasses[accentColor] || accentClasses.red}`}
        >
          {status === 'logging_in' ? '等待瀏覽器登入...' : `登入 ${platformLabel}`}
        </button>
        <button
          type="button"
          onClick={checkStatus}
          disabled={status === 'checking' || status === 'logging_in'}
          className="px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 border dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition"
        >
          刷新
        </button>
      </div>
      {status === 'server_offline' && (
        <p className="text-[11px] text-red-500 dark:text-red-400">
          後台服務未啟動，請執行 <code className="bg-red-50 dark:bg-red-900/30 px-1 py-0.5 rounded font-mono">npm run dev:all</code>
        </p>
      )}
      {msg && <p className="text-[11px] text-red-500 dark:text-red-400">{msg}</p>}
    </div>
  );
}

// Backwards-compat alias for XHS
function XhsLoginWidget() {
  return <BrowserLoginWidget statusUrl="/api/xhs/status" loginUrl="/api/xhs/login" platformLabel="小紅書" accentColor="red" />;
}

const icons = {
  instagram: <div className="w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400">IG</div>,
  xhs: <div className="w-5 h-5 bg-red-600 text-white flex items-center justify-center text-[10px] font-bold rounded">紅</div>,
  facebook: <Globe2 className="w-5 h-5 text-blue-600" />,
  threads: <div className="w-5 h-5 bg-black text-white flex items-center justify-center rounded-full text-[10px] font-bold">T</div>,
};

// Per-platform credential config
const PLATFORM_CONFIG = {
  facebook: {
    apiSupported: true,
    accountTypeKey: 'fbAccountType',
    accountTypes: [
      {
        key: 'business',
        label: '粉絲專頁',
        fields: [
          { key: 'fbPageToken', label: 'Page Access Token', type: 'password', placeholder: 'EAAxxxxxxx...' },
          { key: 'fbPageId', label: 'Page ID', type: 'text', placeholder: '123456789012345' },
          { key: 'imgbbKey', label: 'imgbb API Key（發圖必填）', type: 'password', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', hint: '圖片需先上傳至 imgbb 才能發布。免費申請：imgbb.com' },
        ],
        guide: {
          title: '粉絲專頁（Business API）設定',
          steps: [
            { step: '1', text: '前往 Meta 開發者平台，點擊「建立應用程式」，類型選「其他」→「商業」，填入名稱後建立', link: { label: 'developers.facebook.com/apps', url: 'https://developers.facebook.com/apps' } },
            { step: '2', text: '在應用程式儀表板左側點擊「加入產品」，加入「Graph API」與「粉絲專頁（Pages）」產品' },
            { step: '3', text: '前往「工具」→「Graph API 測試工具」，右上角選擇你的應用程式', link: { label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer' } },
            { step: '4', text: '點擊「產生存取權杖」→ 選擇你的 Facebook 粉絲專頁，勾選權限：pages_manage_posts、pages_read_engagement，點擊「產生」' },
            { step: '5', text: '複製產生的 Page Access Token（注意：這是 Page Token，不是 User Token）' },
            { step: '6', text: '在你的粉絲專頁「關於（About）」頁面最底部可找到純數字的 Page ID' },
          ],
          note: '短效 Token 僅 1 小時有效。建議到「存取權杖偵錯工具」→「延長存取權杖」換成長效版本（60 天）。',
        },
      },
      {
        key: 'personal',
        label: '個人帳號',
        fields: [],
        guide: {
          title: '個人帳號設定（瀏覽器自動化）',
          steps: [
            { step: '1', text: '安裝服務依賴（一次性）：執行 npm install，完成後執行 npm run setup:xhs 下載 Chromium' },
            { step: '2', text: '改用 npm run dev:all 啟動專案（同時啟動前端 + 自動化後台服務）' },
            { step: '3', text: '展開上方「⚙ API 憑證設定」，點擊「登入 Facebook」→ 瀏覽器視窗自動彈出，手動完成登入後視窗自動關閉' },
            { step: '4', text: '狀態顯示「已登入 ✓」後即可使用自動發文，後續無需重複登入' },
          ],
          note: '此功能透過瀏覽器自動化模擬操作（非官方 API）。Facebook 官方 Graph API 不支援個人帳號發文，請注意這可能違反 Facebook 使用規則。',
        },
      },
    ],
  },
  instagram: {
    apiSupported: true,
    accountTypeKey: 'igAccountType',
    accountTypes: [
      {
        key: 'business',
        label: '商業帳號',
        fields: [
          { key: 'fbPageToken', label: 'Facebook Page Access Token', type: 'password', placeholder: 'EAAxxxxxxx...（與 Facebook 共用同一組）' },
          { key: 'igUserId', label: 'Instagram Business 帳號 ID', type: 'text', placeholder: '17841xxxxxxxxxx' },
          { key: 'imgbbKey', label: 'imgbb API Key（發圖必填）', type: 'password', placeholder: '從 imgbb.com 免費申請', link: { label: 'api.imgbb.com', url: 'https://api.imgbb.com' } },
        ],
        guide: {
          title: '商業帳號 API 設定（Facebook Login，需 FB 粉絲專頁）',
          steps: [
            { step: '1', text: '確認 Instagram 帳號已切換為「商業帳號」（IG App → 設定 → 帳號 → 切換為專業帳號 → 商業）' },
            { step: '2', text: '進入 Facebook 粉絲專頁設定 → Instagram → 連結你的 Instagram 商業帳號' },
            { step: '3', text: '前往 Meta 開發者平台，使用案例選「管理 Instagram 訊息和內容」→ 選擇「含有 Facebook 登入的 API 設定」→ 點擊「新增所有必要權限」', link: { label: 'developers.facebook.com/apps', url: 'https://developers.facebook.com/apps' } },
            { step: '4', text: '系統自動新增以下必要權限（缺任一都會發文失敗）：business_management、instagram_basic、instagram_content_publishing、pages_read_engagement、pages_show_list' },
            { step: '5', text: '前往 Graph API Explorer，選擇你的應用程式，勾選上述所有權限，點擊「產生存取權杖」取得 Page Access Token', link: { label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer' } },
            { step: '6', text: '取得 IG 商業帳號 ID：在 Explorer 執行 GET /{page-id}?fields=instagram_business_account，複製回傳的 instagram_business_account.id 值' },
            { step: '7', text: '前往 imgbb.com 免費申請 API Key（Instagram API 要求圖片必須為公開 HTTPS URL）', link: { label: 'api.imgbb.com', url: 'https://api.imgbb.com' } },
          ],
          note: '需要 Facebook 粉絲專頁並連結 IG 商業帳號，適合品牌或企業。請確認：① 在 Graph API Explorer 產生的是 Page Access Token（通常以 "EAA" 開頭），而非 User Token；② Instagram Business ID 請從 GET /{page-id}?fields=instagram_business_account 取得；③ 圖片需為 JPEG，8MB 以內且為公開 HTTPS URL（可使用 imgbb 取得）。如要讓他人帳號授權此 App 發文（非僅限自己），需提交 App Review。',
        },
      },
      {
        key: 'personal',
        label: '個人帳號',
        fields: [],
        guide: {
          title: '個人帳號設定（瀏覽器自動化）',
          steps: [
            { step: '1', text: '安裝服務依賴（一次性）：執行 npm install，完成後執行 npm run setup:xhs 下載 Chromium' },
            { step: '2', text: '改用 npm run dev:all 啟動專案（同時啟動前端 + 自動化後台服務）' },
            { step: '3', text: '點擊「登入 Instagram」→ 瀏覽器視窗自動彈出，手動完成登入後視窗自動關閉' },
            { step: '4', text: '狀態顯示「已登入 ✓」後即可使用自動發文，後續無需重複登入' },
          ],
          note: '此功能透過瀏覽器自動化模擬操作（非官方 API），支援所有類型的 Instagram 個人帳號。發文時會短暫彈出瀏覽器視窗，完成後自動關閉。請注意這可能違反 Instagram 使用規則。',
        },
      },
    ],
  },
  xhs: {
    apiSupported: true,
    fields: [], // No API key — auth handled via saved browser profile
    guide: {
      title: '小紅書自動發文設定（瀏覽器自動化）',
      steps: [
        { step: '1', text: '安裝服務依賴（一次性）：在專案目錄執行 npm install，安裝完成後再執行 npm run setup:xhs 下載 Chromium 瀏覽器' },
        { step: '2', text: '改用 npm run dev:all 啟動專案（同時啟動前端 + 小紅書後台自動化服務）' },
        { step: '3', text: '展開上方「⚙ API 憑證設定」，點擊「登入小紅書」→ 瀏覽器視窗自動彈出，手動完成登入後視窗自動關閉' },
        { step: '4', text: '狀態顯示「已登入 ✓」後即可使用自動發文功能，後續無需重複登入' },
      ],
      note: '此功能透過瀏覽器自動化模擬操作（非官方 API），登入狀態保存在本機，通常長期有效。發文時會短暫彈出瀏覽器視窗，完成後自動關閉。圖片建議提供 JPEG 格式。',
    },
  },
  threads: {
    apiSupported: true,
    accountTypeKey: 'threadsAccountType',
    accountTypes: [
      {
        key: 'personal',
        label: '個人帳號',
        fields: [
          { key: 'threadsToken', label: 'Threads 用戶存取權杖', type: 'password', placeholder: 'THQWJRxxxxxxx...（長效 60 天）' },
          { key: 'threadsUserId', label: 'Threads 用戶 ID', type: 'text', placeholder: '1234567890' },
          { key: 'imgbbKey', label: 'imgbb API Key（發圖必填，可與 IG 共用）', type: 'password', placeholder: '從 imgbb.com 免費申請', link: { label: 'api.imgbb.com', url: 'https://api.imgbb.com' } },
        ],
        guide: {
          title: '個人 Threads 帳號 API 設定',
          steps: [
            { step: '1', text: '前往 Meta 開發者平台 → 點擊「建立應用程式」→ 使用案例選「存取 Threads API」→ 填入應用程式名稱後建立', link: { label: 'developers.facebook.com/apps', url: 'https://developers.facebook.com/apps' } },
            { step: '2', text: '進入應用程式儀表板 → 使用案例 → 自訂 → 點擊「設定」，必須新增以下三個網址後點擊「儲存」：① 有效的 OAuth 重新導向 URI（測試用填 https://localhost）② 取消授權回呼網址 ③ 資料刪除要求網址' },
            { step: '3', text: '點擊「新增或移除 Threads 測試人員」→ 點擊「新增用戶」→ 角色選「Threads 測試人員」，搜尋並加入你的 Threads 帳號（每個 App 上限 25 人）' },
            { step: '4', text: '以 Threads 帳號登入 threads.net → 帳號設定 → 網站 → 找到開發者邀請，點擊「接受」', link: { label: 'threads.net/settings/account', url: 'https://www.threads.net/settings/account' } },
            { step: '5', text: '前往 Graph API Explorer → 右上角主機選「graph.threads.net」→ 選擇你的 Threads App → 勾選 threads_basic 和 threads_content_publish → 點擊「產生存取權杖」', link: { label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer' } },
            { step: '6', text: '取得 Threads 用戶 ID：在 Explorer 執行 GET /me，複製回傳 JSON 中的 id 值' },
            { step: '7', text: '換成長效 Token（60 天）：在 Explorer Token 旁點「ℹ」→「在存取權杖偵錯工具中開啟」→ 點擊「延長存取權杖」', link: { label: '存取權杖偵錯工具', url: 'https://developers.facebook.com/tools/debug/accesstoken/' } },
          ],
          note: 'Threads API 個人/商業帳號皆可使用，開發期間不需 App Review。Token 到期前可呼叫以下 API 續期（60 天）：GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token={your_token}',
        },
      },
      {
        key: 'business',
        label: '商業帳號',
        fields: [
          { key: 'threadsBusinessToken', label: 'Threads 商業帳號存取權杖', type: 'password', placeholder: 'THQWJRxxxxxxx...' },
          { key: 'threadsBusinessUserId', label: 'Threads 商業帳號用戶 ID', type: 'text', placeholder: '1234567890' },
          { key: 'imgbbKey', label: 'imgbb API Key（發圖必填，可與 IG 共用）', type: 'password', placeholder: '從 imgbb.com 免費申請', link: { label: 'api.imgbb.com', url: 'https://api.imgbb.com' } },
        ],
        guide: {
          title: '商業 Threads 帳號 API 設定',
          steps: [
            { step: '1', text: '流程與個人帳號相同，改用你的商業 Threads 帳號操作' },
            { step: '2', text: '在 Meta 開發者平台建立應用程式，使用案例選「存取 Threads API」，並設定 OAuth redirect URI 等三個必要網址', link: { label: 'developers.facebook.com/apps', url: 'https://developers.facebook.com/apps' } },
            { step: '3', text: '加入「Threads 測試人員」角色，以商業 Threads 帳號登入 threads.net → 帳號設定 → 網站，接受邀請', link: { label: 'threads.net/settings/account', url: 'https://www.threads.net/settings/account' } },
            { step: '4', text: '在 Graph API Explorer（主機選 graph.threads.net）以商業帳號產生 Token，勾選 threads_basic + threads_content_publish', link: { label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer' } },
            { step: '5', text: '取得用戶 ID：執行 GET /me，複製 id 值。換成長效 Token（60 天）' },
          ],
          note: '商業帳號使用相同 API，只是以商業 Threads 帳號授權。Token 續期：GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token={your_token}',
        },
      },
    ],
  },
};

function CredentialField({ fieldCfg, value, onChange }) {
  const [visible, setVisible] = useState(false);
  const isPassword = fieldCfg.type === 'password';

  return (
    <div>
      <label className="flex items-center justify-between text-[11px] font-medium mb-1 text-slate-500 dark:text-slate-400">
        <span>{fieldCfg.label}</span>
        {fieldCfg.link && (
          <a href={fieldCfg.link.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-indigo-500 hover:text-indigo-600">
            {fieldCfg.link.label} <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </label>
      <div className="relative">
        <input
          type={isPassword && !visible ? 'password' : 'text'}
          value={value || ''}
          onChange={(e) => onChange(fieldCfg.key, e.target.value)}
          placeholder={fieldCfg.placeholder}
          className="w-full pr-8 pl-2.5 py-1.5 text-[11px] font-mono border rounded-md dark:bg-slate-700 dark:border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-400 placeholder:text-slate-300 dark:placeholder:text-slate-500"
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        )}
      </div>
      {fieldCfg.hint && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{fieldCfg.hint}</p>
      )}
    </div>
  );
}

const glowClasses = {
  instagram: 'hover:glow-instagram hover:scale-[1.02] hover:border-fuchsia-500/30 dark:hover:border-fuchsia-500/20',
  xhs: 'hover:glow-xhs hover:scale-[1.02] hover:border-red-500/30 dark:hover:border-red-500/20',
  facebook: 'hover:glow-facebook hover:scale-[1.02] hover:border-blue-500/30 dark:hover:border-blue-500/20',
  threads: 'hover:glow-threads hover:scale-[1.02] hover:border-slate-300/30 dark:hover:border-slate-700/20',
};

export default function PlatformCard({ 
  platform, 
  content, 
  onEdit, 
  isLoading, 
  isPlatformLoading, 
  confirmed, 
  onConfirm, 
  creds, 
  onCredsChange,
  onRegenerate,
  defaultSystemPrompt,
  defaultUserPrompt
}) {
  const [showCreds, setShowCreds] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [localSysPrompt, setLocalSysPrompt] = useState(defaultSystemPrompt || '');
  const [localUserPrompt, setLocalUserPrompt] = useState(defaultUserPrompt || '');

  useEffect(() => {
    setLocalSysPrompt(defaultSystemPrompt || '');
    setLocalUserPrompt(defaultUserPrompt || '');
  }, [defaultSystemPrompt, defaultUserPrompt]);

  useEffect(() => {
    if (confirmed) {
      setShowCreds(true);
    }
  }, [confirmed]);

  const cfg = PLATFORM_CONFIG[platform];
  const activeAt = cfg.accountTypes
    ? (cfg.accountTypes.find(at => at.key === creds?.[cfg.accountTypeKey]) ?? cfg.accountTypes[0])
    : null;
  const effectiveFields = activeAt ? activeAt.fields : (cfg.fields ?? []);
  const effectiveGuide = activeAt ? activeAt.guide : cfg.guide;
  const hasFields = effectiveFields.length > 0;

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
  };

  return (
    <div className={`flex flex-col bg-white/60 dark:bg-slate-900/60 border-2 rounded-2xl shadow-md transition-all duration-300 backdrop-blur-md ${
      confirmed
        ? 'border-emerald-500 dark:border-emerald-500 shadow-emerald-500/5'
        : `border-transparent dark:border-slate-800/80 hover:shadow-xl ${glowClasses[platform] || ''}`
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="flex items-center gap-2 select-none">
          {icons[platform]}
          <span className="font-bold capitalize text-slate-800 dark:text-slate-200">{platform === 'xhs' ? '小紅書' : platform}</span>
          {confirmed && (
            <span className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-500">
              <Check className="w-3 h-3" /> 已確認
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {/* Toggle local prompt editor */}
          <button
            onClick={() => setShowPromptEditor(!showPromptEditor)}
            disabled={isLoading}
            className={`p-1.5 rounded-lg transition disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed ${
              showPromptEditor 
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold border border-indigo-200/40' 
                : 'text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
            }`}
            title="編輯此平台提示詞"
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
          
          {/* Single platform regenerate */}
          <button
            onClick={() => onRegenerate(localSysPrompt, localUserPrompt)}
            disabled={isLoading || (!content && !localSysPrompt)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition text-slate-400 hover:text-indigo-500 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            title="針對此平台重新生成文案"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>

          {/* Copy */}
          <button
            onClick={handleCopy}
            disabled={!content}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition text-slate-400 hover:text-indigo-500 disabled:opacity-30 cursor-pointer"
            title="複製文案"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Local Prompt Editor (Shown above content area) */}
      {showPromptEditor && (
        <div className="bg-slate-50/60 dark:bg-slate-950/40 p-3 border-b border-slate-200/50 dark:border-slate-800/50 space-y-2.5 text-left">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black tracking-wider text-indigo-500 dark:text-indigo-400 uppercase flex items-center gap-1 select-none">
              <Terminal className="w-3 h-3" /> 編輯此平台提示詞
            </span>
            <button 
              type="button" 
              onClick={() => setShowPromptEditor(false)}
              className="text-[9px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold transition"
            >
              收起
            </button>
          </div>
          <div className="space-y-1.5">
            <div>
              <span className="text-[9px] font-black text-slate-400/80 block mb-0.5 select-none">SYSTEM PROMPT</span>
              <textarea
                className="w-full h-24 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-[10px] font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-y text-slate-700 dark:text-slate-350"
                value={localSysPrompt}
                onChange={(e) => setLocalSysPrompt(e.target.value)}
                placeholder="編輯此平台專用 System Prompt..."
              />
            </div>
            <div>
              <span className="text-[9px] font-black text-slate-400/80 block mb-0.5 select-none">USER PROMPT</span>
              <textarea
                className="w-full h-16 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-[10px] font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-y text-slate-700 dark:text-slate-355"
                value={localUserPrompt}
                onChange={(e) => setLocalUserPrompt(e.target.value)}
                placeholder="編輯此平台專用 User Prompt..."
              />
            </div>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 p-4 flex flex-col min-h-[220px]">
        {isLoading ? (
          <div className="space-y-3 animate-pulse flex-1 flex flex-col justify-center">
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-3/4"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-5/6"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-2/3"></div>
          </div>
        ) : (
          <textarea
            className="w-full flex-1 bg-transparent resize-none focus:outline-none rounded p-1 text-sm leading-relaxed overflow-y-auto"
            value={content}
            onChange={(e) => onEdit(e.target.value)}
            placeholder="尚未生成文案..."
          />
        )}
      </div>

      {/* Confirm Button */}
      <div className="px-4 pb-3">
        <button
          onClick={onConfirm}
          disabled={!content || isLoading}
          className={`w-full py-2 rounded-xl text-sm font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed ${
            confirmed
              ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm shadow-emerald-500/10'
              : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-800 disabled:opacity-40'
          }`}
        >
          {confirmed ? <><Check className="w-4 h-4" /> 已確認草稿</> : '確認此草稿'}
        </button>
      </div>

      {/* Credentials & Guide Toggle */}
      <div className="border-t border-slate-200/60 dark:border-slate-800/60">
        <button
          onClick={() => setShowCreds(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
        >
          <span className="flex items-center gap-1.5">
            {cfg.apiSupported ? '⚙ API 憑證設定' : '📋 發布指引'}
          </span>
          {showCreds ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showCreds && (
          <div className="px-4 pb-4 space-y-3">
            {/* API not supported notice */}
            {!cfg.apiSupported && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-xl px-3 py-2.5 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>此平台無官方 API，僅支援手動發布。</span>
              </div>
            )}

            {/* XHS: browser automation login widget */}
            {platform === 'xhs' && cfg.apiSupported && (
              <XhsLoginWidget />
            )}

            {/* Facebook personal: browser automation login widget */}
            {platform === 'facebook' && activeAt?.key === 'personal' && cfg.apiSupported && (
              <BrowserLoginWidget
                statusUrl="/api/fb/status"
                loginUrl="/api/fb/login"
                platformLabel="Facebook"
                accentColor="blue"
              />
            )}

            {/* Instagram personal: browser automation login widget */}
            {platform === 'instagram' && activeAt?.key === 'personal' && cfg.apiSupported && (
              <BrowserLoginWidget
                statusUrl="/api/ig/status"
                loginUrl="/api/ig/login"
                platformLabel="Instagram"
                accentColor="pink"
              />
            )}

            {/* Account type selector (IG + Threads) */}
            {cfg.accountTypes && (
              <div className="flex gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200/20 dark:border-slate-800/20">
                {
                  (['business', 'personal']).map(key => {
                    const at = cfg.accountTypes.find(a => a.key === key) || cfg.accountTypes[0];
                    if (!at) return null;
                    return (
                      <button
                        key={at.key}
                        type="button"
                        onClick={() => { onCredsChange(cfg.accountTypeKey, at.key); setShowGuide(false); }}
                        className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                          activeAt.key === at.key
                            ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >
                        {at.label}
                      </button>
                    );
                  })
                }
              </div>
            )}

            {/* Credential fields (other API platforms) */}
            {platform !== 'xhs' && hasFields && (
              <div className="space-y-2.5">
                {effectiveFields.map(field => (
                  <CredentialField
                    key={field.key}
                    fieldCfg={field}
                    value={creds?.[field.key]}
                    onChange={onCredsChange}
                  />
                ))}
                <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1 pt-0.5">
                  <span>✓</span> 以上資料已自動儲存至本機，重新整理後仍保留。
                </p>
              </div>
            )}

            {/* Step-by-step guide */}
            {effectiveGuide && (
              <div>
                <button
                  onClick={() => setShowGuide(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-500 hover:text-indigo-600 transition cursor-pointer"
                >
                  <Info className="w-3 h-3" />
                  {showGuide ? '收起操作指引' : effectiveGuide.title}
                  {showGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showGuide && (
                  <div className="mt-2.5 space-y-2">
                    {effectiveGuide.steps.map(s => (
                      <div key={s.step} className="flex gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                        <span className="w-4 h-4 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-black text-[9px] flex items-center justify-center shrink-0 mt-0.5">{s.step}</span>
                        <span className="leading-relaxed font-medium">
                           {s.text}
                           {s.link && (
                             <a href={s.link.url} target="_blank" rel="noopener noreferrer"
                               className="ml-1 inline-flex items-center gap-0.5 text-indigo-500 hover:underline">
                               {s.link.label} <ExternalLink className="w-2.5 h-2.5" />
                             </a>
                           )}
                        </span>
                      </div>
                    ))}
                    {effectiveGuide.note && (
                      <div className="mt-2 bg-slate-50 dark:bg-slate-850/40 rounded-xl p-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                        ℹ {effectiveGuide.note}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Force Webwright Toggle */}
            <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800/60">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  checked={creds?.[`forceWebwright_${platform}`] || false}
                  onChange={(e) => onCredsChange(`forceWebwright_${platform}`, e.target.checked)}
                />
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                  🤖 強制啟用 AI Webwright (跳過常規腳本)
                </span>
              </label>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 pl-6 leading-relaxed">
                全程交由 AI 視覺代理自動辨識畫面並執行操作。此為極限測試功能，速度較慢且成功率取決於模型表現。
              </p>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

