import { createBootstrapHandler } from './core.mjs';

// REVIEW TEMPLATE ONLY. Never commit a live capability, digest, or activation window.
// Root may substitute these values only in a short-lived deployment payload after
// native Auth CAPTCHA + disabled signup/anonymous sign-in have been verified.
const policy = Object.freeze({
  enabled: false,
  prerequisitesVerified: false,
  projectOrigin: 'https://PROJECT_REF.supabase.co',
  capabilitySha256: '0000000000000000000000000000000000000000000000000000000000000000',
  issuedAt: 0,
  expiresAt: 0,
});

// Deploy with verify_jwt=false: the handler itself checks its restricted capability.
// Current Supabase supports the portable fetch export as well as Deno.serve.
export default { fetch: createBootstrapHandler(policy) };
