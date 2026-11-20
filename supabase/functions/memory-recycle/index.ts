import { createRecycleHandler } from './core.mjs';

function configuredKey(dictionary: string, legacy: string): string | undefined {
  const keys = Deno.env.get(dictionary);
  if (keys) {
    try {
      const key = JSON.parse(keys).default;
      if (typeof key === 'string' && key) return key;
    } catch { /* Older projects can still use their built-in legacy key. */ }
  }
  return Deno.env.get(legacy);
}

// Deploy with verify_jwt=false. Manual requests authenticate with Auth and
// cron requests use the private database token, before any storage operation.
export default { fetch: createRecycleHandler({
  apiOrigin: Deno.env.get('SUPABASE_URL'),
  publicKey: configuredKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'),
  serviceKey: configuredKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'),
}) };
