const NAP_AFTER_MS = 18000;

export const tabbyArt = name => `./assets/assistant/tabby-${name}.png`;

export function mascotMarkup() {
  return `<span class="tabby-mascot" aria-hidden="true">
    <span class="tabby-floor"></span>
    ${[['active', 'welcome'], ['thinking', 'thinking'], ['sleeping', 'idle']].map(([pose, art]) =>
      `<img class="tabby-pose tabby-pose-${pose}" src="${tabbyArt(art)}" alt="" draggable="false" />`).join('')}
    <span class="tabby-snooze"><span>z</span><span>Z</span></span>
    <span class="tabby-peek"><img src="${tabbyArt('launcher')}" alt="" draggable="false" /></span>
  </span>`;
}

export function mountAssistantMascot(launcher, signal) {
  let timer, thinking = false;

  function setPose(pose) {
    if (signal.aborted) return;
    clearTimeout(timer);
    launcher.dataset.pose = pose;
    if (pose !== 'thinking') timer = setTimeout(() => { launcher.dataset.pose = 'sleeping'; }, NAP_AFTER_MS);
  }

  const wake = () => setPose(thinking ? 'thinking' : 'active');
  setPose('ready');
  launcher.addEventListener('pointerdown', wake, { signal });
  launcher.addEventListener('pointerup', wake, { signal });
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });

  return { wake, setThinking(value) { thinking = value; wake(); } };
}
