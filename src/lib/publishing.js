import axios from 'axios';

const PROXY = 'http://localhost:3001/api/llm/proxy';
const THREADS_MAX_CAROUSEL_ITEMS = 20;
const THREADS_MIN_CAROUSEL_ITEMS = 2;

export function normalizeAssetsInput({ assets, imageDataUrls }) {
  if (Array.isArray(assets) && assets.length > 0) return assets;

  const urls = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls].filter(Boolean);
  return urls.map((sourceUrl, index) => ({
    id: `legacy-${index}`,
    type: 'image',
    mime: 'image/jpeg',
    sourceUrl,
    isPrimary: index === 0,
  }));
}

export function classifyAssets(assets = []) {
  const imageCount = assets.filter((asset) => asset.type === 'image').length;
  const videoCount = assets.filter((asset) => asset.type === 'video').length;
  const hasMixedMedia = imageCount > 0 && videoCount > 0;

  return {
    total: assets.length,
    imageCount,
    videoCount,
    hasMixedMedia,
    isImageOnly: imageCount > 0 && videoCount === 0,
    isSingleVideo: videoCount === 1 && imageCount === 0,
    isVideoOnly: videoCount > 0 && imageCount === 0,
  };
}

function hasValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

function makeMissingField(field, label, setupSection) {
  return { field, label, setupSection };
}

function getThreadsAccountConfig(publishConfig = {}) {
  const threadsType = publishConfig.threadsAccountType ?? 'personal';
  return {
    threadsType,
    tokenField: threadsType === 'business' ? 'threadsBusinessToken' : 'threadsToken',
    userIdField: threadsType === 'business' ? 'threadsBusinessUserId' : 'threadsUserId',
  };
}

function getThreadsCarouselCountError(assetCount) {
  if (assetCount > THREADS_MAX_CAROUSEL_ITEMS) {
    return `Threads carousel 最多支援 ${THREADS_MAX_CAROUSEL_ITEMS} 個素材，請減少後再發布。`;
  }
  if (assetCount > 1 && assetCount < THREADS_MIN_CAROUSEL_ITEMS) {
    return `Threads carousel 至少需要 ${THREADS_MIN_CAROUSEL_ITEMS} 個素材。`;
  }
  return '';
}

export function getPlatformPublishSupport(platform, assets = [], publishConfig = {}) {
  const media = classifyAssets(assets);
  const fbType = publishConfig.fbAccountType || 'business';
  const igType = publishConfig.igAccountType || 'business';

  if (media.total === 0) {
    return { canPublish: false, method: 'none', reason: '請先上傳至少一個素材。' };
  }

  if (platform === 'xhs') {
    return { canPublish: true, method: 'browser', reason: media.hasMixedMedia ? '將透過瀏覽器自動化嘗試發布單篇圖片與影片混合筆記。' : '透過瀏覽器自動化發布筆記。' };
  }

  if (platform === 'facebook') {
    if (fbType === 'personal') {
      return { canPublish: true, method: 'browser', reason: media.hasMixedMedia ? '將透過瀏覽器自動化嘗試發布單篇圖片與影片混合貼文。' : media.isSingleVideo ? '將透過瀏覽器自動化發布單支影片。' : '將透過瀏覽器自動化發布貼文。' };
    }
    return { canPublish: true, method: 'api', reason: media.videoCount > 0 ? '將透過 Facebook Graph API 與 Cloudinary 發布影片或混合素材。' : '將透過 Facebook Graph API 發布圖片貼文。' };
  }

  if (platform === 'instagram') {
    if (igType === 'personal') {
      return { canPublish: true, method: 'browser', reason: media.hasMixedMedia ? '將透過瀏覽器自動化嘗試發布單篇圖片與影片混合貼文。' : media.isSingleVideo ? '將透過瀏覽器自動化發布單支影片。' : '將透過瀏覽器自動化發布貼文。' };
    }
    return { canPublish: true, method: 'api', reason: media.videoCount > 0 ? '將透過 Instagram Graph API carousel 與 Cloudinary 發布影片或混合素材。' : '將透過 Instagram Graph API 發布圖片貼文。' };
  }

  if (platform === 'threads') {
    if (media.total > THREADS_MAX_CAROUSEL_ITEMS) {
      return {
        canPublish: false,
        method: 'none',
        reason: getThreadsCarouselCountError(media.total),
      };
    }
    if (media.videoCount > 0) {
      return {
        canPublish: true,
        method: 'api',
        reason: media.total > 1
          ? `將透過 Threads API carousel 與 Cloudinary 發布影片或混合素材（每次 ${THREADS_MIN_CAROUSEL_ITEMS}-${THREADS_MAX_CAROUSEL_ITEMS} 個素材）。`
          : '將透過 Threads API 與 Cloudinary 發布單支影片。',
      };
    }
    return {
      canPublish: true,
      method: 'api',
      reason: media.total > 1
        ? `將透過 Threads API carousel 發布圖片貼文（每次 ${THREADS_MIN_CAROUSEL_ITEMS}-${THREADS_MAX_CAROUSEL_ITEMS} 張）。`
        : '將透過 Threads API 發布單張圖片貼文。',
    };
  }

  return { canPublish: false, method: 'none', reason: '此平台尚未定義發布規則。' };
}

export function getPublishRequirements(platform, assets = [], publishConfig = {}) {
  const support = getPlatformPublishSupport(platform, assets, publishConfig);
  const media = classifyAssets(assets);
  const missingFields = [];
  let setupSection = '';

  if (!support.canPublish) {
    return { ...support, missingFields, setupSection };
  }

  const requireField = (field, label, section) => {
    if (!hasValue(publishConfig[field])) {
      missingFields.push(makeMissingField(field, label, section));
      setupSection ||= section;
    }
  };

  if (platform === 'facebook' && (publishConfig.fbAccountType || 'business') !== 'personal') {
    requireField('fbPageToken', 'Facebook Page Access Token', 'Facebook 設定');
    requireField('fbPageId', 'Facebook Page ID', 'Facebook 設定');
    if (media.videoCount > 0) {
      requireField('cloudinaryCloudName', 'Cloudinary Cloud Name', 'Cloudinary 影片中轉設定');
      requireField('cloudinaryUploadPreset', 'Cloudinary unsigned Upload Preset', 'Cloudinary 影片中轉設定');
    } else if (media.imageCount > 0) {
      requireField('imgbbKey', 'imgbb API Key', 'Instagram / 圖片中轉設定');
    }
  }

  if (platform === 'instagram' && (publishConfig.igAccountType || 'business') !== 'personal') {
    requireField('fbPageToken', 'Facebook Page Access Token', 'Facebook 設定');
    requireField('igUserId', 'Instagram Business User ID', 'Instagram 設定');
    if (media.videoCount > 0) {
      requireField('cloudinaryCloudName', 'Cloudinary Cloud Name', 'Cloudinary 影片中轉設定');
      requireField('cloudinaryUploadPreset', 'Cloudinary unsigned Upload Preset', 'Cloudinary 影片中轉設定');
    } else if (media.imageCount > 0) {
      requireField('imgbbKey', 'imgbb API Key', 'Instagram / 圖片中轉設定');
    }
  }

  if (platform === 'threads') {
    const { tokenField, userIdField } = getThreadsAccountConfig(publishConfig);
    requireField(tokenField, 'Threads Access Token', 'Threads API 設定');
    requireField(userIdField, 'Threads User ID', 'Threads API 設定');
    const carouselCountError = getThreadsCarouselCountError(media.total);
    if (carouselCountError) {
      return {
        ...support,
        canPublish: false,
        missingFields,
        setupSection,
        reason: carouselCountError,
      };
    }
    if (media.videoCount > 0) {
      requireField('cloudinaryCloudName', 'Cloudinary Cloud Name', 'Cloudinary 影片中轉設定');
      requireField('cloudinaryUploadPreset', 'Cloudinary unsigned Upload Preset', 'Cloudinary 影片中轉設定');
    } else if (media.imageCount > 0) {
      requireField('imgbbKey', 'imgbb API Key', 'Instagram / 圖片中轉設定');
    }
  }

  if (missingFields.length === 0) {
    return { ...support, missingFields, setupSection };
  }

  const missingLabels = missingFields.map((item) => item.label).join('、');
  const platformLabel = platform === 'threads'
    ? 'Threads API'
    : platform === 'instagram'
      ? 'Instagram API'
      : platform === 'facebook'
        ? 'Facebook API'
        : '發布';
  const mediaLabel = media.hasMixedMedia ? '混合素材' : media.videoCount > 0 ? '影片' : '圖片';

  return {
    ...support,
    canPublish: false,
    missingFields,
    setupSection,
    reason: `${platformLabel} 發布${mediaLabel}需要 ${missingLabels}。請到「設定 > 發文設定 > ${setupSection}」填入。`,
  };
}

export function resolvePublishTargets(confirmedPlatforms = [], selectedPublishTargets = {}) {
  const platforms = confirmedPlatforms.filter((platform) => selectedPublishTargets[platform]);
  if (platforms.length === 0) {
    return { platforms: [], error: '請選擇本次發布平台。' };
  }
  return { platforms, error: '' };
}

function assetDataUrlToPayload(asset) {
  const [meta, data] = asset.sourceUrl.split(',');
  return {
    base64: data,
    mime: asset.mime || meta.match(/:(.*?);/)?.[1] || 'application/octet-stream',
  };
}

async function proxyPost(url, data, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const resp = await axios.post(PROXY, { url, headers, data });
  return resp.data;
}

async function proxyGet(url, params, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const resp = await axios.post(PROXY, { url, method: 'GET', headers, data: params });
  return resp.data;
}

function getAxiosErrorMessage(err) {
  const responseData = err.response?.data;
  if (responseData?.error?.message) return responseData.error.message;
  if (typeof responseData?.error === 'string') return responseData.error;
  if (typeof responseData?.message === 'string') return responseData.message;
  return err.message || '請求失敗';
}

function buildThreadsUrl(threadsUserId, params = {}) {
  const url = new URL(`https://graph.threads.net/v1.0/${threadsUserId}/threads`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildThreadsPublishUrl(threadsUserId, creationId) {
  const url = new URL(`https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`);
  url.searchParams.set('creation_id', creationId);
  return url.toString();
}

async function createThreadsContainer(threadsUserId, auth, params) {
  return proxyPost(buildThreadsUrl(threadsUserId, params), {}, auth);
}

async function publishThreadsContainer(threadsUserId, auth, creationId) {
  return proxyPost(buildThreadsPublishUrl(threadsUserId, creationId), {}, auth);
}

async function uploadImageToImgbb(imageDataUrl, imgbbKey) {
  const base64 = imageDataUrl.split(',')[1];
  const formData = new FormData();
  formData.append('image', base64);
  const response = await axios.post(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbKey)}`, formData);
  return response.data.data.url;
}

function isVideoAsset(asset) {
  return asset?.type === 'video' || asset?.mime?.startsWith('video/');
}

export async function uploadAssetToCloudinary(asset, { cloudinaryCloudName, cloudinaryUploadPreset } = {}) {
  if (!cloudinaryCloudName || !cloudinaryUploadPreset) {
    throw new Error('需要 Cloudinary Cloud Name 與 unsigned Upload Preset 才能透過 API 發布影片或混合素材。請在「API 憑證設定」填入。');
  }
  if (!asset?.sourceUrl) {
    throw new Error('素材缺少可上傳的 sourceUrl。');
  }

  const formData = new FormData();
  formData.append('file', asset.sourceUrl);
  formData.append('upload_preset', cloudinaryUploadPreset);
  const response = await axios.post(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinaryCloudName)}/auto/upload`,
    formData,
  );

  const secureUrl = response.data?.secure_url;
  if (!secureUrl) throw new Error('Cloudinary 上傳失敗：回應缺少 secure_url。');
  return secureUrl;
}

async function getPublicMediaAssets(assets, { imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset } = {}) {
  const media = classifyAssets(assets);
  const requiresCloudinary = media.videoCount > 0;

  if (!requiresCloudinary && !imgbbKey && media.imageCount > 0) {
    throw new Error('需要 imgbb API Key 才能發布圖片。請在「API 憑證設定」填入。');
  }

  const publicAssets = [];
  for (const asset of assets) {
    if (requiresCloudinary || isVideoAsset(asset)) {
      const url = await uploadAssetToCloudinary(asset, { cloudinaryCloudName, cloudinaryUploadPreset });
      publicAssets.push({ asset, url });
    } else {
      const url = await uploadImageToImgbb(asset.sourceUrl, imgbbKey);
      publicAssets.push({ asset, url });
    }
  }
  return publicAssets;
}

async function waitForContainer(containerId, apiBase, authHeaders) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await proxyGet(
      `${apiBase}/${containerId}`,
      { fields: 'status_code' },
      authHeaders,
    );
    if (result.status_code === 'FINISHED') return;
    if (result.status_code === 'ERROR') {
      throw new Error('Instagram 媒體容器處理失敗，請確認圖片格式（需為 JPEG）與帳號設定。');
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Instagram 媒體容器等待逾時，請稍後重試。');
}

async function waitForThreadsContainer(containerId, authHeaders) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await proxyGet(
      `https://graph.threads.net/v1.0/${containerId}`,
      { fields: 'id,status,error_message' },
      authHeaders,
    );

    if (result.status === 'FINISHED' || result.status === 'PUBLISHED') return;

    if (result.status === 'ERROR' || result.status === 'EXPIRED') {
      const detail = result.error_message ? `：${result.error_message}` : '';
      throw new Error(`Threads 媒體容器處理失敗${detail}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error('Threads 影片容器等待逾時，請稍後重試。');
}

export async function postToFacebook({ pageId, pageToken, message, imageDataUrls = [], assets = [], imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const publicAssets = await getPublicMediaAssets(normalizedAssets, { imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset });

  if (publicAssets.length > 0) {
    if (publicAssets.length === 1 && !isVideoAsset(publicAssets[0].asset)) {
      return proxyPost(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
        url: publicAssets[0].url,
        message,
        access_token: pageToken,
      });
    }

    if (publicAssets.length === 1 && isVideoAsset(publicAssets[0].asset)) {
      return proxyPost(`https://graph.facebook.com/v20.0/${pageId}/videos`, {
        file_url: publicAssets[0].url,
        description: message,
        access_token: pageToken,
      });
    }

    const attachedMedia = [];
    for (const item of publicAssets) {
      const unpublished = isVideoAsset(item.asset)
        ? await proxyPost(`https://graph.facebook.com/v20.0/${pageId}/videos`, {
          file_url: item.url,
          description: message,
          published: false,
          access_token: pageToken,
        })
        : await proxyPost(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
          url: item.url,
          published: false,
          access_token: pageToken,
        });
      attachedMedia.push({ media_fbid: unpublished.id });
    }

    return proxyPost(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
      message,
      attached_media: attachedMedia,
      access_token: pageToken,
    });
  }

  return proxyPost(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
    message,
    access_token: pageToken,
  });
}

export async function postToInstagram({ igUserId, pageToken, caption, imageDataUrls = [], assets = [], imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  if (media.total === 0) throw new Error('Instagram 發文必須包含素材。');

  const auth = { Authorization: `Bearer ${pageToken}` };
  const publicAssets = await getPublicMediaAssets(normalizedAssets, { imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset });

  if (publicAssets.length === 1 && !isVideoAsset(publicAssets[0].asset)) {
    const mediaContainer = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      image_url: publicAssets[0].url,
      caption,
    }, auth);
    await waitForContainer(mediaContainer.id, 'https://graph.facebook.com/v20.0', auth);
    return proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      creation_id: mediaContainer.id,
    }, auth);
  }

  if (publicAssets.length === 1 && isVideoAsset(publicAssets[0].asset)) {
    const mediaContainer = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      media_type: 'REELS',
      video_url: publicAssets[0].url,
      caption,
    }, auth);
    await waitForContainer(mediaContainer.id, 'https://graph.facebook.com/v20.0', auth);
    return proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      creation_id: mediaContainer.id,
    }, auth);
  }

  const childrenIds = [];
  for (const item of publicAssets) {
    const payload = isVideoAsset(item.asset)
      ? { media_type: 'VIDEO', video_url: item.url, is_carousel_item: true }
      : { image_url: item.url, is_carousel_item: true };
    const child = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, payload, auth);
    childrenIds.push(child.id);
  }

  await Promise.all(childrenIds.map((id) => waitForContainer(id, 'https://graph.facebook.com/v20.0', auth)));

  const carousel = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childrenIds,
    caption,
  }, auth);

  await waitForContainer(carousel.id, 'https://graph.facebook.com/v20.0', auth);
  return proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
    creation_id: carousel.id,
  }, auth);
}

export async function postToInstagramPersonal({ igUserId, igToken, caption, imageDataUrls = [], assets = [], imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  if (media.total === 0) throw new Error('Instagram 發文必須包含素材。');

  const auth = { Authorization: `Bearer ${igToken}` };
  const publicAssets = await getPublicMediaAssets(normalizedAssets, { imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset });

  if (publicAssets.length === 1 && !isVideoAsset(publicAssets[0].asset)) {
    const mediaContainer = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
      image_url: publicAssets[0].url,
      caption,
    }, auth);
    await waitForContainer(mediaContainer.id, 'https://graph.instagram.com/v20.0', auth);
    return proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media_publish`, {
      creation_id: mediaContainer.id,
    }, auth);
  }

  if (publicAssets.length === 1 && isVideoAsset(publicAssets[0].asset)) {
    const mediaContainer = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
      media_type: 'REELS',
      video_url: publicAssets[0].url,
      caption,
    }, auth);
    await waitForContainer(mediaContainer.id, 'https://graph.instagram.com/v20.0', auth);
    return proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media_publish`, {
      creation_id: mediaContainer.id,
    }, auth);
  }

  const childrenIds = [];
  for (const item of publicAssets) {
    const payload = isVideoAsset(item.asset)
      ? { media_type: 'VIDEO', video_url: item.url, is_carousel_item: true }
      : { image_url: item.url, is_carousel_item: true };
    const child = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, payload, auth);
    childrenIds.push(child.id);
  }

  await Promise.all(childrenIds.map((id) => waitForContainer(id, 'https://graph.instagram.com/v20.0', auth)));

  const carousel = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childrenIds,
    caption,
  }, auth);

  await waitForContainer(carousel.id, 'https://graph.instagram.com/v20.0', auth);
  return proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media_publish`, {
    creation_id: carousel.id,
  }, auth);
}

export async function postToXhs({ title, content, imageDataUrls = [], assets = [], llmConfig = null, forceWebwright = false }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const outgoingAssets = normalizedAssets.map(assetDataUrlToPayload);
  const res = await axios.post(
    'http://localhost:3001/api/xhs/publish',
    { title, content, assets: outgoingAssets, llmConfig, forceWebwright },
    { timeout: 120000 },
  );
  return res.data;
}

export async function postToThreads({ threadsUserId, threadsToken, text, imageDataUrls = [], assets = [], imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  const carouselCountError = getThreadsCarouselCountError(media.total);
  if (carouselCountError) throw new Error(carouselCountError);

  const auth = { Authorization: `Bearer ${threadsToken}` };
  const publicAssets = await getPublicMediaAssets(normalizedAssets, { imgbbKey, cloudinaryCloudName, cloudinaryUploadPreset });

  if (publicAssets.length === 0) {
    const container = await createThreadsContainer(threadsUserId, auth, {
      text,
      media_type: 'TEXT',
    });
    return publishThreadsContainer(threadsUserId, auth, container.id);
  }

  if (publicAssets.length === 1) {
    const item = publicAssets[0];
    const container = await createThreadsContainer(threadsUserId, auth, {
      text,
      media_type: isVideoAsset(item.asset) ? 'VIDEO' : 'IMAGE',
      [isVideoAsset(item.asset) ? 'video_url' : 'image_url']: item.url,
    });
    if (isVideoAsset(item.asset)) {
      await waitForThreadsContainer(container.id, auth);
    }
    return publishThreadsContainer(threadsUserId, auth, container.id);
  }

  const childrenIds = [];
  for (const item of publicAssets) {
    const child = await createThreadsContainer(threadsUserId, auth, {
      media_type: isVideoAsset(item.asset) ? 'VIDEO' : 'IMAGE',
      [isVideoAsset(item.asset) ? 'video_url' : 'image_url']: item.url,
      is_carousel_item: true,
    });
    childrenIds.push(child.id);

    if (isVideoAsset(item.asset)) {
      await waitForThreadsContainer(child.id, auth);
    }
  }

  const container = await createThreadsContainer(threadsUserId, auth, {
    media_type: 'CAROUSEL',
    children: childrenIds.join(','),
    text,
  });
  await waitForThreadsContainer(container.id, auth);
  return publishThreadsContainer(threadsUserId, auth, container.id);
}

export async function postToFacebookPersonal({ caption, imageDataUrls = [], assets = [], llmConfig = null, forceWebwright = false }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const outgoingAssets = normalizedAssets.map(assetDataUrlToPayload);
  try {
    const resp = await axios.post(
      'http://localhost:3001/api/fb/publish',
      { caption, assets: outgoingAssets, llmConfig, forceWebwright },
      { timeout: 120000 },
    );
    return resp.data;
  } catch (err) {
    throw new Error(getAxiosErrorMessage(err), { cause: err });
  }
}

export async function postToInstagramBrowser({ caption, imageDataUrls = [], assets = [], llmConfig = null, forceWebwright = false }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  if (media.total === 0) throw new Error('Instagram 發文必須包含素材。');

  const outgoingAssets = normalizedAssets.map(assetDataUrlToPayload);
  try {
    const resp = await axios.post(
      'http://localhost:3001/api/ig/publish',
      { caption, assets: outgoingAssets, llmConfig, forceWebwright },
      { timeout: 120000 },
    );
    return resp.data;
  } catch (err) {
    throw new Error(getAxiosErrorMessage(err), { cause: err });
  }
}
