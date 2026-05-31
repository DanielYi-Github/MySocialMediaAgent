import { publish } from './server/ig.js';

async function run() {
  console.log('Testing IG publish directly...');
  try {
    const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
    await publish({
      caption: '自動發文測試 ' + Date.now(),
      imageBase64: imageBase64,
      imageMime: 'image/png'
    });
    console.log('IG Publish function returned success!');
  } catch (e) {
    console.error('IG Publish failed:', e);
  }
}
run();
