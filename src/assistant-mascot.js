import { mountTabbyMotion } from './tabby-motion.js';

const NAP_AFTER_MS = 18000;

export const tabbyArt = name => `./assets/assistant/tabby-${name}.png`;

export function mascotMarkup() {
  return `<span class="tabby-mascot" aria-hidden="true">
    <span class="tabby-floor"></span>
    <span class="tabby-motion"></span>
    ${[['active', 'welcome'], ['thinking', 'thinking'], ['sleeping', 'idle'], ['annoyed', 'retry']].map(([pose, art]) =>
      `<img class="tabby-pose tabby-pose-${pose}" src="${tabbyArt(art)}" alt="" draggable="false" />`).join('')}
    <span class="tabby-snooze"><span>z</span><span>Z</span></span>
    <span class="tabby-peek"><img src="./assets/app-cat-head-192.png" alt="" draggable="false" /></span>
  </span>`;
}

export function mountAssistantMascot(launcher, signal) {
  let timer, thinking = false, taps = [];

  function setPose(pose, duration = NAP_AFTER_MS, next = 'sleeping') {
    if (signal.aborted) return;
    clearTimeout(timer);
    launcher.dataset.pose = pose;
    if (pose !== 'thinking' && pose !== 'sleeping') timer = setTimeout(() => setPose(next), duration);
  }

  const wake = () => setPose(thinking ? 'thinking' : 'active');
  function poke() {
    const time = Date.now();
    taps = [...taps.filter(tap => time - tap < 1250), time];
    if (taps.length >= 3 && !thinking) { taps = []; setPose('annoyed', 2200, 'active'); }
  }
  setPose('ready');
  launcher.addEventListener('pointerdown', wake, { signal });
  launcher.addEventListener('pointerup', wake, { signal });
  if (!launcher.classList.contains('is-locked')) void mountTabbyMotion(launcher, signal).catch(() => {});
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });

  return { wake, poke, setThinking(value, answered = false) {
    thinking = value;
    if (answered) setPose('happy', 2600, 'active');
    else wake();
  } };
}
