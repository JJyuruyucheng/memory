# Temporary login-photo HTTP verification

This is an inert, one-run trusted-operator tool, not a browser API. Deploy only
after the login-photos migration, native Auth configuration and runtime guard
have independently been checked. Never commit a real activation lease or digest.

Deploy `index.ts` plus `core.mjs` under a temporary function name, with
`verify_jwt=false`. In the deployment payload only, activate `enabled` and
`prerequisitesVerified`, set the fixed publishable project key, set issuedAt and
expiresAt (Unix milliseconds, at most ten minutes apart), and insert SHA-256 of
a freshly generated **256-bit** capability encoded as 64 hexadecimal characters.
The hash is over that hexadecimal string, not its decoded bytes. The raw
capability remains only in the trusted operator process.

Call POST without Origin, query string or cookies:

```http
Authorization: Bearer <64 hexadecimal capability characters>
Content-Type: application/json

{"run":true}
```

The entry point refuses replay within the same runtime. It uses a 105-second
work deadline and reserves another 45 seconds for cleanup; the activation lease
must have at least 155 seconds left when invoked. Project origin is fixed in
code and must match SUPABASE_URL. Upstream requests have bounded reads and
timeouts; server credentials only reach exact Auth/bucket preflight or exact
private-fixture cleanup endpoints. All business/Storage assertions use the
publishable key with either no user JWT or one freshly generated member JWT.

The first HTTP request checks that the public manifest is empty and valid. A
nonempty gallery aborts without clearing it. The tool validates three existing
Auth identities before generating magic links, then confirms native users and
protected profiles. It does not change passwords, CAPTCHA, registration or
settings. `authMethod=admin-generated-magiclink` and
`passwordCaptchaTested=false` are explicit; this does not test normal login.

It creates `login-photos` through the official Storage API only when absent.
An existing bucket must already be private, exactly 5,000,000 bytes, with exactly
JPEG/PNG/WebP. It never updates an existing bucket. Existing `memory-media` is
only checked to remain private.

The actual tests use three tiny valid login PNGs and one separate private draft
PNG: uploaded-but-pending and ready-unselected bytes hidden anonymously;
partner staging hidden; selected bytes anonymously readable; both members and
admin can CAS edit, reorder and replace; retired bytes rejected with a new
cacheNonce; old IDs cannot be republished; anonymous write RPCs, selected delete,
upsert, stale revision, ninth selection and invalid size/type reservations are
rejected. The private draft PNG verifies both authenticated owner access and
anonymous rejection. This is not a test of prompt cache revocation, heavy
concurrency, or uploading a literal oversized body.

Cleanup only CAS-clears a gallery containing this run's generated photo IDs.
If any foreign ID appears, it preserves that selection and reports incomplete
cleanup. Exact known login files are removed using each original owner JWT,
then `discard_login_photo`; normal selected-file protections remain in force
even if another request changes the gallery during cleanup. The private draft
uses a client-generated UUID and exact author/run marker; only those verified
rows and exact registered object paths can receive privileged cleanup. No SQL
Storage metadata writes are used. Only newly generated local sessions are signed
out. Unknown reserve or verification responses report possible leftovers rather
than falsely claiming complete cleanup.

Inspect `ok`, all 21 `metrics.checks`, `cleanup.complete`, all cleanup flags and
unknown-result markers. Independently query exact fixture IDs / test-window
rows and sessions after a successful run. On any unexpected remaining fixture,
stop and inspect before a narrowly scoped cleanup; do not remove unrelated
staging or real records.

After **success or failure**, deploy `retired.ts` as the whole no-import entry
point and verify that the old capability returns 410. Discard the raw
capability and activation payload. Never place a server secret or real user JWT
in source, public assets, logs, screenshots, or a reply.
