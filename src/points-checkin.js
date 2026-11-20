const dayMs = 86_400_000;
const attentionWindow = 5 * 60_000;

export function mountPointsCheckin(provider, { progress, completed }) {
  const events = new AbortController(), { signal } = events;
  const foreground = () => document.visibilityState === 'visible' && document.hasFocus();
  let generation = 0, timer, midnight, running = false, checked = false, lastAttention = Date.now();

  function pause() {
    generation++;
    clearTimeout(timer);
    running = false;
    progress(null);
  }

  function wake() {
    lastAttention = Date.now();
    if (foreground()) void start();
  }

  function resetAtMidnight(result) {
    clearTimeout(midnight);
    const nextDay = Date.parse(`${result.day}T00:00:00+08:00`) + dayMs;
    const delay = nextDay - Date.parse(result.server_time);
    if (!Number.isFinite(delay)) return;
    midnight = setTimeout(() => {
      pause();
      checked = false;
      completed();
      if (foreground() && Date.now() - lastAttention < attentionWindow) void start();
    }, Math.max(50, delay + 120));
  }

  async function start() {
    if (signal.aborted || running || checked || !foreground()) return;
    const attempt = ++generation;
    const valid = () => !signal.aborted && attempt === generation && foreground();
    running = true;
    try {
      const ticket = await provider.pointsBeginCheckin();
      if (!valid()) return;
      resetAtMidnight(ticket);
      if (ticket.checked_in) {
        checked = true; pause(); completed(); return;
      }
      if (!ticket.token) {
        progress(null);
        return;
      }
      const elapsedFrom = performance.now();
      const seconds = Math.max(1, Math.ceil(ticket.wait_seconds || 60));
      let lastTick = elapsedFrom;

      async function submit() {
        if (!valid()) return;
        try {
          const summary = await provider.pointsFinishCheckin(ticket.token);
          if (!valid()) return;
          checked = true; pause(); completed(summary);
        } catch (error) {
          if (!valid()) return;
          if (error.code === 'POINTS_CHECKIN_EXPIRED') {
            pause(); void start();
          } else if (error.code === 'POINTS_CHECKIN_EARLY' || error.code === 'NETWORK' || error.code === 'RATE_LIMITED') {
            timer = setTimeout(() => void submit(), 2500);
          } else pause();
        }
      }

      function tick() {
        if (!valid()) return;
        const now = performance.now();
        if (now - lastTick > 4000) { pause(); void start(); return; }
        lastTick = now;
        const left = Math.max(0, Math.ceil(seconds - (now - elapsedFrom) / 1000));
        progress(left);
        if (left === 0) void submit();
        else timer = setTimeout(tick, 250);
      }
      tick();
    } catch (error) {
      if (!valid()) return;
      pause();
      if (error.code === 'NETWORK' || error.code === 'RATE_LIMITED') {
        timer = setTimeout(() => { if (foreground()) void start(); }, 5000);
      }
    }
  }

  function visibility() { if (foreground()) wake(); else pause(); }
  document.addEventListener('visibilitychange', visibility, { signal });
  window.addEventListener('focus', wake, { signal });
  window.addEventListener('blur', pause, { signal });
  window.addEventListener('online', () => { if (!running) wake(); }, { signal });
  for (const type of ['pointerdown', 'keydown', 'scroll']) document.addEventListener(type, wake, { passive: true, capture: true, signal });
  wake();
  return () => { events.abort(); clearTimeout(midnight); pause(); };
}
