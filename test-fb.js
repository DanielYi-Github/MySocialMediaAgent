import { publish } from './server/fb.js';

async function run() {
  console.log('Testing FB publish directly...');
  try {
    const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
    await publish({
      caption: '自動發文測試 ' + Date.now(),
      imageBase64: imageBase64,
      imageMime: 'image/png'
    });
    console.log('FB Publish function returned success!');
  } catch (e) {
    console.error('FB Publish failed:', e);
  }
}
run();
