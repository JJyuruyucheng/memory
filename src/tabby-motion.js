const frames = new URL('../assets/assistant/tabby-motion-v1.webp', import.meta.url);
const blend = (from, to, part) => from + (to - from) * part;
const roll = (time, length) => Math.min(1, time / length);

function hop(time, x = 0, facing = 1) {
  const part = roll(time, 780);
  const air = Math.sin(Math.PI * Math.min(1, Math.max(0, (part - .17) / .68)));
  const frame = part < .18 ? 12 : part < .43 ? 13 : part < .79 ? 14 : 15;
  return { step: 'jump', frame, x, y: -air * 17, facing };
}

function active(time) {
  const step = time % 4500;
  if (step < 1450) return { step: 'walk', frame: Math.floor(step / 138) % 8, x: blend(0, -23, step / 1450), y: 0, facing: 1 };
  if (step < 1730) return { step: 'look', frame: 6, x: -23, y: 0, facing: 1 };
  if (step < 2550) return { step: 'run', frame: 8 + Math.floor((step - 1730) / 93) % 4, x: blend(-23, 18, (step - 1730) / 820), y: 0, facing: -1 };
  if (step < 3330) return hop(step - 2550, blend(18, 0, (step - 2550) / 780));
  return { step: 'look', frame: 15, x: 0, y: 0, facing: 1 };
}

export async function mountTabbyMotion(launcher, signal) {
  const art = new Image();
  art.src = frames.href;
  await art.decode();
  if (signal.aborted) return;
  const figure = launcher.querySelector('.tabby-motion'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  figure.style.backgroundImage = `url("${frames.href}")`;
  let animation, started, pose, lastFrame;
  function draw(now) {
    const time = now - started;
    const next = pose === 'happy' ? hop(time) : active(time);
    if (next.frame !== lastFrame) {
      lastFrame = next.frame;
      figure.style.backgroundPosition = `${next.frame % 4 * (100 / 3)}% ${Math.floor(next.frame / 4) * (100 / 3)}%`;
    }
    if (launcher.dataset.motion !== next.step) launcher.dataset.motion = next.step;
    figure.style.transform = `translate(${next.x}%, ${next.y}%) scaleX(${next.facing})`;
    animation = requestAnimationFrame(draw);
  }
  function sync() {
    const next = !launcher.dataset.dock && !launcher.classList.contains('is-dragging') && !reduced.matches
      ? launcher.dataset.pose : '';
    const moving = ['active', 'happy'].includes(next);
    if (next === pose && moving) return;
    pose = next;
    cancelAnimationFrame(animation);
    delete launcher.dataset.motion;
    if (moving) { started = performance.now(); draw(started); }
  }
  const observer = new MutationObserver(sync);
  observer.observe(launcher, { attributes: true, attributeFilter: ['data-pose', 'data-dock', 'class'] });
  reduced.addEventListener('change', sync, { signal });
  signal.addEventListener('abort', () => { observer.disconnect(); cancelAnimationFrame(animation); }, { once: true });
  sync();
}
