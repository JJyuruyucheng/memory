// This browser retains official Auth tokens for 30 absolute days, never passwords.
// Only an explicit sign-in can open a new lease; refresh can only update that lease.
export const REMEMBER_FOR_MS = 30 * 24 * 60 * 60 * 1000;

export function createRememberedSessionStorage({ storage, key, now = Date.now, onExpired = () => {}, onExternalChange = () => {} }) {
  const fallback = new Map();
  let memoryOnly = !storage, timer, watching = false, target;
  let knownLease = null, mayStart = false, blocked = false, notified = false;
  const rawRead = () => {
    if (memoryOnly) return fallback.get(key) ?? null;
    try { return storage.getItem(key); } catch { memoryOnly = true; return fallback.get(key) ?? null; }
  };
  const rawRemove = () => { fallback.delete(key); if (!memoryOnly) try { storage.removeItem(key); } catch { /* Storage may be unavailable. */ } };
  const rawWrite = value => {
    if (!memoryOnly) {
      try { storage.setItem(key, value); return; }
      catch { memoryOnly = true; try { storage.removeItem(key); } catch { /* No persisted stale refresh token when removal is possible. */ } }
    }
    fallback.set(key, value);
  };
  const sessionUser = value => {
    try { const session = JSON.parse(value); return typeof session?.access_token === 'string' && typeof session.refresh_token === 'string' && typeof session.user?.id === 'string' ? session.user.id : null; }
    catch { return null; }
  };
  const fingerprint = record => `${record.leaseId}:${record.expiresAt}:${sessionUser(record.session)}`;
  function invalidate(expired = false) {
    blocked = true; mayStart = false; clearTimeout(timer);
    if (!notified) { notified = true; queueMicrotask(() => { if (blocked) (expired ? onExpired : onExternalChange)(); }); }
  }
  function read() {
    if (blocked) return null;
    const raw = rawRead();
    if (!raw) { if (knownLease && !mayStart) invalidate(); return null; }
    let record;
    try { record = JSON.parse(raw); } catch { rawRemove(); if (knownLease) invalidate(); return null; }
    if (record?.version !== 1 || typeof record.leaseId !== 'string' || !record.leaseId || !Number.isSafeInteger(record.expiresAt) || record.expiresAt > now() + REMEMBER_FOR_MS || !sessionUser(record.session)) {
      rawRemove(); if (knownLease) invalidate(); return null;
    }
    if (record.expiresAt <= now()) { rawRemove(); invalidate(true); return null; }
    const lease = fingerprint(record);
    if (knownLease && knownLease !== lease && !mayStart) { invalidate(); return null; }
    knownLease = lease; return record;
  }
  function schedule() {
    clearTimeout(timer);
    if (!watching) return;
    const record = read();
    if (record) { timer = setTimeout(schedule, Math.min(record.expiresAt - now() + 1, 2_147_483_647)); timer.unref?.(); }
  }
  const check = event => { if (!event || event.type !== 'storage' || event.key === key || event.key === null) schedule(); };
  return {
    getItem(name) { return name === key ? read()?.session ?? null : null; },
    setItem(name, value) {
      if (name !== key || !sessionUser(value) || blocked) return;
      let record;
      if (mayStart) {
        record = { version: 1, leaseId: crypto.randomUUID(), expiresAt: now() + REMEMBER_FOR_MS, session: value };
        mayStart = false; knownLease = fingerprint(record);
      } else {
        record = read();
        if (!record || blocked || fingerprint(record) !== knownLease || sessionUser(record.session) !== sessionUser(value)) return;
        record.session = value; // Rotation never changes leaseId or expiresAt.
      }
      rawWrite(JSON.stringify(record)); schedule();
    },
    removeItem(name) {
      if (name !== key) return;
      let ownsStoredLease = memoryOnly;
      if (!memoryOnly) {
        const raw = rawRead();
        try { ownsStoredLease = !raw || (knownLease !== null && fingerprint(JSON.parse(raw)) === knownLease); }
        catch { ownsStoredLease = false; }
      }
      mayStart = false; blocked = true; knownLease = null; clearTimeout(timer);
      if (ownsStoredLease) rawRemove(); else invalidate();
    },
    beginSignIn() { blocked = false; notified = false; mayStart = true; knownLease = null; clearTimeout(timer); },
    watch(eventTarget = globalThis) {
      target = eventTarget; watching = true;
      target.addEventListener?.('visibilitychange', check);
      target.addEventListener?.('pageshow', check);
      target.addEventListener?.('storage', check);
      schedule();
      return () => {
        watching = false; clearTimeout(timer);
        target.removeEventListener?.('visibilitychange', check);
        target.removeEventListener?.('pageshow', check);
        target.removeEventListener?.('storage', check);
      };
    },
  };
}
