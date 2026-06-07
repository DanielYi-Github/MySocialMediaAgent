import assert from 'node:assert';
import process from 'node:process';
import axios from 'axios';
import {
  getPublishRequirements,
  getPlatformPublishSupport,
  postToFacebook,
  postToInstagram,
  postToThreads,
  resolvePublishTargets,
  uploadAssetToCloudinary,
} from '../src/lib/publishing.js';

console.log('Running TDD tests for mixed media publishing...');

const SAMPLE_IMAGE = 'data:image/png;base64,aW1hZ2U=';
const SAMPLE_VIDEO = 'data:video/mp4;base64,dmlkZW8=';

const imageAsset = {
  id: 'image-1',
  type: 'image',
  mime: 'image/png',
  sourceUrl: SAMPLE_IMAGE,
};

const videoAsset = {
  id: 'video-1',
  type: 'video',
  mime: 'video/mp4',
  sourceUrl: SAMPLE_VIDEO,
};

const mixedAssets = [imageAsset, videoAsset];

const cloudinaryConfig = {
  cloudinaryCloudName: 'demo-cloud',
  cloudinaryUploadPreset: 'unsigned-preset',
};

const originalPost = axios.post;

function createMockAxios() {
  const calls = [];
  let id = 1;

  axios.post = async (url, data, config) => {
    calls.push({ url, data, config });

    if (url.includes('api.cloudinary.com')) {
      const uploadedFile = typeof data.get === 'function' ? data.get('file') : '';
      return {
        data: {
          secure_url: String(uploadedFile).startsWith('data:image/')
            ? 'https://res.cloudinary.com/demo/image/upload/sample.png'
            : 'https://res.cloudinary.com/demo/video/upload/sample.mp4',
        },
      };
    }

    if (url.includes('api.imgbb.com')) {
      return {
        data: {
          data: {
            url: 'https://i.imgbb.com/demo/sample.png',
          },
        },
      };
    }

    if (url === 'http://localhost:3001/api/llm/proxy') {
      if (data.method === 'GET') {
        if (String(data.url).startsWith('https://graph.threads.net/v1.0/container-')) {
          return { data: { id: 'container-status', status: 'FINISHED' } };
        }
        return { data: { status_code: 'FINISHED' } };
      }
      return { data: { id: `container-${id++}` } };
    }

    throw new Error(`Unexpected axios.post URL: ${url}`);
  };

  return calls;
}

function getProxyCalls(calls, targetUrlPrefix) {
  return calls
    .filter((call) => call.url === 'http://localhost:3001/api/llm/proxy')
    .filter((call) => call.data.url.startsWith(targetUrlPrefix));
}

function getUrlParams(rawUrl) {
  const url = new URL(rawUrl);
  return Object.fromEntries(url.searchParams.entries());
}

try {
  const supportConfig = {
    fbAccountType: 'personal',
    igAccountType: 'personal',
  };

  assert.strictEqual(getPlatformPublishSupport('facebook', mixedAssets, supportConfig).canPublish, true);
  assert.strictEqual(getPlatformPublishSupport('instagram', mixedAssets, supportConfig).canPublish, true);
  assert.strictEqual(getPlatformPublishSupport('instagram', mixedAssets, { igAccountType: 'business' }).canPublish, true);
  assert.strictEqual(getPlatformPublishSupport('threads', mixedAssets, {}).canPublish, true);
  console.log('Test 1 Passed: mixed media is not blanket-blocked by publish support checks');

  await assert.rejects(
    () => uploadAssetToCloudinary(videoAsset, { cloudinaryCloudName: '', cloudinaryUploadPreset: '' }),
    /Cloudinary/,
  );
  console.log('Test 2 Passed: Cloudinary upload requires cloud name and unsigned upload preset');

  const missingThreadsCloudinary = getPublishRequirements('threads', mixedAssets, {
    threadsToken: 'threads-token',
    threadsUserId: 'threads-user',
  });
  assert.strictEqual(missingThreadsCloudinary.canPublish, false);
  assert.deepStrictEqual(
    missingThreadsCloudinary.missingFields.map((item) => item.field),
    ['cloudinaryCloudName', 'cloudinaryUploadPreset'],
  );
  assert.match(missingThreadsCloudinary.reason, /Cloudinary Cloud Name/);
  console.log('Test 2-1 Passed: Threads mixed media preflight requires Cloudinary settings');

  const missingThreadsCreds = getPublishRequirements('threads', mixedAssets, cloudinaryConfig);
  assert.strictEqual(missingThreadsCreds.canPublish, false);
  assert.deepStrictEqual(
    missingThreadsCreds.missingFields.map((item) => item.field),
    ['threadsToken', 'threadsUserId'],
  );
  assert.match(missingThreadsCreds.reason, /Threads User ID/);
  console.log('Test 2-2 Passed: Threads preflight requires Threads token and user id');

  const missingThreadsImgbb = getPublishRequirements('threads', [imageAsset], {
    threadsToken: 'threads-token',
    threadsUserId: 'threads-user',
  });
  assert.strictEqual(missingThreadsImgbb.canPublish, false);
  assert.deepStrictEqual(
    missingThreadsImgbb.missingFields.map((item) => item.field),
    ['imgbbKey'],
  );
  assert.match(missingThreadsImgbb.reason, /imgbb API Key/);
  console.log('Test 2-2a Passed: Threads image publishing requires imgbb');

  const tooManyThreadsAssets = Array.from({ length: 21 }, (_, index) => ({
    id: `image-${index + 1}`,
    type: 'image',
    mime: 'image/png',
    sourceUrl: SAMPLE_IMAGE,
  }));
  const tooManyThreadsAssetsResult = getPublishRequirements('threads', tooManyThreadsAssets, {
    threadsToken: 'threads-token',
    threadsUserId: 'threads-user',
    imgbbKey: 'imgbb-key',
  });
  assert.strictEqual(tooManyThreadsAssetsResult.canPublish, false);
  assert.match(tooManyThreadsAssetsResult.reason, /最多支援 20 個素材/);
  console.log('Test 2-2b Passed: Threads carousel rejects more than 20 assets');

  const selectedThreadsOnly = resolvePublishTargets(['instagram', 'threads'], { threads: true });
  assert.deepStrictEqual(selectedThreadsOnly.platforms, ['threads']);
  assert.strictEqual(selectedThreadsOnly.error, '');
  console.log('Test 2-3 Passed: selected publish targets only include explicitly selected platforms');

  const noExplicitTarget = resolvePublishTargets(['instagram', 'threads'], {});
  assert.deepStrictEqual(noExplicitTarget.platforms, []);
  assert.match(noExplicitTarget.error, /請選擇本次發布平台/);
  console.log('Test 2-4 Passed: multi-platform publish requires explicit target selection');

  const instagramCalls = createMockAxios();
  await postToInstagram({
    igUserId: 'ig-user',
    pageToken: 'page-token',
    caption: 'mixed caption',
    assets: mixedAssets,
    ...cloudinaryConfig,
  });

  const instagramMediaCalls = instagramCalls
    .filter((call) => call.url === 'http://localhost:3001/api/llm/proxy')
    .filter((call) => call.data.url === 'https://graph.facebook.com/v20.0/ig-user/media')
    .map((call) => call.data.data);

  assert.deepStrictEqual(instagramMediaCalls[0], {
    image_url: 'https://res.cloudinary.com/demo/image/upload/sample.png',
    is_carousel_item: true,
  });
  assert.deepStrictEqual(instagramMediaCalls[1], {
    media_type: 'VIDEO',
    video_url: 'https://res.cloudinary.com/demo/video/upload/sample.mp4',
    is_carousel_item: true,
  });
  assert.deepStrictEqual(instagramMediaCalls[2], {
    media_type: 'CAROUSEL',
    children: ['container-1', 'container-2'],
    caption: 'mixed caption',
  });
  console.log('Test 3 Passed: Instagram API creates mixed image/video carousel payloads');

  const threadsCalls = createMockAxios();
  await postToThreads({
    threadsUserId: 'threads-user',
    threadsToken: 'threads-token',
    text: 'mixed thread',
    assets: mixedAssets,
    ...cloudinaryConfig,
  });

  const threadsCreateCalls = getProxyCalls(threadsCalls, 'https://graph.threads.net/v1.0/threads-user/threads');
  assert.deepStrictEqual(getUrlParams(threadsCreateCalls[0].data.url), {
    media_type: 'IMAGE',
    image_url: 'https://res.cloudinary.com/demo/image/upload/sample.png',
    is_carousel_item: 'true',
  });
  assert.deepStrictEqual(getUrlParams(threadsCreateCalls[1].data.url), {
    media_type: 'VIDEO',
    video_url: 'https://res.cloudinary.com/demo/video/upload/sample.mp4',
    is_carousel_item: 'true',
  });
  assert.deepStrictEqual(getUrlParams(threadsCreateCalls[2].data.url), {
    media_type: 'CAROUSEL',
    children: 'container-1,container-2',
    text: 'mixed thread',
  });
  assert.deepStrictEqual(threadsCreateCalls[0].data.data, {});
  assert.deepStrictEqual(threadsCreateCalls[1].data.data, {});
  assert.deepStrictEqual(threadsCreateCalls[2].data.data, {});

  const threadsPublishCall = getProxyCalls(threadsCalls, 'https://graph.threads.net/v1.0/threads-user/threads_publish')[0];
  assert.deepStrictEqual(getUrlParams(threadsPublishCall.data.url), {
    creation_id: 'container-3',
  });
  assert.deepStrictEqual(threadsPublishCall.data.data, {});
  const threadsStatusCalls = getProxyCalls(threadsCalls, 'https://graph.threads.net/v1.0/container-');
  assert.deepStrictEqual(
    threadsStatusCalls.map((call) => ({
      url: call.data.url,
      params: call.data.data,
    })),
    [
      {
        url: 'https://graph.threads.net/v1.0/container-2',
        params: { fields: 'id,status,error_message' },
      },
      {
        url: 'https://graph.threads.net/v1.0/container-3',
        params: { fields: 'id,status,error_message' },
      },
    ],
  );
  console.log('Test 4 Passed: Threads API uses query-param container creation and comma-separated carousel children');

  const threadsImageOnlyCalls = createMockAxios();
  await postToThreads({
    threadsUserId: 'threads-user',
    threadsToken: 'threads-token',
    text: 'single image thread',
    assets: [imageAsset],
    imgbbKey: 'imgbb-key',
  });
  const singleImageCreateCall = getProxyCalls(threadsImageOnlyCalls, 'https://graph.threads.net/v1.0/threads-user/threads')[0];
  assert.deepStrictEqual(getUrlParams(singleImageCreateCall.data.url), {
    text: 'single image thread',
    media_type: 'IMAGE',
    image_url: 'https://i.imgbb.com/demo/sample.png',
  });
  const singleImageStatusCalls = getProxyCalls(threadsImageOnlyCalls, 'https://graph.threads.net/v1.0/container-');
  assert.strictEqual(singleImageStatusCalls.length, 0);
  console.log('Test 4-1 Passed: Threads single-image publishing uses official query params');

  const threadsVideoOnlyCalls = createMockAxios();
  await postToThreads({
    threadsUserId: 'threads-user',
    threadsToken: 'threads-token',
    text: 'single video thread',
    assets: [videoAsset],
    ...cloudinaryConfig,
  });
  const singleVideoCreateCall = getProxyCalls(threadsVideoOnlyCalls, 'https://graph.threads.net/v1.0/threads-user/threads')[0];
  assert.deepStrictEqual(getUrlParams(singleVideoCreateCall.data.url), {
    text: 'single video thread',
    media_type: 'VIDEO',
    video_url: 'https://res.cloudinary.com/demo/video/upload/sample.mp4',
  });
  const singleVideoStatusCall = getProxyCalls(threadsVideoOnlyCalls, 'https://graph.threads.net/v1.0/container-1')[0];
  assert.deepStrictEqual(singleVideoStatusCall.data.data, {
    fields: 'id,status,error_message',
  });
  console.log('Test 4-1a Passed: Threads single-video publishing waits for container processing before publish');

  const threadsTextOnlyCalls = createMockAxios();
  await postToThreads({
    threadsUserId: 'threads-user',
    threadsToken: 'threads-token',
    text: 'text only thread',
  });
  const textOnlyCreateCall = getProxyCalls(threadsTextOnlyCalls, 'https://graph.threads.net/v1.0/threads-user/threads')[0];
  assert.deepStrictEqual(getUrlParams(textOnlyCreateCall.data.url), {
    text: 'text only thread',
    media_type: 'TEXT',
  });
  console.log('Test 4-2 Passed: Threads text-only publishing uses official query params');

  await assert.rejects(
    () => postToThreads({
      threadsUserId: 'threads-user',
      threadsToken: 'threads-token',
      text: 'too many assets',
      assets: tooManyThreadsAssets,
      imgbbKey: 'imgbb-key',
    }),
    /最多支援 20 個素材/,
  );
  console.log('Test 4-3 Passed: Threads publish blocks more than 20 assets before calling API');

  const facebookCalls = createMockAxios();
  await postToFacebook({
    pageId: 'page-id',
    pageToken: 'page-token',
    message: 'video post',
    assets: [videoAsset],
    ...cloudinaryConfig,
  });

  const videoCall = facebookCalls.find((call) =>
    call.url === 'http://localhost:3001/api/llm/proxy'
    && call.data.url === 'https://graph.facebook.com/v20.0/page-id/videos');

  assert.deepStrictEqual(videoCall.data.data, {
    file_url: 'https://res.cloudinary.com/demo/video/upload/sample.mp4',
    description: 'video post',
    access_token: 'page-token',
  });
  console.log('Test 5 Passed: Facebook Page API publishes a single video through /videos');

  console.log('\nAll mixed media publishing TDD tests passed successfully!');
} catch (error) {
  console.error('Publishing TDD Test Suite Failed:', error.message);
  process.exit(1);
} finally {
  axios.post = originalPost;
}
