import { createLoginPhotosVerificationHandler, PROJECT_ORIGIN } from './core.mjs';

// INERT REVIEW TEMPLATE: never commit an activation capability/hash or lease.
const policy = Object.freeze({
  enabled: false,
  prerequisitesVerified: false,
  projectOrigin: PROJECT_ORIGIN,
  publishableKey: 'sb_publishable_VAOWjndh2VESAbaPiB8kbQ_o9t_N_Sr',
  capabilitySha256: '0000000000000000000000000000000000000000000000000000000000000000',
  issuedAt: 0,
  expiresAt: 0,
});
// verify_jwt=false; the endpoint independently verifies a 256-bit capability.
export default { fetch: createLoginPhotosVerificationHandler(policy) };
