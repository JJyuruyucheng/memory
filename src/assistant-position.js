const STORAGE_KEY = 'chaoxi-tabby-position';
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

function storedPosition() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return value;
  } catch { /* Storage is optional in private browsing. */ }
  return { x: 1, y: 1 };
}

export function mountAssistantPosition(root, launcher, panel, { interactive, signal }) {
  const visual = window.visualViewport;
  const position = interactive ? storedPosition() : { x: 1, y: 1 };
  let press, suppressClick = false, timer;

  function bounds() {
    const mobile = matchMedia('(max-width: 760px)').matches;
    const edge = mobile ? 12 : 22;
    const viewportLeft = visual?.offsetLeft ?? 0;
    const top = (visual?.offsetTop ?? 0) + edge;
    const insets = getComputedStyle(root);
    const left = viewportLeft + (parseFloat(insets.paddingLeft) || 0) + edge;
    const right = viewportLeft + (visual?.width ?? innerWidth) - (parseFloat(insets.paddingRight) || 0) - edge;
    const safeArea = parseFloat(insets.paddingBottom) || 0;
    const viewportBottom = top - edge + (visual?.height ?? innerHeight);
    const navigation = mobile ? document.querySelector('.mobile-nav') : null;
    const navTop = navigation?.getBoundingClientRect().top ?? viewportBottom - safeArea;
    return { left, top, right, bottom: Math.min(viewportBottom, navTop) - edge, mobile };
  }

  function layout() {
    const { left, top, right, bottom, mobile } = bounds();
    const size = launcher.offsetWidth;
    const x = clamp(left + position.x * (right - left - size), left, right - size);
    const y = clamp(top + position.y * (bottom - top - size), top, bottom - size);
    launcher.style.left = `${x}px`;
    launcher.style.top = `${y}px`;
    if (!panel || panel.hidden) return;

    const gap = 10;
    const below = bottom - y - size - gap;
    const above = y - top - gap;
    const available = mobile ? bottom - top : Math.max(above, below);
    const base = !mobile && available >= 275;
    panel.style.width = `${Math.min(388, right - left)}px`;
    panel.style.height = `${Math.min(520, base ? available : bottom - top)}px`;
    const panelX = mobile ? right - panel.offsetWidth : clamp(x + size - panel.offsetWidth, left, right - panel.offsetWidth);
    const panelY = base ? (above >= below ? y - gap - panel.offsetHeight : y + size + gap) : bottom - panel.offsetHeight;
    panel.style.left = `${panelX}px`;
    panel.style.top = `${Math.max(top, panelY)}px`;
  }

  window.addEventListener('resize', layout, { signal });
  visual?.addEventListener('resize', layout, { signal });
  visual?.addEventListener('scroll', layout, { signal });
  if (!interactive) return layout;

  launcher.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick = false;
    const rect = launcher.getBoundingClientRect();
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: event.clientX - rect.left, dy: event.clientY - rect.top, moving: false };
    launcher.setPointerCapture(event.pointerId);
    timer = setTimeout(() => {
      if (!press) return;
      press.moving = true;
      suppressClick = true;
      launcher.classList.add('is-dragging');
    }, 320);
  }, { signal });

  launcher.addEventListener('pointermove', event => {
    if (press?.id !== event.pointerId) return;
    if (!press.moving) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
        clearTimeout(timer);
        suppressClick = true;
      }
      return;
    }
    const { left, top, right, bottom } = bounds();
    const size = launcher.offsetWidth;
    position.x = clamp((event.clientX - press.dx - left) / Math.max(1, right - left - size), 0, 1);
    position.y = clamp((event.clientY - press.dy - top) / Math.max(1, bottom - top - size), 0, 1);
    layout();
  }, { signal });

  function endPress(event) {
    if (press?.id !== event.pointerId) return;
    clearTimeout(timer);
    if (press.moving) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(position)); } catch { /* Keep the in-page position. */ }
    }
    press = null;
    launcher.classList.remove('is-dragging');
  }

  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) launcher.addEventListener(event, endPress, { signal });
  launcher.addEventListener('click', event => {
    if (suppressClick && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    suppressClick = false;
  }, { signal, capture: true });
  launcher.addEventListener('contextmenu', event => event.preventDefault(), { signal });
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return layout;
}
