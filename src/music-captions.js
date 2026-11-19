import { mountFloatingPosition, placeAdjacent } from './assistant-position.js';
import { lyricParts } from './background-music-data.js';
import { icon } from './icons.js';

const positionKey = 'chaoxi-bgm-caption-position';
const styleKey = 'chaoxi-bgm-caption-style';
const tones = {
  sage: ['浅绿', '#b8e5b8'], sky: ['天蓝', '#a8d9ff'], honey: ['暖金', '#ffdc97'], rose: ['淡粉', '#ffc0d0'],
};
const choice = (name, value, label) => `<button type="button" data-style="${name}" data-value="${value}">${label}</button>`;
const control = (name, label, art) => `<button type="button" data-caption="${name}" aria-label="${label}" title="${label}">${icon(art)}</button>`;

export function mountMusicCaptions(widget, audio, { onReserve, onControl }, signal) {
  const block = document.createElement('div'), settings = document.createElement('section');
  block.className = 'bgm-lyrics';
  block.hidden = true;
  block.setAttribute('aria-label', '当前歌词');
  block.innerHTML = `
    <button type="button" class="bgm-lyric-lines" title="拖动歌词" aria-expanded="false" aria-controls="bgm-lyric-toolbar">
      <span class="bgm-lyric-line"></span><span class="bgm-lyric-line"></span>
    </button>
    <div class="bgm-lyric-toolbar" id="bgm-lyric-toolbar" role="group" aria-label="歌词控件">
      ${control('previous', '上一首', 'previous')}
      ${control('play', '播放', 'play')}
      ${control('next', '下一首', 'next')}
      <button type="button" class="bgm-lyric-settings" data-caption="settings" aria-label="歌词样式" title="歌词样式" aria-expanded="false" aria-controls="bgm-lyric-options">${icon('settings')}</button>
      ${control('close', '关闭歌词', 'close')}
    </div>`;
  settings.className = 'bgm-lyric-options';
  settings.id = 'bgm-lyric-options';
  settings.hidden = true;
  settings.setAttribute('aria-label', '歌词样式');
  settings.innerHTML = `
    <div class="bgm-lyric-choices" role="group" aria-label="歌词排列">
      ${choice('direction', 'horizontal', '横排')}${choice('direction', 'vertical', '竖排')}
    </div>
    <div class="bgm-lyric-choices" role="group" aria-label="歌词行数">
      ${choice('rows', '1', '单行')}${choice('rows', '2', '双行')}
    </div>
    <div class="bgm-lyric-tones" role="group" aria-label="高亮颜色">
      <span>高亮</span>
      ${Object.entries(tones).map(([key, [label, color]]) => `<button type="button" data-style="tone" data-value="${key}" aria-label="${label}" title="${label}" style="--swatch:${color}"></button>`).join('')}
    </div>
    <label><span>字号 <output data-value="size"></output></span><input name="size" aria-label="歌词字号" type="range" min="12" max="30" /></label>
    <label><span>透明度 <output data-value="opacity"></output></span><input name="opacity" aria-label="歌词透明度" type="range" min="0" max="85" /></label>`;
  widget.append(block, settings);
  const handle = block.querySelector('.bgm-lyric-lines'), rows = [...handle.children];
  const toolbar = block.querySelector('.bgm-lyric-toolbar'), toggle = toolbar.querySelector('.bgm-lyric-settings');
  const inputs = { size: settings.querySelector('[name="size"]'), opacity: settings.querySelector('[name="opacity"]') };
  let style = { direction: 'horizontal', rows: '2', tone: 'sage', size: 18, opacity: 16 }, floating = false;
  try {
    style = { ...style, ...JSON.parse(localStorage.getItem(styleKey) || '{}') };
    floating = Boolean(localStorage.getItem(positionKey));
  } catch { /* Use the defaults if storage is unavailable. */ }

  let lines = [], drawn = [], raf = 0;
  function renderRow(row, slot, index, now) {
    const line = lines[index], duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (row.hidden === Boolean(line)) row.hidden = !line;
    if (!drawn[slot] || drawn[slot].line !== line || drawn[slot].duration !== duration) {
      const parts = line ? lyricParts(line, lines[index + 1]?.time, duration) : [];
      const nodes = parts.map(part => {
        const token = document.createElement('span'), ink = document.createElement('span');
        token.className = 'bgm-lyric-token';
        ink.className = 'bgm-lyric-ink';
        ink.setAttribute('aria-hidden', 'true');
        ink.textContent = part.text;
        token.append(part.text, ink);
        part.ink = ink;
        return token;
      });
      row.replaceChildren(...nodes);
      drawn[slot] = { line, parts, duration };
    }
    for (const part of drawn[slot].parts) {
      const progress = Math.round(100 * Math.max(0, Math.min(1, (now - part.time) / Math.max(.02, part.end - part.time))));
      if (part.progress !== progress) {
        part.progress = progress;
        part.ink.style.setProperty('--lyric-fill', `${progress}%`);
      }
    }
  }

  function paint() {
    const now = audio.currentTime;
    const current = Math.max(0, lines.findLastIndex(line => line.time <= now));
    const double = style.rows === '2', second = double && current % 2 === 1;
    renderRow(rows[0], 0, second ? current + 1 : current, second ? -1 : now);
    renderRow(rows[1], 1, double ? (second ? current : current + 1) : -1, second ? now : -1);
  }

  function playbackFrame() {
    raf = 0;
    if (!block.hidden) {
      paint();
      if (!audio.paused && !audio.ended) raf = requestAnimationFrame(playbackFrame);
    }
  }

  function repaint() {
    cancelAnimationFrame(raf);
    playbackFrame();
  }

  function renderStyle() {
    block.dataset.direction = style.direction;
    block.dataset.rows = style.rows;
    block.style.setProperty('--lyric-size', `${style.size}px`);
    block.style.setProperty('--lyric-alpha', String(1 - style.opacity / 100));
    block.style.setProperty('--lyric-ink', (tones[style.tone] ?? tones.sage)[1]);
    for (const button of settings.querySelectorAll('[data-style]')) {
      button.setAttribute('aria-pressed', String(button.dataset.value === style[button.dataset.style]));
    }
    for (const [name, input] of Object.entries(inputs)) {
      input.value = String(style[name]);
      settings.querySelector(`[data-value="${name}"]`).value = input.value + (name === 'size' ? ' px' : '%');
    }
  }
  renderStyle();
  const refresh = mountFloatingPosition(widget, block, {
    storageKey: positionKey, initial: { x: 1, y: 1 }, handle, dockable: false, avoidLyrics: false, signal,
    bottomInset() {
      return !floating && style.direction === 'vertical' && !block.classList.contains('is-dragging')
        ? document.querySelector('.tabby-launcher')?.offsetHeight ?? 0 : 0;
    },
    onDrop() { floating = true; },
    onLayout(frame) {
      onReserve(!block.hidden && !floating && style.direction === 'horizontal' ? frame.height + frame.margin : 0);
      const { x, y, left, top } = frame;
      block.dataset.toolbar = style.direction === 'vertical' ? (x - left >= 42 ? 'left' : 'right')
        : (y - top >= 40 ? 'above' : 'below');
      if (!settings.hidden) {
        const tools = toolbar.getBoundingClientRect();
        placeAdjacent(settings, { ...frame, x: tools.left, y: tools.top, width: tools.width, height: tools.height });
      }
    },
  });
  const sizes = new ResizeObserver(refresh);
  sizes.observe(block);
  sizes.observe(settings);
  signal.addEventListener('abort', () => { sizes.disconnect(); cancelAnimationFrame(raf); }, { once: true });

  function saveStyle() {
    renderStyle();
    repaint();
    refresh();
    try { localStorage.setItem(styleKey, JSON.stringify(style)); } catch { /* Preferences still apply to this page. */ }
  }

  function showControls(open) {
    block.toggleAttribute('data-controls', open);
    handle.setAttribute('aria-expanded', String(open));
  }

  function showSettings(open) {
    settings.hidden = !open;
    block.toggleAttribute('data-settings', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) refresh();
  }

  function dismiss() {
    showSettings(false);
    showControls(false);
  }

  handle.addEventListener('click', event => {
    if (event.detail === 0) {
      if (block.hasAttribute('data-controls')) dismiss();
      else showControls(true);
    }
  }, { signal });
  toolbar.addEventListener('click', event => {
    const action = event.target.closest('[data-caption]')?.dataset.caption;
    if (action === 'settings') showSettings(settings.hidden);
    else if (action) onControl(action);
  }, { signal });
  settings.addEventListener('click', event => {
    const button = event.target.closest('[data-style]');
    if (button) { style[button.dataset.style] = button.dataset.value; saveStyle(); }
  }, { signal });
  settings.addEventListener('input', event => {
    if (!Object.hasOwn(inputs, event.target.name)) return;
    style[event.target.name] = Number(event.target.value);
    saveStyle();
  }, { signal });
  document.addEventListener('pointerdown', event => {
    if (!block.contains(event.target) && !settings.contains(event.target)) dismiss();
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') dismiss();
  }, { signal });
  for (const event of ['playing', 'pause', 'ended', 'timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'emptied']) {
    audio.addEventListener(event, repaint, { signal });
  }

  return {
    render(next) {
      if (lines === next || (!next.length && block.hidden)) return;
      lines = next;
      block.hidden = !lines.length;
      if (block.hidden) dismiss();
      repaint();
      refresh();
    },
    transport(playing, canPlay, canStep) {
      const play = toolbar.querySelector('[data-caption="play"]'), label = playing ? '暂停' : '播放';
      play.innerHTML = icon(playing ? 'pause' : 'play');
      play.setAttribute('aria-label', label);
      play.title = label;
      play.disabled = !canPlay;
      toolbar.querySelector('[data-caption="previous"]').disabled = !canStep;
      toolbar.querySelector('[data-caption="next"]').disabled = !canStep;
    },
  };
}
