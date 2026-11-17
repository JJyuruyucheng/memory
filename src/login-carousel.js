import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { loadLocalScript } from './local-script.js';

function photoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, location.href);
    return ['https:', 'blob:'].includes(url.protocol) || url.origin === location.origin ? url.href : '';
  } catch { return ''; }
}

function preloadPhoto(photo) {
  return new Promise(resolve => {
    const url = photoUrl(photo.url);
    if (!url) { resolve(null); return; }
    const image = new Image();
    let complete = false;
    const finish = success => {
      if (complete) return;
      complete = true; clearTimeout(timer); image.onload = image.onerror = null;
      resolve(success ? { ...photo, url } : null);
    };
    const timer = setTimeout(() => finish(false), 15_000);
    image.onload = () => finish(true); image.onerror = () => finish(false);
    image.decoding = 'async'; image.src = url;
  });
}

// This controller owns only the story panel. Loading a photograph never rerenders login or CAPTCHA.
export function mountLoginCarousel(story, { loadPhotos, getPhotoUrl, photos: initialPhotos } = {}) {
  if (!story) return { destroy() {}, update() {} };
  const fallback = [...story.children];
  const mediaQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let destroyed = false, epoch = 0, carousel, timer, current = 0, shown = [], heldUrl = '', navigation = 0;
  const photoCache = new Map(), loading = new Map();
  let userPaused = false, hovered = false, focused = false, cleanPanel = () => {};
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const paused = () => userPaused || hovered || focused || document.hidden || mediaQuery.matches;
  const selected = () => {
    story.querySelectorAll('[data-carousel-index]').forEach((dot, i) => dot.setAttribute('aria-current', String(i === current)));
    const status = story.querySelector('.login-photo-count');
    if (status) status.textContent = `${current + 1} / ${shown.length}`;
  };
  const schedule = () => {
    clear();
    if (!destroyed && shown.length > 1 && !paused()) timer = setTimeout(() => go(current + 1), 6000);
  };
  const ensure = index => {
    const photo = shown[index];
    if (!photo) return Promise.resolve(null);
    if (photoCache.has(photo.id)) return Promise.resolve(photoCache.get(photo.id));
    if (loading.has(photo.id)) return loading.get(photo.id);
    const work = Promise.resolve(photo.url || getPhotoUrl?.(photo.id)).then(url => preloadPhoto({ ...photo, url })).then(ready => {
      if (ready && !destroyed && shown.some(item => item.id === photo.id)) {
        photoCache.set(photo.id, ready);
        const image = [...story.querySelectorAll('.login-photo-slide img')].find(item => item.dataset.photoId === photo.id);
        if (image) image.src = ready.url;
      }
      return ready;
    }).catch(() => null).finally(() => loading.delete(photo.id));
    loading.set(photo.id, work); return work;
  };
  const showHold = () => {
    const hold = story.querySelector('.login-photo-hold');
    if (hold && heldUrl) { hold.src = heldUrl; hold.hidden = false; }
  };
  const rememberCurrent = ready => {
    if (!ready) return;
    heldUrl = ready.url;
    const hold = story.querySelector('.login-photo-hold'); if (hold) hold.hidden = true;
    ensure((current + 1) % shown.length);
  };
  const go = async (index, instant = false) => {
    if (!shown.length || destroyed) return;
    const target = (index + shown.length) % shown.length, request = ++navigation, expected = epoch;
    const ready = await ensure(target);
    if (destroyed || request !== navigation || expected !== epoch) return;
    if (!ready) { clear(); return; }
    current = target;
    if (carousel) carousel.scrollTo(current, instant || mediaQuery.matches);
    else story.querySelector('.login-photo-viewport')?.scrollTo({ left: story.querySelector('.login-photo-viewport').clientWidth * current, behavior: instant || mediaQuery.matches ? 'instant' : 'smooth' });
    selected(); rememberCurrent(ready); schedule();
  };
  const display = (photos, startIndex = 0) => {
    if (destroyed || !story.isConnected || !photos.length) return;
    const previousId = shown[current]?.id;
    cleanPanel(); carousel?.destroy(); carousel = null; clear();
    shown = photos; const previousIndex = photos.findIndex(photo => photo.id === previousId);
    current = previousIndex < 0 ? startIndex : previousIndex;
    fallback.forEach(child => child.hidden = true);
    story.classList.add('has-login-photos');
    story.querySelector('.login-photo-gallery')?.remove();
    const panel = document.createElement('div');
    panel.className = 'login-photo-gallery'; panel.setAttribute('role', 'region');
    panel.setAttribute('aria-roledescription', '轮播图'); panel.setAttribute('aria-label', '我们的登录页照片');
    panel.innerHTML = `<div class="login-photo-viewport" tabindex="0" aria-label="左右滑动查看照片"><div class="login-photo-track">${photos.map((photo, index) => `<div class="login-photo-slide" role="group" aria-roledescription="幻灯片" aria-label="第 ${index + 1} 张，共 ${photos.length} 张"><img ${photoCache.has(photo.id) ? `src="${esc(photoCache.get(photo.id).url)}"` : ''} data-photo-id="${esc(photo.id)}" alt="登录页展示照片 ${index + 1}" draggable="false" /></div>`).join('')}</div></div><img class="login-photo-hold" alt="" hidden /><div class="login-photo-brand"><img src="./assets/mark.svg" alt="" width="42" height="42" /><span>朝夕<small>我们的记忆</small></span></div><div class="login-photo-bottom"><p>朝夕之间，都是我们。</p><div class="login-photo-controls"><span class="login-photo-count num">${current + 1} / ${photos.length}</span>${photos.length > 1 ? `<button type="button" class="login-photo-arrow previous" data-carousel-step="-1" aria-label="上一张照片">${icon('chevron')}</button><div class="login-photo-dots" aria-label="选择照片">${photos.map((_, index) => `<button type="button" data-carousel-index="${index}" aria-label="查看第 ${index + 1} 张照片" aria-current="${index === current}"><span></span></button>`).join('')}</div><button type="button" class="login-photo-arrow" data-carousel-step="1" aria-label="下一张照片">${icon('chevron')}</button><button type="button" class="login-photo-pause" aria-label="${userPaused ? '播放' : '暂停'}照片轮播" aria-pressed="${userPaused}">${userPaused ? '播放' : '暂停'}</button>` : ''}</div></div>`;
    const title = document.createElement('h1'); title.className = 'sr-only'; title.textContent = '朝夕，我们的记忆';
    panel.prepend(title); story.append(panel);
    const viewport = panel.querySelector('.login-photo-viewport');
    const events = new AbortController(), options = { signal: events.signal };
    panel.addEventListener('click', event => {
      const dot = event.target.closest('[data-carousel-index]');
      const arrow = event.target.closest('[data-carousel-step]');
      if (dot) go(Number(dot.dataset.carouselIndex));
      else if (arrow) go(current + Number(arrow.dataset.carouselStep));
      else if (event.target.closest('.login-photo-pause')) {
        userPaused = !userPaused;
        const button = panel.querySelector('.login-photo-pause');
        button.textContent = userPaused ? '播放' : '暂停'; button.setAttribute('aria-pressed', String(userPaused));
        button.setAttribute('aria-label', `${userPaused ? '播放' : '暂停'}照片轮播`); schedule();
      }
    }, options);
    panel.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); go(current + (event.key === 'ArrowLeft' ? -1 : 1));
    }, options);
    panel.addEventListener('pointerenter', () => { hovered = true; schedule(); }, options);
    panel.addEventListener('pointerleave', () => { hovered = false; schedule(); }, options);
    panel.addEventListener('focusin', () => { focused = true; schedule(); }, options);
    panel.addEventListener('focusout', event => { focused = panel.contains(event.relatedTarget); schedule(); }, options);
    viewport.addEventListener('scroll', () => {
      if (carousel || !viewport.clientWidth) return;
      const index = Math.min(shown.length - 1, Math.round(viewport.scrollLeft / viewport.clientWidth));
      if (index !== current) {
        current = index; selected(); showHold();
        ensure(index).then(ready => { if (index === current && !destroyed && panel.isConnected) rememberCurrent(ready); });
        schedule();
      }
    }, { ...options, passive: true });
    cleanPanel = () => events.abort();
    selected(); go(current, true);
    if (photos.length > 1) loadLocalScript({ url: new URL('../assets/embla-carousel-8.6.0.js', import.meta.url), read: () => globalThis.EmblaCarousel, label: '照片轮播组件' }).then(Embla => {
      if (destroyed || !panel.isConnected) return;
      viewport.classList.add('is-embla'); viewport.scrollLeft = 0;
      carousel = Embla(viewport, { loop: true, startIndex: current, duration: mediaQuery.matches ? 0 : 28 });
      carousel.on('select', () => {
        current = carousel.selectedScrollSnap(); const index = current; selected(); showHold();
        ensure(index).then(ready => { if (index === current && !destroyed && panel.isConnected) rememberCurrent(ready); }); schedule();
      });
      carousel.on('pointerDown', clear); carousel.on('pointerUp', schedule);
    }).catch(() => {}); // Native horizontal scrolling and arrows stay available if the optional vendor fails.
  };
  const update = async photos => {
    if (destroyed) return;
    const attempt = ++epoch; navigation++;
    if (!Array.isArray(photos) || !photos.length) {
      cleanPanel(); carousel?.destroy(); carousel = null; clear(); shown = [];
      story.querySelector('.login-photo-gallery')?.remove(); story.classList.remove('has-login-photos');
      fallback.forEach(child => child.hidden = false); return;
    }
    const next = photos.slice(0, 8);
    for (let index = 0; index < next.length; index++) {
      let first;
      try { first = await preloadPhoto({ ...next[index], url: next[index].url || await getPhotoUrl?.(next[index].id) }); }
      catch { first = null; }
      if (destroyed || attempt !== epoch) return;
      if (!first) continue;
      // Retain the last successful panel until the next collection has a loaded image.
      photoCache.set(next[index].id, first); display(next, index); return;
    }
  };
  const onVisibility = () => schedule();
  document.addEventListener('visibilitychange', onVisibility);
  mediaQuery.addEventListener('change', onVisibility);
  if (initialPhotos) update(initialPhotos);
  else Promise.resolve().then(() => loadPhotos?.()).then(manifest => update(manifest?.photos || [])).catch(() => {});
  return {
    update,
    destroy() {
      destroyed = true; epoch++; clear(); cleanPanel(); carousel?.destroy();
      document.removeEventListener('visibilitychange', onVisibility); mediaQuery.removeEventListener('change', onVisibility);
    },
  };
}
