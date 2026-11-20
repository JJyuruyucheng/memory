const SITE_ORIGIN = 'https://memory-awv.pages.dev';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const CRON_HEADER = 'x-memory-recycle-token';
const REJECTED = [401, 403];

async function input(request) {
  if (!request.body) return null;
  const decoder = new TextDecoder();
  let length = 0, body = '';
  for await (const bytes of request.body) {
    length += bytes.length;
    if (length > 1024) return null;
    body += decoder.decode(bytes, { stream: true });
  }
  try {
    const value = JSON.parse(body + decoder.decode());
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function validClaim(claim) {
  return claim && UUID.test(claim.entry_id) && UUID.test(claim.lease_id) && Array.isArray(claim.media_paths)
    && claim.media_paths.every(path => {
      if (typeof path !== 'string') return false;
      const parts = path.split('/');
      return parts.length === 3 && parts[1] === claim.entry_id && parts.every(part => UUID.test(part));
    });
}

export function createRecycleHandler({ apiOrigin, publicKey, serviceKey, fetchImpl = fetch }) {
  const origin = /^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(apiOrigin || '') ? new URL(apiOrigin).origin : null;
  return async request => {
    const source = request.headers.get('origin'), headers = {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      vary: 'Origin',
      ...(source === SITE_ORIGIN ? { 'access-control-allow-origin': SITE_ORIGIN } : {}),
    };
    const reply = (status, body) => Response.json(body, { status, headers });
    const error = (status, code) => reply(status, { code });
    if (source !== null && source !== SITE_ORIGIN) return error(403, 'RECYCLE_FORBIDDEN');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...headers,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-region',
        'access-control-max-age': '600',
      } });
    }
    if (request.method !== 'POST') return error(405, 'RECYCLE_METHOD');
    if (new URL(request.url).search) return error(400, 'RECYCLE_REQUEST');
    if (!origin || !publicKey || !serviceKey) return error(503, 'RECYCLE_OFFLINE');

    const cronToken = request.headers.get(CRON_HEADER), authorization = request.headers.get('authorization');
    const scheduled = cronToken !== null;
    if (scheduled ? source || !/^[a-f0-9]{64}$/.test(cronToken) : !/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(authorization || '')) {
      return error(401, 'RECYCLE_UNAUTHORIZED');
    }
    const deadline = AbortSignal.timeout(24_000);
    const caller = { apikey: publicKey, authorization };
    const service = {
      apikey: serviceKey,
      ...(serviceKey.startsWith('sb_secret_') ? {} : { authorization: `Bearer ${serviceKey}` }),
    };
    const upstream = (path, credentials, method, body) => fetchImpl(origin + path, {
      method, headers: { ...credentials, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: deadline,
    });
    const rpc = (name, credentials, body) => upstream('/rest/v1/rpc/' + name, credentials, 'POST', body);

    try {
      const value = await input(request);
      if (!value || (scheduled ? Object.keys(value).length !== 0 : Object.keys(value).length !== 1
        || (value.entryId !== null && (typeof value.entryId !== 'string' || !UUID.test(value.entryId))))) {
        return error(400, 'RECYCLE_REQUEST');
      }
      let command;
      if (scheduled) {
        command = await rpc('recycle_claim_expired', service, { p_token: cronToken });
      } else {
        const auth = await upstream('/auth/v1/user', caller, 'GET');
        if (REJECTED.includes(auth.status)) return error(401, 'RECYCLE_UNAUTHORIZED');
        if (!auth.ok) return error(503, 'RECYCLE_OFFLINE');
        const account = await auth.json();
        if (!UUID.test(account?.id) || account.is_anonymous) return error(401, 'RECYCLE_UNAUTHORIZED');
        command = await rpc('recycle_claim_manual', caller, { p_entry_id: value.entryId });
      }
      if (!command.ok) {
        if (REJECTED.includes(command.status)) return error(scheduled ? 401 : command.status, 'RECYCLE_UNAUTHORIZED');
        const rejection = await command.json();
        if (!scheduled && rejection?.message === 'RECYCLE_UNAVAILABLE') return error(404, 'RECYCLE_UNAVAILABLE');
        return error(503, 'RECYCLE_OFFLINE');
      }
      const result = await command.json();
      const claims = scheduled ? result : result?.claims;
      const queued = scheduled ? claims?.length : result?.queued;
      if (!Array.isArray(claims) || claims.length > 10 || !claims.every(validClaim)
        || (!scheduled && value.entryId && claims.some(claim => claim.entry_id !== value.entryId))
        || !Number.isSafeInteger(queued) || queued < claims.length) return error(503, 'RECYCLE_OFFLINE');

      const jobs = await Promise.allSettled(claims.map(async claim => {
        const paths = claim.media_paths;
        for (let start = 0; start < paths.length; start += 100) {
          const response = await upstream('/storage/v1/object/memory-media', service, 'DELETE', { prefixes: paths.slice(start, start + 100) });
          if (!response.ok) return false;
        }
        const finalized = await rpc('recycle_finalize', service, { p_entry_id: claim.entry_id, p_lease_id: claim.lease_id });
        return finalized.ok && await finalized.json() === true;
      }));
      const deleted = jobs.filter(job => job.status === 'fulfilled' && job.value).length;
      return reply(200, { queued, deleted, pending: queued - deleted });
    } catch { return error(503, 'RECYCLE_OFFLINE'); }
  };
}
