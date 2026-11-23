// Supabase controls session validity. The local lease protects against stale
// cross-tab writes after sign-out or a different sign-in.
export function createRememberedSessionStorage({ storage, key, onExternalChange = () => {} }) {
  // Keep the SDK's logical key so its refresh lock stays shared. The old app
  // only knows the legacy location and cannot delete the migrated session.
  const persistentKey = `${key}-persistent`;
  let fallback = null, memoryOnly = !storage;
  let knownLease = null, mayStart = false, blocked = false, notified = false;
  const rawRead = () => {
    if (memoryOnly) return fallback;
    try { return storage.getItem(persistentKey); } catch { memoryOnly = true; return fallback; }
  };
  const rawRemove = () => { fallback = null; if (!memoryOnly) try { storage.removeItem(persistentKey); } catch { /* Storage may be unavailable. */ } };
  const rawWrite = value => {
    if (!memoryOnly) {
      try { storage.setItem(persistentKey, value); return; }
      catch { memoryOnly = true; try { storage.removeItem(persistentKey); } catch { /* Storage may be unavailable. */ } }
    }
    fallback = value;
  };
  const sessionUser = value => {
    try { const session = JSON.parse(value); return typeof session?.access_token === 'string' && typeof session.refresh_token === 'string' && typeof session.user?.id === 'string' ? session.user.id : null; }
    catch { return null; }
  };
  function decode(raw) {
    try {
      const { version, leaseId, session } = JSON.parse(raw);
      if (version === 1 && typeof leaseId === 'string' && leaseId && sessionUser(session)) return { version, leaseId, session };
    } catch { /* Unrecognized data cannot be restored. */ }
    return null;
  }
  if (!memoryOnly) {
    try {
      const legacy = storage.getItem(key);
      if (legacy !== null) {
        const record = decode(legacy);
        if (record && rawRead() === null) rawWrite(JSON.stringify(record));
        if (!memoryOnly) storage.removeItem(key);
      }
    } catch { /* Browser storage may be unavailable. */ }
  }
  const fingerprint = record => record && `${record.leaseId}:${sessionUser(record.session)}`;
  function invalidate() {
    blocked = true; mayStart = false;
    if (!notified) { notified = true; queueMicrotask(() => { if (blocked) onExternalChange(); }); }
  }
  function read() {
    if (blocked) return null;
    const raw = rawRead();
    if (!raw) { if (knownLease && !mayStart) invalidate(); return null; }
    const record = decode(raw);
    if (!record) {
      rawRemove(); if (knownLease) invalidate(); return null;
    }
    const lease = fingerprint(record);
    if (knownLease && knownLease !== lease && !mayStart) { invalidate(); return null; }
    knownLease = lease; return record;
  }
  const check = event => { if (event.type !== 'storage' || event.key === persistentKey || event.key === null) read(); };
  return {
    getItem(name) { return name === key ? read()?.session ?? null : null; },
    setItem(name, value) {
      if (name !== key || !sessionUser(value) || blocked) return;
      let record;
      if (mayStart) {
        record = { version: 1, leaseId: crypto.randomUUID(), session: value };
        mayStart = false; knownLease = fingerprint(record);
      } else {
        record = read();
        if (!record || blocked || fingerprint(record) !== knownLease || sessionUser(record.session) !== sessionUser(value)) return;
        record.session = value; // Rotation never changes which sign-in owns the lease.
      }
      rawWrite(JSON.stringify(record));
    },
    removeItem(name) {
      if (name !== key) return;
      let ownsStoredLease = memoryOnly;
      if (!memoryOnly) {
        const raw = rawRead();
        ownsStoredLease = !raw || (knownLease !== null && fingerprint(decode(raw)) === knownLease);
      }
      if (ownsStoredLease) {
        if (!memoryOnly && knownLease !== null) {
          // Do not restore a legacy copy written by a still-open older tab.
          try { storage.removeItem(key); } catch { /* Storage may be unavailable. */ }
        }
        rawRemove();
      }
      mayStart = false; blocked = true; knownLease = null;
      if (!ownsStoredLease) invalidate();
    },
    beginSignIn() { blocked = false; notified = false; mayStart = true; knownLease = null; },
    watch(target = globalThis) {
      target.addEventListener?.('visibilitychange', check);
      target.addEventListener?.('pageshow', check);
      target.addEventListener?.('storage', check);
      read();
      return () => {
        target.removeEventListener?.('visibilitychange', check);
        target.removeEventListener?.('pageshow', check);
        target.removeEventListener?.('storage', check);
      };
    },
  };
}
