import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

const CACHE_TTL_MS = 30 * 60 * 1000;
const mediaCache = new Map();

export function storeMediaDataUrl({ dataUrl, mime, fileName }) {
  cleanupExpiredEntries();

  const match = String(dataUrl || '').match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error('媒體格式錯誤，無法建立暫存 URL。');
  }

  const resolvedMime = mime || match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const id = crypto.randomUUID();

  mediaCache.set(id, {
    buffer,
    mime: resolvedMime,
    fileName: fileName || `asset-${id}`,
    createdAt: Date.now(),
  });

  return { id, mime: resolvedMime };
}

export function getMediaCacheEntry(id) {
  cleanupExpiredEntries();
  return mediaCache.get(id) || null;
}

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [id, entry] of mediaCache.entries()) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      mediaCache.delete(id);
    }
  }
}
