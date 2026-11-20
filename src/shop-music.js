const source = new URL('../assets/reward-covers/shop-piano.mp3', import.meta.url);

export function mountShopMusic(background, changed) {
  const audio = new Audio(source.href), events = new AbortController(), { signal } = events;
  audio.loop = true;
  audio.preload = 'none';
  audio.volume = 0.24;
  let active = false, ownsSound = false, loading = false, message = '', revision = 0;

  function stop(restore = true) {
    revision++;
    audio.pause();
    audio.currentTime = 0;
    loading = false;
    if (ownsSound && restore) background?.resumeFromShop();
    ownsSound = false;
  }

  for (const type of ['playing', 'pause']) audio.addEventListener(type, changed, { signal });
  audio.addEventListener('error', () => {
    if (!active || !ownsSound) return;
    stop();
    message = '店内音乐暂时无法播放。';
    changed();
  }, { signal });
  return {
    setShopActive(value) {
      if (active === value) return;
      active = value;
      if (!active) { stop(); message = ''; }
    },
    getShopState() { return { playing: ownsSound && !audio.paused && !loading, loading, available: active, message }; },
    async toggleShop() {
      if (!active) return;
      if (ownsSound) { stop(); changed(); return; }
      const attempt = ++revision;
      background?.suspendForShop();
      ownsSound = true; loading = true; message = '';
      try {
        const playing = audio.play();
        changed();
        await playing;
        if (attempt === revision) loading = false;
      } catch {
        if (attempt !== revision) return;
        stop();
        message = '店内音乐未能播放，可以再试一次。';
      } finally { if (!signal.aborted) changed(); }
    },
    destroy() { events.abort(); stop(false); audio.removeAttribute('src'); audio.load(); },
  };
}
