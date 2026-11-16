// Only fixed, public, same-origin vendor code is eligible for these retries.
const pending = new Map();

export function loadLocalScript({ url, read, label = '页面组件', document: doc = globalThis.document,
  timeoutMs = 30_000, retryDelays = [600, 1500], setTimeout: delay = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout, now = Date.now } = {}) {
  const loaded = read?.();
  if (loaded) return Promise.resolve(loaded);
  let target, assetRoot;
  try { target = new URL(url, doc?.baseURI); assetRoot = new URL('./assets/', doc?.baseURI); }
  catch { return Promise.reject(new Error('组件地址必须为本站的公开资源。')); }
  if (!doc || target.origin !== assetRoot.origin || !target.pathname.startsWith(assetRoot.pathname)
    || !/^[A-Za-z0-9.-]+\.js$/.test(target.pathname.slice(assetRoot.pathname.length))) {
    return Promise.reject(new Error('组件地址必须为本站的公开资源。'));
  }
  const key = target.href;
  if (pending.has(key)) return pending.get(key);
  const attempt = number => new Promise((resolve, reject) => {
    const existing = read();
    if (existing) { resolve(existing); return; }
    const script = doc.createElement('script');
    const address = new URL(target);
    // A fresh retry also bypasses an intermediary's cached failed response.
    if (number) address.searchParams.set('retry', `${now()}-${number}`);
    script.src = address.href;
    script.async = true;
    let settled = false, timer;
    const finish = error => {
      if (settled) return;
      settled = true; cancel(timer); script.onload = null; script.onerror = null;
      const value = !error && read();
      if (value) { resolve(value); return; }
      script.remove();
      if (number < retryDelays.length) delay(() => resolve(attempt(number + 1)), retryDelays[number]);
      else {
        const failure = new Error(`${label}连接暂时中断，请检查网络后重试。`);
        failure.code = 'COMPONENT_LOAD_FAILED'; reject(failure);
      }
    };
    script.onload = () => finish(false);
    script.onerror = () => finish(true);
    timer = delay(() => finish(true), timeoutMs);
    doc.head.append(script);
  });
  const work = attempt(0).finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
