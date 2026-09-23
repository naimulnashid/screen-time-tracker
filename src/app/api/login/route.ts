import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  configuredPassword,
  issueSession,
  safeEqual,
} from '@/lib/auth';
import { LoginThrottle, clientKey } from '@/lib/login-throttle';

export const runtime = 'nodejs';

/**
 * One per process, which is the whole server. See login-throttle.ts for why a
 * per-request sleep was not enough and why there are two layers.
 */
const throttle = new LoginThrottle();

export async function POST(request: Request) {
  const expected = configuredPassword();
  if (!expected) {
    return NextResponse.json({ error: 'auth-not-configured' }, { status: 503 });
  }

  let submitted: unknown;
  try {
    submitted = ((await request.json()) as { password?: unknown })?.password;
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  if (typeof submitted !== 'string') {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  // Charged BEFORE the comparison, so a burst of parallel guesses is counted
  // as it arrives rather than after every one of them has been checked.
  const verdict = throttle.attempt(clientKey(request.headers));
  if (!verdict.allowed) {
    const seconds = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000));
    return NextResponse.json(
      { error: 'too-many-attempts', retryAfterSeconds: seconds },
      { status: 429, headers: { 'Retry-After': String(seconds) } },
    );
  }

  if (!(await safeEqual(submitted, expected))) {
    return NextResponse.json({ error: 'wrong-password' }, { status: 401 });
  }
  throttle.succeeded(verdict.ticket);

  const { value, maxAgeSeconds } = await issueSession(expected);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
    // NOT `secure`. This is served over plain HTTP on the LAN; a secure cookie
    // would simply never be stored, and the symptom is a login form that
    // appears to do nothing -- it accepts the password, returns 200, and
    // bounces straight back to /login.
    secure: false,
  });
  return response;
}

/**
 * Sign out. Clears THIS browser's cookie; the session itself is stateless, so
 * a copied cookie stays valid until it expires. Rotating DASHBOARD_PASSWORD is
 * what revokes every session at once.
 */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
