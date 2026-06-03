import axios from 'axios';

// Route all external API calls through the local backend proxy to avoid CORS
const PROXY = 'http://localhost:3001/api/llm/proxy';

async function proxyPost(url, data, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const resp = await axios.post(PROXY, { url, headers, data });
  return resp.data;
}

// GET via proxy — data becomes URL query parameters on the upstream request
async function proxyGet(url, params, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const resp = await axios.post(PROXY, { url, method: 'GET', headers, data: params });
  return resp.data;
}

async function uploadImageToImgbb(imageDataUrl, imgbbKey) {
  const base64 = imageDataUrl.split(',')[1];
  const formData = new FormData();
  formData.append('image', base64);
  // Key goes in the query string per imgbb official docs
  const response = await axios.post(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbKey)}`, formData);
  return response.data.data.url;
}

// Poll the container status until FINISHED (Instagram processes images asynchronously)
// authHeaders: { 'Authorization': 'Bearer <token>' }
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
    // Wait 3 s between polls (total up to ~36 s)
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Instagram 媒體容器等待逾時，請稍後重試。');
}

/**
 * Post to a Facebook Page.
 * Photo post if imageDataUrl provided (requires imgbbKey), text-only otherwise.
 * Requires: Page Access Token with pages_manage_posts scope.
 */
export async function postToFacebook({ pageId, pageToken, message, imageDataUrls = [], imgbbKey }) {
  if (imageDataUrls.length > 0) {
    if (!imgbbKey) throw new Error('需要 imgbb API Key 才能在 Facebook 發布圖片。請在「API 憑證設定」填入 imgbb Key。');
    
    if (imageDataUrls.length === 1) {
      const imageUrl = await uploadImageToImgbb(imageDataUrls[0], imgbbKey);
      return proxyPost(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
        url: imageUrl,
        message,
        access_token: pageToken,
      });
    } else {
      const attached_media = [];
      for (const dataUrl of imageDataUrls) {
        const imageUrl = await uploadImageToImgbb(dataUrl, imgbbKey);
        const photo = await proxyPost(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
          url: imageUrl,
          published: false,
          access_token: pageToken,
        });
        attached_media.push({ media_fbid: photo.id });
      }
      return proxyPost(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
        message,
        attached_media,
        access_token: pageToken,
      });
    }
  }

  return proxyPost(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
    message,
    access_token: pageToken,
  });
}

/**
 * Post to Instagram Business Account.
 * Two-step: upload image to imgbb → create container → publish.
 * Requires: Facebook Page Access Token with instagram_basic + instagram_content_publish.
 * Image URL must be publicly accessible (JPEG, ≤ 8MB).
 */
export async function postToInstagram({ igUserId, pageToken, caption, imageDataUrls = [], imgbbKey }) {
  if (imageDataUrls.length === 0) throw new Error('Instagram 發文必須包含圖片。');
  if (!imgbbKey) throw new Error('需要 imgbb API Key 才能發文到 Instagram。請在「API 憑證設定」填入。');

  const auth = { 'Authorization': `Bearer ${pageToken}` };

  if (imageDataUrls.length === 1) {
    const imageUrl = await uploadImageToImgbb(imageDataUrls[0], imgbbKey);
    const media = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      image_url: imageUrl,
      caption,
    }, auth);
    await waitForContainer(media.id, `https://graph.facebook.com/v20.0`, auth);
    return proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      creation_id: media.id,
    }, auth);
  } else {
    const childrenIds = [];
    for (const dataUrl of imageDataUrls) {
      const imageUrl = await uploadImageToImgbb(dataUrl, imgbbKey);
      const child = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
        image_url: imageUrl,
        is_carousel_item: true,
      }, auth);
      childrenIds.push(child.id);
    }
    
    await Promise.all(childrenIds.map(id => waitForContainer(id, `https://graph.facebook.com/v20.0`, auth)));

    const carousel = await proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: childrenIds,
      caption,
    }, auth);

    await waitForContainer(carousel.id, `https://graph.facebook.com/v20.0`, auth);
    return proxyPost(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      creation_id: carousel.id,
    }, auth);
  }
}

/**
 * Post to Instagram Creator/Personal Account via Instagram Login.
 * Uses graph.instagram.com — no Facebook Page required.
 * Requires: Instagram User Access Token with instagram_business_basic + instagram_business_content_publish.
 * Account must be Professional (Creator or Business), not a pure personal account.
 */
export async function postToInstagramPersonal({ igUserId, igToken, caption, imageDataUrls = [], imgbbKey }) {
  if (imageDataUrls.length === 0) throw new Error('Instagram 發文必須包含圖片。');
  if (!imgbbKey) throw new Error('需要 imgbb API Key 才能發文到 Instagram。請在「API 憑證設定」填入。');

  const auth = { 'Authorization': `Bearer ${igToken}` };

  if (imageDataUrls.length === 1) {
    const imageUrl = await uploadImageToImgbb(imageDataUrls[0], imgbbKey);
    const media = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
      image_url: imageUrl,
      caption,
    }, auth);
    await waitForContainer(media.id, `https://graph.instagram.com/v20.0`, auth);
    return proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media_publish`, {
      creation_id: media.id,
    }, auth);
  } else {
    const childrenIds = [];
    for (const dataUrl of imageDataUrls) {
      const imageUrl = await uploadImageToImgbb(dataUrl, imgbbKey);
      const child = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
        image_url: imageUrl,
        is_carousel_item: true,
      }, auth);
      childrenIds.push(child.id);
    }
    
    await Promise.all(childrenIds.map(id => waitForContainer(id, `https://graph.instagram.com/v20.0`, auth)));

    const carousel = await proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: childrenIds,
      caption,
    }, auth);

    await waitForContainer(carousel.id, `https://graph.instagram.com/v20.0`, auth);
    return proxyPost(`https://graph.instagram.com/v20.0/${igUserId}/media_publish`, {
      creation_id: carousel.id,
    }, auth);
  }
}

/**
 * Post to 小紅書 via the local XHS automation server (Playwright).
 * Requires server/index.js to be running (`npm run dev:all`).
 * Extracts the first line of content as title (max 20 chars for XHS).
 */
export async function postToXhs({ title, content, imageDataUrls = [], llmConfig = null, forceWebwright = false }) {
  const images = imageDataUrls.map(url => {
    const [header, base64] = url.split(',');
    return { base64, mime: header.match(/:(.*?);/)[1] };
  });

  const res = await axios.post(
    'http://localhost:3001/api/xhs/publish',
    { title, content, images, llmConfig, forceWebwright },
    { timeout: 120000 }
  );

  return res.data;
}

/**
 * Post to Threads.
 * Two-step: create media container → publish.
 * API base: graph.threads.net
 * Requires: Threads User Access Token with threads_basic + threads_content_publish.
 * Image (if any) must be publicly accessible — uses imgbb for hosting.
 */
export async function postToThreads({ threadsUserId, threadsToken, text, imageDataUrls = [], imgbbKey }) {
  const auth = { 'Authorization': `Bearer ${threadsToken}` };

  if (imageDataUrls.length === 0) {
    const container = await proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads`, {
      text,
      media_type: 'TEXT',
    }, auth);
    return proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`, {
      creation_id: container.id,
    }, auth);
  } else if (imageDataUrls.length === 1) {
    if (!imgbbKey) throw new Error('需要 imgbb API Key 才能在 Threads 發布圖片。請在「API 憑證設定」填入。');
    const imageUrl = await uploadImageToImgbb(imageDataUrls[0], imgbbKey);
    const container = await proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads`, {
      text,
      media_type: 'IMAGE',
      image_url: imageUrl,
    }, auth);
    return proxyPost(`https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`, {
      creation_id: container.id,
    }, auth);
  } else {
    if (!imgbbKey) throw new Error('需要 imgbb API Key 才能在 Threads 發布圖片。請在「API 憑證設定」填入。');
    const childrenIds = [];
    for (const dataUrl of imageDataUrls) {
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
}

/**
 * Post to Facebook personal timeline via Playwright browser automation.
 * Requires the user to be logged into Facebook via the browser login widget.
 *
 * @param {object} opts
 * @param {string} opts.caption       - Post caption/text
 * @param {string} [opts.imageDataUrl] - Image as a data URL (data:image/...;base64,...)
 */
export async function postToFacebookPersonal({ caption, imageDataUrls = [], llmConfig = null, forceWebwright = false }) {
  const images = imageDataUrls.map(url => {
    const [meta, data] = url.split(',');
    return { base64: data, mime: meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg' };
  });
  const resp = await axios.post(
    'http://localhost:3001/api/fb/publish',
    { caption, images, llmConfig, forceWebwright },
    { timeout: 120000 },
  );
  return resp.data;
}

/**
 * Post to Instagram personal account via Playwright browser automation.
 * Requires the user to be logged into Instagram via the browser login widget.
 *
 * @param {object} opts
 * @param {string} opts.caption        - Post caption
 * @param {string} opts.imageDataUrl   - Image as a data URL (required for Instagram)
 */
export async function postToInstagramBrowser({ caption, imageDataUrls = [], llmConfig = null }) {
  if (!imageDataUrls || imageDataUrls.length === 0) throw new Error('Instagram 發文必須包含圖片。');
  const images = imageDataUrls.map(url => {
    const [meta, data] = url.split(',');
    return { base64: data, mime: meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg' };
  });
  const resp = await axios.post(
    'http://localhost:3001/api/ig/publish',
    { caption, images, llmConfig },
    { timeout: 120000 },
  );
  return resp.data;
}
