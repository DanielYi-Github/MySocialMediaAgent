import axios from 'axios';

const PROXY = 'http://localhost:3001/api/llm/proxy';

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

export function getPlatformPublishSupport(platform, assets = [], publishConfig = {}) {
  const media = classifyAssets(assets);
  const fbType = publishConfig.fbAccountType || 'business';
  const igType = publishConfig.igAccountType || 'business';

  if (media.total === 0) {
    return { canPublish: false, method: 'none', reason: '請先上傳至少一個素材。' };
  }

  if (platform === 'xhs') {
    if (!media.isImageOnly) {
      return { canPublish: false, method: 'none', reason: '目前小紅書發布流程僅支援圖片素材。' };
    }
    return { canPublish: true, method: 'browser', reason: '透過瀏覽器自動化發布圖片筆記。' };
  }

  if (platform === 'facebook') {
    if (fbType === 'personal') {
      if (media.hasMixedMedia) {
        return { canPublish: false, method: 'none', reason: 'Facebook 個人帳號自動化目前不支援圖片與影片混合素材。' };
      }
      return { canPublish: true, method: 'browser', reason: media.isSingleVideo ? '將透過瀏覽器自動化發布單支影片。' : '將透過瀏覽器自動化發布圖片貼文。' };
    }
    if (!media.isImageOnly) {
      return { canPublish: false, method: 'none', reason: 'Facebook 粉專 API 目前僅接上圖片貼文。影片請改用個人帳號自動化或手動發布。' };
    }
    return { canPublish: true, method: 'api', reason: '將透過 Facebook Graph API 發布圖片貼文。' };
  }

  if (platform === 'instagram') {
    if (igType === 'personal') {
      if (media.hasMixedMedia) {
        return { canPublish: false, method: 'none', reason: 'Instagram 個人帳號自動化目前不支援圖片與影片混合素材。' };
      }
      return { canPublish: true, method: 'browser', reason: media.isSingleVideo ? '將透過瀏覽器自動化發布單支影片。' : '將透過瀏覽器自動化發布圖片貼文。' };
    }
    if (!media.isImageOnly) {
      return { canPublish: false, method: 'none', reason: 'Instagram 商業帳號 API 目前僅接上圖片貼文。影片請改用個人帳號自動化或手動發布。' };
    }
    return { canPublish: true, method: 'api', reason: '將透過 Instagram Graph API 發布圖片貼文。' };
  }

  if (platform === 'threads') {
    if (media.hasMixedMedia) {
      return { canPublish: false, method: 'none', reason: 'Threads 目前不支援圖片與影片混合素材。' };
    }
    if (media.isSingleVideo) {
      return { canPublish: false, method: 'none', reason: 'Threads 影片發布尚未接上，目前請手動發布。' };
    }
    return { canPublish: true, method: 'api', reason: media.imageCount > 0 ? '將透過 Threads API 發布圖片貼文。' : '將透過 Threads API 發布文字貼文。' };
  }

  return { canPublish: false, method: 'none', reason: '此平台尚未定義發布規則。' };
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

async function uploadImageToImgbb(imageDataUrl, imgbbKey) {
  const base64 = imageDataUrl.split(',')[1];
  const formData = new FormData();
  formData.append('image', base64);
  const response = await axios.post(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbKey)}`, formData);
  return response.data.data.url;
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

export async function postToFacebook({ pageId, pageToken, message, imageDataUrls = [], assets = [], imgbbKey }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  if (!media.isImageOnly && media.total > 0) {
    throw new Error('Facebook 粉專 API 目前僅支援圖片貼文。');
  }
  const normalizedImageDataUrls = normalizedAssets.map((asset) => asset.sourceUrl);

  if (normalizedImageDataUrls.length > 0) {
    if (!imgbbKey) throw new Error('需要 imgbb API Key 才能在 Facebook 發布圖片。請在「API 憑證設定」填入 imgbb Key。');

    if (normalizedImageDataUrls.length === 1) {
      const imageUrl = await uploadImageToImgbb(normalizedImageDataUrls[0], imgbbKey);
      return proxyPost(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
        url: imageUrl,
        message,
        access_token: pageToken,
      });
    }

    const attachedMedia = [];
    for (const dataUrl of normalizedImageDataUrls) {
      const imageUrl = await uploadImageToImgbb(dataUrl, imgbbKey);
      const photo = await proxyPost(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
        url: imageUrl,
        published: false,
        access_token: pageToken,
      });
      attachedMedia.push({ media_fbid: photo.id });
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

export async function postToInstagram({ igUserId, pageToken, caption, imageDataUrls = [], assets = [], imgbbKey }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  if (media.total === 0) throw new Error('Instagram 發文必須包含圖片。');
  if (!media.isImageOnly) throw new Error('Instagram 商業帳號 API 目前僅支援圖片貼文。');
  if (!imgbbKey) throw new Error('需要 imgbb API Key 才能發文到 Instagram。請在「API 憑證設定」填入。');

  const auth = { Authorization: `Bearer ${pageToken}` };
  const normalizedImageDataUrls = normalizedAssets.map((asset) => asset.sourceUrl);

  if (normalizedImageDataUrls.length === 1) {
    const imageUrl = await uploadImageToImgbb(normalizedImageDataUrls[0], imgbbKey);
    const mediaContainer = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      image_url: imageUrl,
      caption,
    }, auth);
    await waitForContainer(mediaContainer.id, 'https://graph.facebook.com/v20.0', auth);
    return proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      creation_id: mediaContainer.id,
    }, auth);
  }

  const childrenIds = [];
  for (const dataUrl of normalizedImageDataUrls) {
    const imageUrl = await uploadImageToImgbb(dataUrl, imgbbKey);
    const child = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      image_url: imageUrl,
      is_carousel_item: true,
    }, auth);
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

export async function postToInstagramPersonal({ igUserId, igToken, caption, imageDataUrls = [], assets = [], imgbbKey }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  if (media.total === 0) throw new Error('Instagram 發文必須包含圖片。');
  if (!media.isImageOnly) throw new Error('Instagram 專業帳號 API 目前僅支援圖片貼文。');
  if (!imgbbKey) throw new Error('需要 imgbb API Key 才能發文到 Instagram。請在「API 憑證設定」填入。');

  const auth = { Authorization: `Bearer ${igToken}` };
  const normalizedImageDataUrls = normalizedAssets.map((asset) => asset.sourceUrl);

  if (normalizedImageDataUrls.length === 1) {
    const imageUrl = await uploadImageToImgbb(normalizedImageDataUrls[0], imgbbKey);
    const mediaContainer = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
      image_url: imageUrl,
      caption,
    }, auth);
    await waitForContainer(mediaContainer.id, 'https://graph.instagram.com/v20.0', auth);
    return proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media_publish`, {
      creation_id: mediaContainer.id,
    }, auth);
  }

  const childrenIds = [];
  for (const dataUrl of normalizedImageDataUrls) {
    const imageUrl = await uploadImageToImgbb(dataUrl, imgbbKey);
    const child = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
      image_url: imageUrl,
      is_carousel_item: true,
    }, auth);
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
  const media = classifyAssets(normalizedAssets);
  if (!media.isImageOnly && media.total > 0) {
    throw new Error('目前小紅書發布流程僅支援圖片素材。');
  }

  const outgoingAssets = normalizedAssets.map(assetDataUrlToPayload);
  const res = await axios.post(
    'http://localhost:3001/api/xhs/publish',
    { title, content, assets: outgoingAssets, llmConfig, forceWebwright },
    { timeout: 120000 },
  );
  return res.data;
}

export async function postToThreads({ threadsUserId, threadsToken, text, imageDataUrls = [], assets = [], imgbbKey }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  if (media.hasMixedMedia) throw new Error('Threads 目前不支援圖片與影片混合素材。');
  if (media.videoCount > 0) throw new Error('Threads 影片發布尚未接上，請先手動發布。');

  const auth = { Authorization: `Bearer ${threadsToken}` };
  const normalizedImageDataUrls = normalizedAssets.map((asset) => asset.sourceUrl);

  if (normalizedImageDataUrls.length === 0) {
    const container = await proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads`, {
      text,
      media_type: 'TEXT',
    }, auth);
    return proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`, {
      creation_id: container.id,
    }, auth);
  }

  if (normalizedImageDataUrls.length === 1) {
    if (!imgbbKey) throw new Error('需要 imgbb API Key 才能在 Threads 發布圖片。請在「API 憑證設定」填入。');
    const imageUrl = await uploadImageToImgbb(normalizedImageDataUrls[0], imgbbKey);
    const container = await proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads`, {
      text,
      media_type: 'IMAGE',
      image_url: imageUrl,
    }, auth);
    return proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`, {
      creation_id: container.id,
    }, auth);
  }

  if (!imgbbKey) throw new Error('需要 imgbb API Key 才能在 Threads 發布圖片。請在「API 憑證設定」填入。');
  const childrenIds = [];
  for (const dataUrl of normalizedImageDataUrls) {
    const imageUrl = await uploadImageToImgbb(dataUrl, imgbbKey);
    const child = await proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads`, {
      media_type: 'IMAGE',
      image_url: imageUrl,
      is_carousel_item: true,
    }, auth);
    childrenIds.push(child.id);
  }

  const container = await proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads`, {
    media_type: 'CAROUSEL',
    children: childrenIds,
    text,
  }, auth);
  return proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`, {
    creation_id: container.id,
  }, auth);
}

export async function postToFacebookPersonal({ caption, imageDataUrls = [], assets = [], llmConfig = null, forceWebwright = false }) {
  const normalizedAssets = normalizeAssetsInput({ assets, imageDataUrls });
  const media = classifyAssets(normalizedAssets);
  if (media.hasMixedMedia) {
    throw new Error('Facebook 個人帳號自動化目前不支援圖片與影片混合素材。');
  }

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
  if (media.hasMixedMedia) throw new Error('Instagram 個人帳號自動化目前不支援圖片與影片混合素材。');

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
