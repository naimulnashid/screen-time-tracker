/**
 * Password gate for LAN access.
 *
 * `next start` binds every interface, so this dashboard is reachable from any
 * device on the Wi-Fi -- and it serves a minute-by-minute record of what this
 * person looked at and when. That is worth a lock, and arguably a stronger one
 * than the sibling project's, which only knows how many bytes moved.
 *
 * Deliberately Web Crypto only, no `node:crypto` import: this module is pulled
 * into `middleware.ts`, which Next runs on the Edge runtime where the Node
 * built-ins do not exist. Adding a `node:` import here breaks the build.
 *
 * The session cookie is `<expiry-ms>.<HMAC-SHA256(expiry-ms)>`, keyed by a
 * PBKDF2 derivation of the password (see `sessionKey`). Keying off the
 * password is the point: changing it in `.env.local` invalidates every
 * outstanding session for free, with no session store to keep.
 */

/**
 * ⚠️ MUST NOT match the sibling Data Usage Tracker's cookie name.
 *
 * Cookies are scoped by HOST, not by origin -- the port is not part of the
 * key. So `localhost:7843` (Data Usage) and `localhost:7844` (this) share one
 * cookie jar, and two dashboards using `datausage_session` would overwrite
 * each other's session on every login. With different passwords the symptom is
 * especially nasty: signing into one silently signs you out of the other, and
 * it looks like the session expiring at random.
 *
 * The sibling project's own note that "the cookie is per-ORIGIN" is about two
 * different HOSTS (localhost vs a LAN address) and does not extend to ports.
 */
export const SESSION_COOKIE = 'screentime_session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days - a phone should not re-auth daily.

/** The configured password, or undefined when none has been set. */
export function configuredPassword(): string | undefined {
  const pw = process.env['DASHBOARD_PASSWORD'];
  return pw && pw.trim().length > 0 ? pw : undefined;
}

/**
 * Length-independent equality.
 *
 * Compares SHA-256 digests rather than the strings, so neither the contents
 * nor the length leak through timing.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The signing key is DERIVED from the password, not the password itself.
 *
 * Keyed by the raw password, a cookie is an offline oracle: anyone who copies
 * one can test password guesses against its signature at millions a second,
 * with no rate limit in the way. PBKDF2 makes each guess cost as much as this
 * derivation does. It runs once per process and password -- the promise is
 * cached -- so a request pays nothing for it.
 *
 * Bumping the salt's version string signs everyone out, the same as rotating
 * the password does.
 */
const KDF_SALT = 'screen-time session key v1';
const KDF_ITERATIONS = 200_000;
let keyCache: { secret: string; key: Promise<CryptoKey> } | null = null;

function sessionKey(secret: string): Promise<CryptoKey> {
  if (keyCache?.secret === secret) return keyCache.key;
  const enc = new TextEncoder();
  const key = crypto.subtle
    .importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'])
    .then((base) =>
      crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(KDF_SALT), iterations: KDF_ITERATIONS, hash: 'SHA-256' },
        base,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign'],
      ),
    );
  // A failed derivation must not be cached, or every later request fails too.
  key.catch(() => { if (keyCache?.key === key) keyCache = null; });
  keyCache = { secret, key };
  return key;
}

async function sign(secret: string, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(secret), new TextEncoder().encode(payload));
  return base64url(new Uint8Array(sig));
}

export async function issueSession(
  secret: string,
): Promise<{ value: string; maxAgeSeconds: number }> {
  const expiry = String(Date.now() + SESSION_TTL_MS);
  return {
    value: `${expiry}.${await sign(secret, expiry)}`,
    maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/**
 * How much of the session's life must elapse before it is worth reissuing.
 *
 * Without renewal a session dies 30 days after login even if you used it every
 * day, which reads as "it forgot me for no reason". Renewing on every request
 * would instead set a cookie on every page load, so this only refreshes once
 * the session is a day old.
 */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

/** True when a valid session is old enough to be worth extending. */
export function shouldRenew(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const dot = cookie.lastIndexOf('.');
  if (dot <= 0) return false;
  const expiry = Number(cookie.slice(0, dot));
  if (!Number.isFinite(expiry)) return false;
  const issuedAt = expiry - SESSION_TTL_MS;
  return Date.now() - issuedAt > RENEW_AFTER_MS;
}

export async function verifySession(
  secret: string,
  cookie: string | undefined,
): Promise<boolean> {
  if (!cookie) return false;

  const dot = cookie.lastIndexOf('.');
  if (dot <= 0) return false;

  const payload = cookie.slice(0, dot);
  if (!(await safeEqual(cookie.slice(dot + 1), await sign(secret, payload)))) return false;

  const expiry = Number(payload);
  return Number.isFinite(expiry) && Date.now() < expiry;
}
