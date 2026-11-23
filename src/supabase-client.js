// The official, locally vendored UMD bundle is pinned and verified by the build.
// Passwords, refresh tokens and privileged keys never enter application config.
import { createRememberedSessionStorage } from './session-storage.js';
import { createServiceFetch } from './service-fetch.js';
import { createBrowserAuthLifecycle } from './auth-lifecycle.js';
import { loadLocalScript } from './local-script.js';

export async function changePasswordWithVerification(sdk, config, input, assertCurrent) {
  const verification = sdk.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { storageKey: `chaoxi-password-${crypto.randomUUID()}`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createServiceFetch(config.supabaseUrl) },
  });
  const { email, currentPassword, newPassword, captchaToken, userId } = input;
  let signedIn = false;
  try {
    const result = await verification.auth.signInWithPassword({ email, password: currentPassword, options: { captchaToken } });
    signedIn = Boolean(result.data?.session);
    if (result.error?.status === 429) throw new Error('验证过于频繁，请稍后重试。');
    if (result.error?.name === 'AuthRetryableFetchError') throw new Error('无法连接认证服务，请重试。');
    if (!signedIn || result.error || result.data?.user?.id !== userId) throw new Error('当前密码或安全验证未通过，请重试。');
    assertCurrent();
    const updated = await verification.auth.updateUser({ password: newPassword, current_password: currentPassword });
    if (updated.error?.code === 'weak_password') throw new Error('新密码未达到安全要求，请换一个。');
    if (updated.error || updated.data?.user?.id !== userId) throw new Error('密码更新结果未能确认，请用新密码登录核对。');
  } finally {
    if (signedIn) await verification.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}

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
  const storage = createRememberedSessionStorage({ storage: browserStorage, key: storageKey, onExternalChange: reopen });
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
  Object.defineProperty(client, 'memoryChangePassword', { value: (input, assertCurrent) =>
    changePasswordWithVerification(sdk, config, input, assertCurrent) });
  stopWatching = storage.watch();
  return client;
}
