// Official Turnstile integration: the widget supplies a token; only the server
// decides whether login is allowed. No credential or CAPTCHA answer lives here.
let scriptPromise;

function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.defer = true;
    const timer = setTimeout(() => { script.remove(); scriptPromise = null; reject(new Error('验证服务连接超时，请重试。')); }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      if (!globalThis.turnstile) { script.remove(); scriptPromise = null; reject(new Error('安全验证加载失败，请重试。')); }
      else resolve(globalThis.turnstile);
    };
    script.onerror = () => { clearTimeout(timer); script.remove(); scriptPromise = null; reject(new Error('暂时无法连接安全验证服务，请检查网络后重试。')); };
    document.head.append(script);
  });
  return scriptPromise;
}

export function mountLoginVerification(root, { isBusy = () => false, getConfig } = {}) {
  const form = root.querySelector('#login-form');
  const submit = form.querySelector('[type="submit"]');
  const status = root.querySelector('#verification-status');
  const retry = root.querySelector('#verification-retry');
  let token = '', widget, api, destroyed = false, loading = false;
  const controller = new AbortController();
  function message(text, allowRetry = false) {
    if (destroyed) return;
    status.textContent = text; retry.hidden = !allowRetry;
  }
  function invalidate(text, allowRetry = false) {
    token = ''; submit.disabled = true; message(text, allowRetry);
  }
  async function start() {
    if (loading || destroyed) return;
    loading = true; invalidate('正在准备安全验证…');
    try {
      let config;
      if (getConfig) config = await getConfig();
      else {
        const response = await fetch('/auth/config', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('登录服务暂时不可用，请稍后重试。');
        config = await response.json();
      }
      if (!config.configured || typeof config.siteKey !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(config.siteKey) || config.action !== 'login') throw new Error('安全登录尚未配置完成，请联系管理员。');
      api = await loadTurnstile();
      if (destroyed) return;
      if (widget !== undefined) api.remove(widget);
      widget = api.render(root.querySelector('#login-captcha'), {
        sitekey: config.siteKey, action: 'login', theme: 'light', size: 'flexible', language: 'zh-cn',
        callback(value) { if (destroyed) return; token = value; submit.disabled = isBusy(); message(isBusy() ? '正在登录，请稍候…' : '安全验证已完成。'); },
        'expired-callback'() { invalidate('验证已过期，请重新完成验证。', true); },
        'error-callback'() { invalidate('验证暂时不可用，请重新加载。', true); },
        'timeout-callback'() { invalidate('验证超时，请重新加载。', true); },
      });
      if (!token) message('请完成下方安全验证。');
    } catch (error) {
      if (!destroyed) invalidate(error.name === 'AbortError' || error.name === 'TimeoutError' ? '连接超时，请重新加载验证。' : error.message, true);
    } finally { loading = false; }
  }
  retry.addEventListener('click', start, { signal: controller.signal });
  start();
  return {
    getToken: () => destroyed ? '' : token,
    reset() {
      if (destroyed) return;
      invalidate('请重新完成安全验证。');
      if (api && widget !== undefined) api.reset(widget);
    },
    destroy() {
      destroyed = true; token = ''; controller.abort();
      if (api && widget !== undefined) { api.remove(widget); widget = undefined; }
    },
  };
}
