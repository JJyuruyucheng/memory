// The official, locally vendored UMD bundle is pinned and verified by the build.
// Passwords, refresh tokens and privileged keys never enter application config.
import { createRememberedSessionStorage } from './session-storage.js';
import { createServiceFetch } from './service-fetch.js';
let loading;

export async function createBrowserSupabaseClient(config) {
  if (!config.supabaseUrl || !config.supabasePublishableKey?.startsWith('sb_publishable_')) throw new Error('免费记录服务尚未配置。');
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../assets/supabase-client-2.119.0.js', import.meta.url).href;
    const timer = setTimeout(() => { script.remove(); loading = null; reject(new Error('记录服务组件连接超时，请刷新重试。')); }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      if (typeof globalThis.supabase?.createClient === 'function') resolve(globalThis.supabase);
      else { script.remove(); loading = null; reject(new Error('记录服务组件未正确加载。')); }
    };
    script.onerror = () => { clearTimeout(timer); script.remove(); loading = null; reject(new Error('记录服务组件加载失败，请刷新重试。')); };
    document.head.append(script);
  });
  const sdk = await loading;
  const storageKey = `chaoxi-${new URL(config.supabaseUrl).hostname.split('.')[0]}-auth`;
  let browserStorage;
  try { browserStorage = globalThis.localStorage; } catch { /* Session remains available in this tab. */ }
  let client, ending = false;
  const reopen = () => {
    if (ending) return; ending = true;
    client?.auth.stopAutoRefresh();
    // Do not sign out here: another tab may already have written a new session.
    globalThis.dispatchEvent(new Event('memory:session-ended'));
    globalThis.location.reload();
  };
  const storage = createRememberedSessionStorage({ storage: browserStorage, key: storageKey, onExpired: reopen, onExternalChange: reopen });
  client = sdk.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { storage, storageKey, persistSession: true, detectSessionInUrl: false, autoRefreshToken: true },
    global: { fetch: createServiceFetch(config.supabaseUrl), headers: { 'X-Client-Info': 'chaoxi-memory/0.4' } },
  });
  Object.defineProperty(client, 'memorySession', { value: { beginSignIn: () => storage.beginSignIn() } });
  storage.watch();
  return client;
}
