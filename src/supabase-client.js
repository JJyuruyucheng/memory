// The official, locally vendored UMD bundle is pinned and verified by the build.
// Passwords, refresh tokens and privileged keys never enter application config.
import { createRememberedSessionStorage } from './session-storage.js';
import { createServiceFetch } from './service-fetch.js';
import { createBrowserAuthLifecycle } from './auth-lifecycle.js';
import { loadLocalScript } from './local-script.js';

export async function createBrowserSupabaseClient(config) {
  if (!config.supabaseUrl || !config.supabasePublishableKey?.startsWith('sb_publishable_')) throw new Error('免费记录服务尚未配置。');
  const sdk = await loadLocalScript({ url: new URL('../assets/supabase-client-2.119.0.js', import.meta.url), read: () => typeof globalThis.supabase?.createClient === 'function' ? globalThis.supabase : null, label: '记录服务组件' });
  const storageKey = `chaoxi-${new URL(config.supabaseUrl).hostname.split('.')[0]}-auth`;
  let browserStorage;
  try { browserStorage = globalThis.localStorage; } catch { /* Session remains available in this tab. */ }
  let client, lifecycle, stopWatching, ending = false;
  const reopen = () => {
    if (ending) return; ending = true;
    lifecycle?.pause();
    // Do not sign out here: another tab may already have written a new session.
    globalThis.dispatchEvent(new Event('memory:session-ended'));
    globalThis.location.reload();
  };
  const storage = createRememberedSessionStorage({ storage: browserStorage, key: storageKey, onExpired: reopen, onExternalChange: reopen });
  client = sdk.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { storage, storageKey, persistSession: true, detectSessionInUrl: false, autoRefreshToken: true },
    global: { fetch: createServiceFetch(config.supabaseUrl), headers: { 'X-Client-Info': 'chaoxi-memory/0.6' } },
  });
  lifecycle = createBrowserAuthLifecycle(client.auth);
  Object.defineProperty(client, 'memorySession', { value: {
    beginSignIn: () => storage.beginSignIn(),
    resume: () => lifecycle.resume(),
    pause: () => lifecycle.pause(),
    dispose: () => { stopWatching?.(); return lifecycle.dispose(); },
  } });
  stopWatching = storage.watch();
  return client;
}
