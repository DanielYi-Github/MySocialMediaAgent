import { publish } from './server/xhs.js';
import fs from 'fs';
import path from 'path';

async function run() {
  console.log('Testing XHS publish directly...');
  try {
    // Generate a dummy image if we don't have one, or just use base64 of a 1x1 pixel
    const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';
    await publish({
      title: '測試自動發文 ' + Date.now(),
      content: '這是一篇透過腳本測試發佈的貼文',
      imageBase64: imageBase64,
      imageMime: 'image/png'
    });
    console.log('Publish function returned success!');
  } catch (e) {
    console.error('Publish failed:', e);
  }
}
run();
