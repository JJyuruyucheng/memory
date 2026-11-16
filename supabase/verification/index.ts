import { createVerificationHandler, PROJECT_ORIGIN } from './core.mjs';

// INERT REVIEW TEMPLATE. Never commit a real capability/digest or activation lease.
// Deploy only as a temporary endpoint after native Auth configuration and the
// database guard have independently been verified by the project owner.
const policy = Object.freeze({
  enabled: false,
  prerequisitesVerified: false,
  projectOrigin: PROJECT_ORIGIN,
  publishableKey: 'sb_publishable_VAOWjndh2VESAbaPiB8kbQ_o9t_N_Sr',
  capabilitySha256: '0000000000000000000000000000000000000000000000000000000000000000',
  issuedAt: 0,
  expiresAt: 0,
});

// verify_jwt=false: this endpoint checks a separate 256-bit short-lived capability.
export default { fetch: createVerificationHandler(policy) };
