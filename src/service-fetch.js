// Keep cloud requests bounded and policy-protected downloads freshly authorized. A nonce
// does not revoke any URL, response or copy obtained while a file was shared.
export function createServiceFetch(origin, { fetchImpl = globalThis.fetch, nonce = () => crypto.randomUUID(), apiTimeout = 30_000, fileTimeout = 45_000 } = {}) {
  const expected = new URL(origin).origin;
  return (input, init = {}) => {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const url = new URL(request ? request.url : input);
    if (url.origin !== expected) return Promise.reject(Error('记录服务地址无效。'));
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const protectedFile = method === 'GET' && /^\/storage\/v1\/object\/(?:authenticated\/)?(?:memory-media|login-photos)\//.test(url.pathname);
    if (protectedFile) url.searchParams.set('cacheNonce', nonce());
    const controller = new AbortController(), external = init.signal || request?.signal;
    const onAbort = () => { clearTimeout(timer); controller.abort(external.reason); };
    const timer = setTimeout(() => { external?.removeEventListener('abort', onAbort); controller.abort(new DOMException('连接超时', 'TimeoutError')); }, protectedFile ? fileTimeout : apiTimeout);
    timer.unref?.();
    if (external?.aborted) onAbort(); else external?.addEventListener('abort', onAbort, { once: true });
    // Keep the deadline active through response body consumption, not just headers.
    const resource = request ? new Request(url, request) : url.href;
    return fetchImpl(resource, { ...init, signal: controller.signal, cache: 'no-store' });
  };
}
