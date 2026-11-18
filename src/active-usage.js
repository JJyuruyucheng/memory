export function trackActiveUsage(record) {
  const lifetime = new AbortController(), { signal } = lifetime;
  const minute = 60_000, idleAfter = 5 * minute;
  let timer, lastAction = Date.now();
  const foreground = () => document.visibilityState === 'visible' && document.hasFocus();

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (!foreground() || Date.now() - lastAction >= idleAfter) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (foreground() && Date.now() - lastAction < idleAfter) void record().catch(() => {});
      schedule();
    }, minute);
  }

  function wake() { lastAction = Date.now(); if (!timer) schedule(); }
  for (const event of ['pointerdown', 'keydown', 'scroll']) document.addEventListener(event, wake, { passive: true, capture: true, signal });
  window.addEventListener('focus', wake, { signal });
  window.addEventListener('blur', schedule, { signal });
  document.addEventListener('visibilitychange', () => { if (foreground()) lastAction = Date.now(); schedule(); }, { signal });
  schedule();
  return () => { lifetime.abort(); clearTimeout(timer); };
}
