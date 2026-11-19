const DOCK_SIDES = ['left', 'right', 'top', 'bottom'];
const DOCK_DISTANCE = 16;
export const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

function storedPosition(key, initial) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
      return { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1), dock: DOCK_SIDES.includes(value.dock) ? value.dock : '' };
    }
  } catch { /* Storage is optional in private browsing. */ }
  return { ...initial };
}

export function mountFloatingPosition(root, launcher, { storageKey, initial, half = false, onLayout, signal }) {
  const visual = window.visualViewport;
  const position = storageKey ? storedPosition(storageKey, initial) : { ...initial };
  let press, suppressClick = false, timer;

  function bounds() {
    const mobile = matchMedia('(max-width: 760px)').matches;
    const margin = half || mobile ? 12 : 22;
    const viewportLeft = visual?.offsetLeft ?? 0;
    const viewportTop = visual?.offsetTop ?? 0;
    const insets = getComputedStyle(root);
    const left = viewportLeft + (parseFloat(insets.paddingLeft) || 0) + margin;
    const top = viewportTop + (parseFloat(insets.paddingTop) || 0) + margin;
    const right = viewportLeft + (visual?.width ?? innerWidth) - (parseFloat(insets.paddingRight) || 0) - margin;
    const safeArea = parseFloat(insets.paddingBottom) || 0;
    const viewportBottom = viewportTop + (visual?.height ?? innerHeight) - safeArea;
    const navigation = mobile ? document.querySelector('.mobile-nav') : null;
    const navTop = navigation?.getBoundingClientRect().top ?? viewportBottom;
    const lyricsTop = document.querySelector('.bgm-lyrics:not([hidden])')?.getBoundingClientRect().top;
    return { left, top, right, bottom: Math.min(viewportBottom, navTop, lyricsTop ?? viewportBottom) - margin, mobile, margin };
  }

  function layout({ left, top, right, bottom, mobile, margin } = bounds()) {
    const { dock } = position;
    if (dock) launcher.dataset.dock = dock;
    else launcher.removeAttribute('data-dock');
    const width = launcher.offsetWidth;
    const height = launcher.offsetHeight;
    let x = clamp(left + position.x * (right - left - width), left, right - width);
    let y = clamp(top + position.y * (bottom - top - height), top, bottom - height);
    if (dock === 'left') x = left - margin - (half ? width / 2 : 0);
    if (dock === 'right') x = right + margin - (half ? width / 2 : width);
    if (dock === 'top') y = top - margin - (half ? height / 2 : 0);
    if (dock === 'bottom') y = bottom + margin - (half ? height / 2 : height);
    launcher.style.left = `${x}px`;
    launcher.style.top = `${y}px`;
    onLayout?.({ left, top, right, bottom, mobile, x, y, width, height });
  }

  const refresh = () => layout();
  window.addEventListener('resize', refresh, { signal });
  window.addEventListener('chaoxi-layout-change', refresh, { signal });
  visual?.addEventListener('resize', refresh, { signal });
  visual?.addEventListener('scroll', refresh, { signal });
  if (!storageKey) return refresh;

  function startDrag() {
    if (!press || press.moving) return;
    clearTimeout(timer);
    press.moving = true;
    suppressClick = true;
    launcher.classList.add('is-dragging');
  }

  launcher.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (event.pointerType !== 'touch') event.preventDefault();
    suppressClick = false;
    const rect = launcher.getBoundingClientRect();
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, moving: false, moved: false,
      grabX: (event.clientX - rect.left) / rect.width, grabY: (event.clientY - rect.top) / rect.height };
    launcher.setPointerCapture(event.pointerId);
    timer = setTimeout(startDrag, 280);
  }, { signal });

  launcher.addEventListener('pointermove', event => {
    if (press?.id !== event.pointerId) return;
    if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return;
    startDrag();
    press.moved = true;
    if (position.dock) {
      position.dock = '';
      launcher.removeAttribute('data-dock');
    }
    const frame = bounds();
    const { left, top, right, bottom } = frame;
    const width = launcher.offsetWidth, height = launcher.offsetHeight;
    const x = event.clientX - press.grabX * width;
    const y = event.clientY - press.grabY * height;
    position.x = clamp((x - left) / Math.max(1, right - left - width), 0, 1);
    position.y = clamp((y - top) / Math.max(1, bottom - top - height), 0, 1);
    const distances = [x - left, right - width - x, y - top, bottom - height - y];
    const closest = Math.min(...distances);
    press.dock = closest <= DOCK_DISTANCE ? DOCK_SIDES[distances.indexOf(closest)] : '';
    layout(frame);
  }, { signal });

  function endPress(event) {
    if (press?.id !== event.pointerId) return;
    clearTimeout(timer);
    const touchTap = event.type === 'pointerup' && event.pointerType === 'touch' && !press.moving;
    if (press.moved) {
      position.dock = event.type === 'pointerup' ? press.dock : '';
      try { localStorage.setItem(storageKey, JSON.stringify(position)); } catch { /* Keep the in-page position. */ }
    }
    press = null;
    launcher.classList.remove('is-dragging');
    layout();
    // A captured touch near the viewport edge can finish without a native click.
    if (touchTap) {
      launcher.click();
      suppressClick = true;
    }
  }

  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) launcher.addEventListener(event, endPress, { signal });
  launcher.addEventListener('click', event => {
    if (suppressClick && (event.detail > 0 || event.pointerType === 'touch')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    suppressClick = false;
  }, { signal, capture: true });
  launcher.addEventListener('dragstart', event => event.preventDefault(), { signal });
  launcher.addEventListener('contextmenu', event => event.preventDefault(), { signal });
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return refresh;
}

export function mountAssistantPosition(root, launcher, panel, { interactive, signal }) {
  return mountFloatingPosition(root, launcher, {
    storageKey: interactive ? 'chaoxi-tabby-position' : '', initial: { x: 1, y: 1 }, signal,
    onLayout({ left, top, right, bottom, mobile, x, y, width, height }) {
      if (!panel || panel.hidden) return;
      const gap = 10;
      const below = bottom - y - height - gap, above = y - top - gap;
      const available = Math.max(above, below), hasRoom = available >= 275;
      panel.style.width = `${Math.min(388, right - left)}px`;
      panel.style.height = `${Math.min(520, hasRoom ? available : bottom - top)}px`;
      const panelX = mobile ? right - panel.offsetWidth : clamp(x + width - panel.offsetWidth, left, right - panel.offsetWidth);
      const panelY = hasRoom ? (above >= below ? y - gap - panel.offsetHeight : y + height + gap) : bottom - panel.offsetHeight;
      panel.style.left = `${panelX}px`;
      panel.style.top = `${Math.max(top, panelY)}px`;
    },
  });
}
