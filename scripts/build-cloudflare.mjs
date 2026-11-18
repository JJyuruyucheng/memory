import { readFile } from 'node:fs/promises';
import { build } from './build.mjs';

// These are public browser values. Privileged credentials never belong in this file.
const config = JSON.parse(await readFile(new URL('../deploy/cloudflare.public.json', import.meta.url), 'utf8'));
const fields = ['supabaseUrl', 'supabasePublishableKey', 'turnstileSiteKey', 'authReady', 'resourceCapacity'];
if (Object.keys(config).length !== fields.length || fields.some(key => !Object.hasOwn(config, key))
  || typeof config.authReady !== 'boolean' || fields.slice(0, 3).some(key => typeof config[key] !== 'string')) {
  throw new Error('Cloudflare 公共配置字段不匹配。');
}
await build({
  env: {
    MEMORY_MODE: 'supabase', MEMORY_TARGET: 'cloudflare',
    MEMORY_SUPABASE_URL: config.supabaseUrl,
    MEMORY_SUPABASE_PUBLISHABLE_KEY: config.supabasePublishableKey,
    MEMORY_TURNSTILE_SITE_KEY: config.turnstileSiteKey,
    MEMORY_AUTH_READY: String(config.authReady),
  },
  supabaseCapacity: config.resourceCapacity,
});
