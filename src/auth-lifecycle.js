// Calling GoTrue's public start/stopAutoRefresh methods removes its browser
// visibility listener. Own that lifecycle explicitly so a suspended phone tab
// resumes its refresh tick immediately instead of waiting for a stale timer.
export function createBrowserAuthLifecycle(auth, { windowTarget = globalThis, documentTarget = globalThis.document, navigatorTarget = globalThis.navigator } = {}) {
  let enabled = true, disposed = false, revision = 0, pending = Promise.resolve();
  function reconcile() {
    const expected = ++revision;
    pending = pending.catch(() => {}).then(async () => {
      if (expected !== revision) return;
      const running = enabled && !disposed && documentTarget?.visibilityState !== 'hidden' && navigatorTarget?.onLine !== false;
      // These operations schedule SDK work; do not perform auth requests inside
      // an onAuthStateChange callback, which would re-enter the SDK's lock.
      if (running) await auth.startAutoRefresh?.(); else await auth.stopAutoRefresh?.();
    }).catch(() => { /* A later visibility/online event or explicit retry can recover. */ });
    return pending;
  }
  const onResume = () => { if (enabled && !disposed) reconcile(); };
  documentTarget?.addEventListener?.('visibilitychange', onResume);
  for (const event of ['pageshow', 'online', 'offline']) windowTarget.addEventListener?.(event, onResume);
  reconcile();
  return {
    resume() { if (disposed) return pending; enabled = true; return reconcile(); },
    pause() { enabled = false; return reconcile(); },
    dispose() {
      disposed = true; enabled = false;
      documentTarget?.removeEventListener?.('visibilitychange', onResume);
      for (const event of ['pageshow', 'online', 'offline']) windowTarget.removeEventListener?.(event, onResume);
      return reconcile();
    },
  };
}
