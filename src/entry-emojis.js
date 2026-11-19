import { ALLOWED_FILE_TYPES } from './domain.js';
import { icon } from './icons.js';

const groups = [
  ['常用', [['😊', '微笑'], ['😂', '笑哭'], ['🥰', '喜欢'], ['🤣', '大笑'], ['😇', '天使'], ['😆', '开心'],
    ['❤️', '爱心'], ['😘', '亲亲'], ['👍', '点赞'], ['✨', '闪光'], ['🎉', '庆祝'], ['🐱', '猫咪']]],
  ['心情', [['🙂', '浅笑'], ['😄', '咧嘴笑'], ['🤭', '偷笑'], ['🥺', '可怜巴巴'], ['😌', '放松'], ['😅', '尴尬'],
    ['😭', '大哭'], ['😢', '流泪'], ['😮', '惊讶'], ['😴', '犯困'], ['🤔', '思考'], ['😤', '生气']]],
  ['亲密', [['💖', '闪亮爱心'], ['🤗', '拥抱'], ['💕', '双心'], ['💗', '心动'], ['💌', '情书'], ['💋', '吻痕'],
    ['🌷', '郁金香'], ['🌹', '玫瑰'], ['🎁', '礼物'], ['💐', '花束'], ['🥂', '碰杯'], ['🎂', '生日蛋糕']]],
  ['日常', [['☀️', '晴天'], ['🌧️', '下雨'], ['🌙', '月亮'], ['🌈', '彩虹'], ['🍜', '面条'], ['🍰', '蛋糕'],
    ['☕', '咖啡'], ['📷', '相机'], ['🎵', '音乐'], ['🏠', '回家'], ['🐾', '爪印'], ['🌿', '小叶子']]],
];
const imageTypes = Object.keys(ALLOWED_FILE_TYPES).filter(type => ALLOWED_FILE_TYPES[type] === 'image').join(',');

export function entryEmojiMarkup() {
  return `<div class="entry-emoji">
    <button type="button" class="entry-emoji-trigger" aria-expanded="false" aria-controls="entry-emoji-panel">${icon('smile')}表情</button>
    <div id="entry-emoji-panel" class="entry-emoji-panel" role="group" aria-label="选择表情" hidden>
      <div class="entry-emoji-groups" role="group" aria-label="表情分类">
        ${groups.map(([label], index) => `<button type="button" data-group="${index}" aria-pressed="${index === 0}">${label}</button>`).join('')}
      </div>
      <div class="entry-emoji-grid" role="group" aria-label="Emoji 表情"></div>
      <div class="entry-emoji-footer">
        <button type="button" class="entry-sticker-add">${icon('photo')}添加表情包</button>
        <input type="file" class="entry-sticker-input" accept="${imageTypes}" multiple hidden />
        <span class="entry-emoji-status" role="status"></span>
      </div>
    </div>
  </div>`;
}

export function mountEntryEmoji(root, textarea, addFiles) {
  const controller = new AbortController(), { signal } = controller;
  const trigger = root.querySelector('.entry-emoji-trigger'), panel = root.querySelector('.entry-emoji-panel');
  const grid = panel.querySelector('.entry-emoji-grid'), fileInput = panel.querySelector('.entry-sticker-input');
  const status = panel.querySelector('.entry-emoji-status'), dialog = root.closest('dialog');

  function showGroup(index) {
    for (const tab of panel.querySelectorAll('[data-group]')) {
      tab.setAttribute('aria-pressed', String(Number(tab.dataset.group) === index));
    }
    grid.innerHTML = groups[index][1].map(([emoji, label]) =>
      `<button type="button" data-emoji="${emoji}" aria-label="${label}" title="${label}">${emoji}</button>`).join('');
  }

  function setOpen(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    status.textContent = '';
  }

  showGroup(0);
  trigger.addEventListener('click', () => setOpen(panel.hidden), { signal });
  panel.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.classList.contains('entry-sticker-add')) fileInput.click();
    else if (button.dataset.group !== undefined) showGroup(Number(button.dataset.group));
    else if (button.dataset.emoji) {
      const { selectionStart: start, selectionEnd: end, maxLength } = textarea;
      const emoji = button.dataset.emoji;
      if (textarea.value.length - (end - start) + emoji.length > maxLength) {
        status.textContent = '正文已到字数上限。';
        return;
      }
      textarea.setRangeText(emoji, start, end, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      setOpen(false);
      textarea.focus({ preventScroll: true });
    }
  }, { signal });
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    addFiles(files);
    setOpen(false);
    trigger.focus({ preventScroll: true });
  }, { signal });
  dialog.addEventListener('pointerdown', event => {
    if (!panel.hidden && !root.contains(event.target)) setOpen(false);
  }, { signal });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || panel.hidden) return;
    event.preventDefault();
    setOpen(false);
    trigger.focus({ preventScroll: true });
  }, { signal });
  return () => controller.abort();
}
