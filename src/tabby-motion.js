const sheet = new URL('../assets/assistant/tabby-motion-v2.webp', import.meta.url);
const columns = 14, rows = 13;

// Time, atlas key pose (four frames per interval), speed through the poses, and action.
const stroll = {
  offset: 0, air: [24.7, 27], travel: [510, 2850],
  beats: [
    [0, 0, 0, 'rise'], [580, 4, .008, 'walk'], [1630, 13, .012, 'run'],
    [2410, 23, .009, 'jump'], [3180, 28, .006, 'settle'], [3850, 32, 0],
  ],
};
const hop = {
  offset: 129, air: [4.7, 7],
  beats: [[0, 0, 0, 'rise'], [555, 4, .007, 'jump'], [1190, 8, .007, 'settle'], [1860, 12, 0]],
};

const unit = value => Math.max(0, Math.min(1, value));
const smooth = value => value * value * (3 - 2 * value);

function sample(beats, time) {
  const end = beats.findIndex(beat => beat[0] > time);
  if (end < 0) return { key: beats.at(-1)[1] };
  const [from, a, speedIn, step] = beats[end - 1], [to, b, speedOut] = beats[end];
  const span = to - from, t = (time - from) / span;
  // Match the speed at each join so the paws accelerate and decelerate through it.
  const key = a + (b - a) * smooth(t) + span * t * (1 - t) * (speedIn * (1 - t) - speedOut * t);
  return { key, step };
}

export async function mountTabbyMotion(launcher, signal) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const sprite = launcher.querySelector('.tabby-motion');
  let art, pose, frameRequest, lastFrame, offsetX = 0;

  function setFrame(index) {
    if (lastFrame === index) return;
    lastFrame = index;
    sprite.style.backgroundPosition = `${index % columns * 100 / (columns - 1)}% ${Math.floor(index / columns) * 100 / (rows - 1)}%`;
  }

  function stop() {
    cancelAnimationFrame(frameRequest);
    delete launcher.dataset.motion;
  }

  function start(clip) {
    const began = performance.now(), startX = offsetX;
    const { left, width } = launcher.getBoundingClientRect();
    const endX = clip.travel ? Math.min(startX, Math.max(-21, (8 - left) * 100 / width)) : startX;
    function draw(now) {
      const elapsed = Math.max(0, now - began);
      const { key, step } = sample(clip.beats, elapsed);
      setFrame(clip.offset + Math.round(key * 4));
      if (clip.travel) {
        const [from, to] = clip.travel;
        offsetX = startX + (endX - startX) * smooth(unit((elapsed - from) / (to - from)));
        launcher.style.setProperty('--tabby-x', `${offsetX}%`);
      }
      const [takeoff, landing] = clip.air;
      const air = unit((key - takeoff) / (landing - takeoff));
      const lift = 4 * air * (1 - air);
      launcher.style.setProperty('--tabby-air', String(lift));
      sprite.style.transform = `translateY(${-lift * 17}%)`;
      if (!step) { stop(); return; }
      if (launcher.dataset.motion !== step) launcher.dataset.motion = step;
      frameRequest = requestAnimationFrame(draw);
    }
    draw(began);
  }

  function sync() {
    const parked = launcher.dataset.dock || launcher.classList.contains('is-dragging');
    const next = parked || reduced.matches ? '' : launcher.dataset.pose;
    if (next === pose) return;
    pose = next;
    stop();
    if (!next) {
      offsetX = 0;
      launcher.style.removeProperty('--tabby-x');
      launcher.style.removeProperty('--tabby-air');
    }
    if (next === 'active') start(stroll);
    if (next === 'happy') start(hop);
  }

  async function prepare() {
    if (reduced.matches || art || signal.aborted) return;
    art = new Image();
    art.src = sheet.href;
    await art.decode();
    if (signal.aborted) return;
    sprite.style.backgroundImage = `url("${sheet.href}")`;
    const observer = new MutationObserver(sync);
    observer.observe(launcher, { attributes: true, attributeFilter: ['data-pose', 'data-dock', 'class'] });
    reduced.addEventListener('change', sync, { signal });
    signal.addEventListener('abort', () => { observer.disconnect(); stop(); }, { once: true });
    sync();
  }
  if (reduced.matches) reduced.addEventListener('change', () => { void prepare().catch(() => {}); }, { once: true, signal });
  else await prepare();
}
