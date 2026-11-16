import { stdin, stdout, stderr } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { IDENTITIES, BUCKET_ID, projectOrigin, validatePasswords, readJsonLimited } from './core.mjs';

// Fixed, public project identity. Neither a password nor an API key.
export const EXPECTED_PROJECT_ORIGIN = 'https://ijtrfjehqtoptsmsotin.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function invokeBootstrap({ endpoint, capability, passwords, fetch: fetcher = globalThis.fetch }) {
  const url = new URL(endpoint);
  if (url.origin !== EXPECTED_PROJECT_ORIGIN || projectOrigin(url.origin) !== EXPECTED_PROJECT_ORIGIN
    || url.username || url.password || url.search || url.hash || !/^\/functions\/v1\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(url.pathname)) throw new Error('INVALID_BOOTSTRAP_ENDPOINT');
  if (typeof capability !== 'string' || !/^[0-9a-f]{64}$/.test(capability)) throw new Error('INVALID_CAPABILITY');
  validatePasswords({ passwords });
  let response;
  try {
    response = await fetcher(url.href, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ passwords }), signal: AbortSignal.timeout(90000),
    });
  } catch { throw new Error('BOOTSTRAP_REQUEST_FAILED'); }
  if (!response.ok) throw new Error(`BOOTSTRAP_HTTP_${response.status}`);
  let result;
  try { result = await readJsonLimited(response, 8192); } catch { throw new Error('INVALID_BOOTSTRAP_RESULT'); }
  if (result?.bucket !== BUCKET_ID || !Array.isArray(result.users) || result.users.length !== 3) throw new Error('INVALID_BOOTSTRAP_RESULT');
  const safeUsers = IDENTITIES.map(identity => {
    const matches = result.users.filter(user => user?.username === identity.username);
    if (matches.length !== 1 || !UUID.test(matches[0].id ?? '') || typeof matches[0].created !== 'boolean') throw new Error('INVALID_BOOTSTRAP_RESULT');
    return { username: identity.username, id: matches[0].id, created: matches[0].created };
  });
  if (new Set(safeUsers.map(user => user.id)).size !== 3) throw new Error('INVALID_BOOTSTRAP_RESULT');
  // Project only UUIDs/status into output: never print an untrusted response's other fields.
  return { users: safeUsers, bucket: BUCKET_ID };
}

function hiddenInput(prompt) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') return Promise.reject(new Error('INTERACTIVE_TERMINAL_REQUIRED'));
  return new Promise((resolve, reject) => {
    const previousRaw = stdin.isRaw;
    let value = '';
    stdout.write(prompt);
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    function done(error) {
      stdin.off('keypress', keypress);
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error); else resolve(value);
    }
    function keypress(character, key = {}) {
      if (key.ctrl && ['c', 'd'].includes(key.name)) { done(new Error('INPUT_CANCELLED')); return; }
      if (['return', 'enter'].includes(key.name)) { done(); return; }
      if (key.name === 'backspace') { value = value.slice(0, -1); return; }
      if (typeof character === 'string' && !/[\u0000-\u001f\u007f]/.test(character) && value.length + character.length <= 256) value += character;
    }
    stdin.on('keypress', keypress);
  });
}
async function stdinSecrets() {
  let size = 0;
  const chunks = [];
  for await (const chunk of stdin) {
    size += chunk.length;
    if (size > 16384) throw new Error('INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('INVALID_INPUT'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'capability') || !Object.hasOwn(value, 'passwords')) throw new Error('INVALID_INPUT');
  return value;
}
async function main() {
  const args = process.argv.slice(2);
  if (![2, 3].includes(args.length) || args[0] !== '--endpoint' || (args.length === 3 && args[2] !== '--stdin')) throw new Error('USAGE');
  const endpoint = args[1];
  const secrets = args[2] === '--stdin' ? await stdinSecrets() : {
    capability: await hiddenInput('短期能力凭证（输入不回显）：'),
    passwords: {
      xbl: await hiddenInput('xbl 初始口令（至少6位，不回显）：'),
      ll: await hiddenInput('ll 初始口令（至少6位，不回显）：'),
      'memory-admin': await hiddenInput('独立管理员口令（至少12位，不回显）：'),
    },
  };
  const result = await invokeBootstrap({ endpoint, ...secrets });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const code = typeof error?.message === 'string' && /^(?:BOOTSTRAP_HTTP_\d{3}|BOOTSTRAP_REQUEST_FAILED|INVALID_BOOTSTRAP_ENDPOINT|INVALID_BOOTSTRAP_RESULT|INVALID_CAPABILITY|INVALID_PASSWORD_INPUT|INTERACTIVE_TERMINAL_REQUIRED|INPUT_CANCELLED|INPUT_TOO_LARGE|INVALID_INPUT|USAGE)$/.test(error.message) ? error.message : 'BOOTSTRAP_CLIENT_FAILED';
    stderr.write(`初始化未确认完成（${code}）。可能有部分账号已创建，请先核对状态；不要把重试当作口令重置。\n`);
    process.exitCode = 1;
  });
}
