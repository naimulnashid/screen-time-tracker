/**
 * The cloud inbox function, run for real against a stand-in database.
 *
 *   npm run test:inbox-function
 *
 * Audit TEST-001. `supabase/functions/inbox/index.ts` is the deployed code,
 * shared byte for byte with the sibling project, so it is imported as it is
 * rather than refactored for testing: `Deno.serve` is caught to get the
 * handler, `Deno.env` supplies a fake project URL, and `fetch` answers the
 * PostgREST calls from memory. Nothing leaves this process.
 *
 * What it pins: each token opens only its own app and its own role, an
 * envelope is stored only with the right magic and size, a drain sees only
 * its own app's envelopes, an ack cannot touch another app's rows, and the
 * failed / done / retry states move as the laptop's drain expects.
 */

import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { inbox_keys: [], inbox_envelopes: [] };
let nextId = 1;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const TOKENS = {
  'screen-time': { upload: 'st-upload-token-0123456789', drain: 'st-drain-token-0123456789' },
  'data-usage': { upload: 'du-upload-token-0123456789', drain: 'du-drain-token-0123456789' },
} as const;
for (const [app, roles] of Object.entries(TOKENS)) {
  for (const [role, token] of Object.entries(roles)) tables.inbox_keys!.push({ app, role, token_sha256: sha(token) });
}

/** The PostgREST filters the function uses, and no others. */
function matches(row: Row, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const arg = rest.join('.');
    const val = row[k];
    if (op === 'eq' && String(val) !== arg) return false;
    if (op === 'is' && arg === 'null' && val != null) return false;
    if (op === 'gt' && !(Number(val) > Number(arg))) return false;
    if (op === 'in' && !arg.slice(1, -1).split(',').includes(String(val))) return false;
  }
  return true;
}

const seenKeys = new Set<string>();
globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input));
  const table = url.pathname.split('/').pop()!;
  const rows = tables[table];
  if (!url.href.startsWith('https://project.test/rest/v1/') || !rows) return new Response('no', { status: 404 });
  seenKeys.add(String((init.headers as Record<string, string>)?.apikey));
  const method = init.method ?? 'GET';
  const hit = rows.filter((r) => matches(r, url.searchParams));
  if (method === 'GET') {
    const limit = Number(url.searchParams.get('limit')) || hit.length;
    return Response.json(hit.sort((a, b) => Number(a.id) - Number(b.id)).slice(0, limit));
  }
  if (method === 'HEAD') return new Response(null, { headers: { 'content-range': `0-${hit.length}/${hit.length}` } });
  if (method === 'POST') {
    const row = { ...JSON.parse(String(init.body)), id: nextId++, received_at: new Date().toISOString(), failed_at: null, error: null };
    rows.push(row);
    return Response.json([row], { status: 201 });
  }
  if (method === 'DELETE') {
    tables[table] = rows.filter((r) => !hit.includes(r));
    return new Response(null, { status: 204 });
  }
  if (method === 'PATCH') {
    for (const r of hit) Object.assign(r, JSON.parse(String(init.body)));
    return new Response(null, { status: 204 });
  }
  return new Response('no', { status: 405 });
}) as typeof fetch;

let handler!: (req: Request) => Promise<Response>;
(globalThis as Record<string, unknown>).Deno = {
  env: { get: (k: string) => ({ SUPABASE_URL: 'https://project.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' })[k] },
  serve: (h: typeof handler) => { handler = h; },
};

let passed = 0;
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
}

const BASE = 'https://project.test/functions/v1/inbox';
async function call(path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await handler(new Request(BASE + path, { ...init, headers }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const envelope = (magic: string, size = 4 + 65 + 12 + 16 + 10) => {
  const b = new Uint8Array(size);
  b.set([...magic].map((c) => c.charCodeAt(0)));
  return b;
};
const ids = (b: Record<string, unknown>) => (b.envelopes as Row[]).map((e) => e.id);

async function main() {
  // Through a variable, so the dashboard's tsc does not type-check Deno code;
  // the inbox-function CI job runs deno check on it instead.
  const fn = '../supabase/functions/inbox/index.ts';
  await import(fn);
  const st = TOKENS['screen-time'];
  const du = TOKENS['data-usage'];

  console.log('\n=== routing and tokens ===');
  check('an unknown path is 404', (await call('/screen-time/nope', st.upload)).status, 404);
  check('no token is 401', (await call('/screen-time', null)).status, 401);
  check('the upload token answers its own app', (await call('/screen-time', st.upload)).body, { ok: true, inbox: true });
  check("another app's upload token is refused", (await call('/screen-time', du.upload)).status, 401);
  check('a drain token cannot upload', (await call('/screen-time', st.drain)).status, 401);
  check('an upload token cannot drain', (await call('/screen-time/pending', st.upload)).status, 401);
  check("another app's drain token is refused", (await call('/screen-time/pending', du.drain)).status, 401);
  check('no app segment means data-usage', (await call('', du.upload)).status, 200);

  console.log('\n=== storing ===');
  const post = (body: Uint8Array, token: string = st.upload, headers: Record<string, string> = {}) =>
    call('/screen-time', token, { method: 'POST', body: body as BodyInit, headers });
  check('plain JSON is not an envelope', (await post(new TextEncoder().encode('{"device":{}}'))).status, 400);
  check("the other app's magic is refused", (await post(envelope('DUI1'))).status, 400);
  check('a too-short envelope is refused', (await post(envelope('STI1', 20))).status, 400);
  check('a declared oversize body is refused', (await post(envelope('STI1'), st.upload, { 'content-length': String(9 * 1024 * 1024) })).status, 413);
  const a = await post(envelope('STI1'), st.upload, { 'x-device-hint': 'phone-a' });
  const b = await post(envelope('STI1'));
  const c = await post(envelope('STI1'));
  check('a good envelope is stored', [a.status, a.body.ok, typeof a.body.id], [200, true, 'number']);
  await call('', du.upload, { method: 'POST', body: envelope('DUI1') as BodyInit });
  check('the stored row keeps its app and hint', tables.inbox_envelopes!.filter((r) => r.app === 'screen-time').map((r) => r.device_hint), ['phone-a', null, null]);

  console.log('\n=== draining ===');
  let page = await call('/screen-time/pending', st.drain);
  check('the drain sees only its own app', [ids(page.body), page.body.remaining], [[a.body.id, b.body.id, c.body.id], 3]);
  page = await call(`/screen-time/pending?after=${a.body.id}&limit=1`, st.drain);
  check('after and limit page through', ids(page.body), [b.body.id]);
  check('pending is GET only', (await call('/screen-time/pending', st.drain, { method: 'POST' })).status, 405);

  const ack = (token: string, body: unknown, app = 'screen-time') =>
    call(`/${app}/ack`, token, { method: 'POST', body: JSON.stringify(body) });
  await ack(du.drain, { done: [a.body.id] }, 'data-usage');
  check("an ack for another app's id deletes nothing", ids((await call('/screen-time/pending', st.drain)).body).length, 3);
  check('an oversized ack changes nothing', [(await ack(st.drain, { done: Array.from({ length: 101 }, (_, i) => i + 1) })).status,
    ids((await call('/screen-time/pending', st.drain)).body).length], [413, 3]);
  check('ack takes only ids', (await ack(st.drain, { done: [a.body.id, 'x', -1, 1.5], failed: [{ id: b.body.id, error: 'bad payload' }] })).body,
    { ok: true, deleted: 1, failed: 1 });
  page = await call('/screen-time/pending', st.drain);
  check('done is gone and failed is set aside', ids(page.body), [c.body.id]);
  page = await call('/screen-time/pending?failed=1', st.drain);
  check('a retry of failed ones sees it, with its error', [ids(page.body), (page.body.envelopes as Row[])[0]?.error], [[b.body.id, c.body.id], 'bad payload']);
  check('a junk ack body is an empty ack', (await call('/screen-time/ack', st.drain, { method: 'POST', body: 'not json' })).body, { ok: true, deleted: 0, failed: 0 });
  check("the other app's envelope is untouched", tables.inbox_envelopes!.filter((r) => r.app === 'data-usage').length, 1);
  check('every database call carried the service key', [...seenKeys], ['service-key']);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

void main();
