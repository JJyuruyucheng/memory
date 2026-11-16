import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';

/** Render every saved attachment; upload validation owns the nine-image limit. */
export function renderEntryMedia(entry, safeUrl) {
  const media = Array.isArray(entry.media) ? entry.media : [];
  if (!media.length) return '';
  return `<div class="memory-media count-${Math.min(media.length, 3)}">${media.map((file, index) => file.unavailable
    ? `<div class="media-thumb media-unavailable" aria-label="${esc(file.name)}暂时无法加载">${icon('photo')}<span>附件暂时无法加载</span><small>${esc(file.error || '检查网络后重试')}</small><button class="text-button" data-action="retry-media">重新加载附件</button></div>`
    : `<button class="media-thumb" data-action="media" data-id="${esc(entry.id)}" data-index="${index}" aria-label="打开${esc(file.name || (file.type === 'video' ? '回忆视频' : '回忆照片'))}">${file.type === 'video' ? `<video src="${safeUrl(file.url)}" preload="metadata" playsinline></video><span class="video-label">${icon('video')} 视频</span>` : `<img src="${safeUrl(file.url)}" alt="${esc(file.name || entry.title || '回忆照片')}" loading="lazy" />`}</button>`).join('')}</div>`;
}
