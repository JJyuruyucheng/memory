import { mountFloatingPosition, placeAdjacent } from './assistant-position.js';
import { icon } from './icons.js';

const positionKey = 'chaoxi-bgm-caption-position';
const styleKey = 'chaoxi-bgm-caption-style';

export function mountMusicCaptions(widget, onReserve, signal) {
  const block = document.createElement('div'), settings = document.createElement('section');
  block.className = 'bgm-lyrics';
  block.hidden = true;
  block.setAttribute('aria-label', '当前歌词');
  block.innerHTML = `
    <button type="button" class="bgm-lyric-line" title="按住拖动歌词"><span></span></button>
    <button type="button" class="bgm-lyric-settings" aria-label="歌词样式" title="歌词样式" aria-expanded="false" aria-controls="bgm-lyric-options">${icon('settings')}</button>`;
  settings.className = 'bgm-lyric-options';
  settings.id = 'bgm-lyric-options';
  settings.hidden = true;
  settings.setAttribute('aria-label', '歌词样式');
  settings.innerHTML = `
    <div class="bgm-lyric-directions" aria-label="歌词排列">
      <button type="button" data-direction="horizontal">横排</button><button type="button" data-direction="vertical">竖排</button>
    </div>
    <label><span>字号 <output data-value="size"></output></span><input name="size" aria-label="歌词字号" type="range" min="12" max="30" /></label>
    <label><span>透明度 <output data-value="opacity"></output></span><input name="opacity" aria-label="歌词透明度" type="range" min="0" max="85" /></label>`;
  widget.append(block, settings);
  const line = block.querySelector('.bgm-lyric-line'), text = line.firstElementChild;
  const toggle = block.querySelector('.bgm-lyric-settings');
  const inputs = { size: settings.querySelector('[name="size"]'), opacity: settings.querySelector('[name="opacity"]') };
  let style = { direction: 'horizontal', size: 16, opacity: 24 }, floating = false;
  try {
    style = { ...style, ...JSON.parse(localStorage.getItem(styleKey) || '{}') };
    floating = Boolean(localStorage.getItem(positionKey));
  } catch { /* Use the defaults if storage is unavailable. */ }

  function renderStyle() {
    block.dataset.direction = style.direction;
    block.style.setProperty('--lyric-size', `${style.size}px`);
    block.style.setProperty('--lyric-alpha', String(1 - style.opacity / 100));
    for (const button of settings.querySelectorAll('[data-direction]')) {
      button.setAttribute('aria-pressed', String(button.dataset.direction === style.direction));
    }
    for (const [name, input] of Object.entries(inputs)) {
      input.value = String(style[name]);
      settings.querySelector(`[data-value="${name}"]`).value = input.value + (name === 'size' ? ' px' : '%');
    }
  }
  renderStyle();
  const refresh = mountFloatingPosition(widget, block, {
    storageKey: positionKey, initial: { x: 1, y: 1 }, handle: line, dockable: false, avoidLyrics: false, signal,
    onDrop() { floating = true; },
    onLayout(frame) {
      onReserve(!block.hidden && !floating && style.direction === 'horizontal' ? frame.height + frame.margin : 0);
      if (!settings.hidden) placeAdjacent(settings, frame);
    },
  });
  const sizes = new ResizeObserver(refresh);
  sizes.observe(block); sizes.observe(settings);
  signal.addEventListener('abort', () => sizes.disconnect(), { once: true });

  function save() {
    renderStyle(); refresh();
    try { localStorage.setItem(styleKey, JSON.stringify(style)); } catch { /* Preferences still apply to this page. */ }
  }
  function closeSettings() { settings.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  toggle.addEventListener('click', () => {
    if (settings.hidden) { settings.hidden = false; toggle.setAttribute('aria-expanded', 'true'); refresh(); }
    else closeSettings();
  }, { signal });
  settings.addEventListener('click', event => {
    const choice = event.target.closest('[data-direction]');
    if (choice) { style.direction = choice.dataset.direction; save(); }
  }, { signal });
  settings.addEventListener('input', event => {
    if (!Object.hasOwn(inputs, event.target.name)) return;
    style[event.target.name] = Number(event.target.value);
    save();
  }, { signal });
  document.addEventListener('click', event => {
    if (!settings.contains(event.target) && !block.contains(event.target)) closeSettings();
  }, { signal });

  return (value, visible) => {
    if (visible && value !== text.textContent) text.textContent = value;
    if (visible === block.hidden) {
      block.hidden = !visible;
      if (!visible) closeSettings();
      refresh();
    }
  };
}
