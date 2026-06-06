function buildDirectUploadInstruction(tmpFiles) {
  if (!tmpFiles?.length) return '';

  const fileList = `[${tmpFiles.map(file => JSON.stringify(file)).join(', ')}]`;
  return [
    '',
    '2. 圖片檔案已由系統準備好，路徑如下：',
    fileList,
    `   你必須直接使用 await page.locator('input[type="file"]').first().setInputFiles(${fileList}); 或更精確的 input[type="file"] locator 上傳這些檔案。`,
    '   不要開啟作業系統檔案選擇視窗，不要要求使用者手動選檔；若 locator 匹配多個 input，使用 .first() 或 .nth(index)。',
  ].join('\n');
}

export function buildFacebookPublishGoal({ caption, tmpFiles = [] }) {
  const uploadInstruction = buildDirectUploadInstruction(tmpFiles);
  return `請幫我完成完整的 Facebook 發文流程：\n1. 點擊首頁上的「有什麼新鮮事？」發文框。${uploadInstruction}\n3. 尋找文案輸入框，並輸入內容：\n${caption}\n4. 最後點擊「發佈」按鈕完成發文。\n\n成功判斷：看到發佈成功提示或發文對話框關閉。`;
}

export function buildInstagramPublishGoal({ caption, tmpFiles = [] }) {
  const uploadInstruction = buildDirectUploadInstruction(tmpFiles);
  return `請幫我完成完整的 Instagram 發文流程：\n1. 點擊畫面上左側或下方的建立貼文按鈕（通常是「+」或「建立」）。${uploadInstruction}\n3. 接著持續點擊「下一步」按鈕，直到出現填寫文案的畫面。\n4. 尋找文案輸入框，並輸入內容：\n${caption}\n5. 最後點擊「分享」按鈕完成發佈。\n\n成功判斷：看到「已分享」提示、頁面跳轉，或建立貼文的對話框 (dialog) 關閉消失。`;
}

export function buildXhsPublishGoal({ title, content, tmpFiles = [] }) {
  const uploadInstruction = buildDirectUploadInstruction(tmpFiles);
  return `請幫我完成小紅書發文表單的填寫流程：
1. 尋找發佈貼文或圖文上傳的區域。${uploadInstruction}
3. 尋找標題輸入框，輸入：
${title}
4. 尋找內文輸入框（div[role="textbox"] 或 contenteditable），先 click() 聚焦，再用 page.keyboard.type() 輸入內容（不要用 fill()）：
${content}
5. 填寫完成後，回傳 done。

⚠️ 重要：不要嘗試點擊「发布」按鈕，也不要嘗試修改頁面 DOM。系統會自動處理發布。你只需要完成上傳和填寫，完成後回傳 done 即可。

成功判斷：標題和內文都已成功填入。`;
}
