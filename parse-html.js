import fs from 'fs';

const html = fs.readFileSync('/var/folders/72/ncbsxmqj2vj3ks52wppynw3c0000gn/T/xhs-debug-1780243115818/page.html', 'utf-8');

// Find all buttons or elements with "发布"
const index = html.indexOf('发布');
if (index === -1) {
  console.log('Text "发布" not found in HTML!');
} else {
  console.log('Found "发布" at index', index);
  console.log(html.substring(Math.max(0, index - 200), index + 200));
}

const pubIndex = html.indexOf('xhs-publish-btn');
if (pubIndex === -1) {
  console.log('xhs-publish-btn not found in HTML!');
} else {
  console.log('Found xhs-publish-btn at index', pubIndex);
  console.log(html.substring(Math.max(0, pubIndex - 200), pubIndex + 200));
}

