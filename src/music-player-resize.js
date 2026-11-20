const storageKey = 'chaoxi-bgm-size';
const clampScale = value => Math.min(1.65, Math.max(.72, value));

function savedScale() {
  try {
    const value = Number(localStorage.getItem(storageKey) || 1);
    return Number.isFinite(value) ? clampScale(value) : 1;
  } catch { return 1; }
}

function resizeDirection(box, x, y) {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
  let dx = x - box.left - box.width / 2, dy = y - box.top - box.height / 2;
  let distance = Math.hypot(dx, dy);
  const aheadX = x + 30 * dx / (distance || 1), aheadY = y + 30 * dy / (distance || 1);
  if (distance < 9 || aheadX < left || aheadX > left + width || aheadY < top || aheadY > top + height) {
    dx = left + width / 2 - x;
    dy = top + height / 2 - y;
    distance = Math.hypot(dx, dy);
  }
  return distance > 1 ? { x: dx / distance, y: dy / distance } : { x: 0, y: 1 };
}

export function mountMusicPlayerResize(widget, trigger, refresh, signal) {
  const panel = widget.querySelector('.bgm-panel');
  const handle = target => target instanceof Element ? target.closest('.bgm-trigger, .bgm-panel :is(button, input, select)') : null;
  let scale = savedScale(), drag, released;

  function render() {
    widget.style.setProperty('--bgm-size-pref', scale);
    refresh();
  }

  widget.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 2 || !event.isPrimary || drag) return;
    const source = handle(event.target);
    if (!source) return;
    event.preventDefault();
    const { pointerId, clientX: x, clientY: y } = event;
    const box = (source === trigger ? trigger : panel).getBoundingClientRect();
    drag = { pointerId, x, y, scale, direction: resizeDirection(box, x, y) };
    widget.setPointerCapture(pointerId);
  }, { signal });

  widget.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.pointerId) return;
    if (!(event.buttons & 2)) { finish(event); return; }
    const distance = (event.clientX - drag.x) * drag.direction.x + (event.clientY - drag.y) * drag.direction.y;
    if (Math.abs(distance) < 4 && !widget.classList.contains('is-resizing')) return;
    widget.classList.add('is-resizing');
    const next = Math.round(clampScale(drag.scale + distance / 120) * 100) / 100;
    if (next === scale) return;
    scale = next;
    render();
  }, { signal });

  function finish(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const changed = drag.scale !== scale;
    if (event.type === 'pointerup') released = { x: event.clientX, y: event.clientY };
    drag = undefined;
    widget.classList.remove('is-resizing');
    if (changed) {
      try { localStorage.setItem(storageKey, String(scale)); } catch { /* Keep the current size for this page. */ }
    }
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) widget.addEventListener(type, finish, { signal });
  document.addEventListener('pointerdown', () => { released = undefined; }, { capture: true, signal });
  document.addEventListener('contextmenu', event => {
    // Chromium can dispatch the menu on whatever sits under the release point.
    const endedHere = released?.x === event.clientX && released?.y === event.clientY;
    if (event.button === 2 && (drag || endedHere)) {
      event.preventDefault();
      released = undefined;
    }
  }, { capture: true, signal });
  render();
}
