import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE, configuredPassword, verifySession, shouldRenew, issueSession,
} from '@/lib/auth';
import { safeNextPath } from '@/lib/safe-next';

/**
 * One gate in front of everything. Enforcing this here rather than per-page is
 * the whole point: a new route cannot forget to protect itself.
 *
 * This was `middleware.ts` until Next 16, which renamed the convention to
 * `proxy.ts` (and the export to `proxy`) and runs it on Node rather than Edge.
 * A file still named middleware.ts keeps working with a deprecation warning,
 * so the rename is housekeeping, not a behaviour change.
 *
 * The matcher lets Next's own static assets and the favicon through. Browsers
 * fetch `icon.svg` before any session exists, and gating it only makes the
 * login page render with a broken image -- it is a logo, it leaks nothing.
 *
 * The web app manifest and the app icons (`lib/pwa.ts`) pass for a stronger
 * reason: a browser fetches a manifest WITHOUT cookies, so gating it would
 * hand back the login redirect and the dashboard would quietly stop being
 * installable, signed in or not.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|icon.svg|favicon.ico|manifest.webmanifest|pwa/|apple-icon).*)'],
};

/**
 * True for a top-level page load, as opposed to an RSC payload fetch.
 *
 * `sec-fetch-dest` is the direct answer and every browser this dashboard is
 * reached from sends it; the `accept` check is the fallback for anything that
 * does not. The `RSC` header and `_rsc` query are Next's own markers for a
 * soft navigation or prefetch, and are excluded first because such a request
 * carries an HTML `accept` too.
 */
function isDocumentRequest(request: NextRequest): boolean {
  if (request.method !== 'GET') return false;
  if (request.headers.has('RSC') || request.nextUrl.searchParams.has('_rsc')) return false;
  const dest = request.headers.get('sec-fetch-dest');
  if (dest) return dest === 'document';
  return (request.headers.get('accept') ?? '').includes('text/html');
}


/**
 * A browser write from another origin, refused whatever cookie it carries.
 *
 * SameSite=Lax is not enough on its own here: "site" ignores the PORT, so a
 * page on ANY localhost port -- the sibling dashboard on 7843, a dev server,
 * anything a local program serves -- counts as same-site and its POSTs arrive
 * with this dashboard's cookie attached. The Origin header does carry the
 * port, and browsers send it on every cross-origin write.
 *
 * No Origin at all is let through: it is not a browser, so it has no ambient
 * cookie to abuse and still has to authenticate like anything else. `null`
 * (a sandboxed frame, a data: URL) fails to parse and is refused.
 */
function isCrossOriginWrite(request: NextRequest): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get('host');
  } catch {
    return true;
  }
}

/**
 * A path whose percent-encoding does not decode, like `/apps/100%`.
 *
 * Next validates a dynamic segment's encoding before any route code runs, and
 * answers a malformed one with a bare 500 -- a server fault, reported for what
 * is a bad address. It is the client's mistake, so it gets a 400, and it gets
 * it here, the one place that runs before Next's own routing does.
 */
function isMalformedPath(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isCrossOriginWrite(request)) {
    return NextResponse.json({ error: 'cross-origin' }, { status: 403 });
  }

  if (isMalformedPath(pathname)) {
    return new NextResponse('Bad Request: malformed URL encoding', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next();

  // The phone has no browser session and never will. `/api/android/ingest`
  // authenticates with its own bearer token, which is STRICTER than this gate,
  // not exempt from it: the route fails closed on an unset token exactly as
  // this gate does on an unset password. Kept to that one exact path so
  // adding a route under /api/android/ cannot accidentally inherit the bypass.
  if (pathname === '/api/android/ingest') return NextResponse.next();

  const password = configuredPassword();
  const authorised =
    password !== undefined &&
    (await verifySession(password, request.cookies.get(SESSION_COOKIE)?.value));

  if (authorised) {
    // Slide the expiry forward on an active session, so a device you use
    // regularly is never signed out. Only once a day, so this is not a
    // Set-Cookie on every request.
    const cookie = request.cookies.get(SESSION_COOKIE)?.value;
    if (password !== undefined && shouldRenew(cookie)) {
      const response = NextResponse.next();
      const { value, maxAgeSeconds } = await issueSession(password);
      response.cookies.set(SESSION_COOKIE, value, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds,
        secure: false,
      });
      return response;
    }
    return NextResponse.next();
  }

  // Fail closed, and say so in a form the caller can actually read. An
  // unconfigured password is a locked door, never an open one.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: password === undefined ? 'auth-not-configured' : 'unauthorised' },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';

  // Serve the form IN PLACE for a real page load, rather than sending the
  // browser to /login.
  //
  // A redirect rewrites the address bar, so a tab left open on a dashboard
  // page and reloaded after the session lapsed -- which is what a browser does
  // to a tab it discarded while you were away -- comes back as `/login`, and
  // the page you were actually on is gone from the URL. A rewrite renders the
  // same form at the same address: sign in and the page you asked for renders
  // underneath you, so the `?next=` round trip is not needed either.
  //
  // Only for document requests. An RSC payload request expects a flight
  // response and would choke on HTML, so those keep the redirect -- Next turns
  // it into a hard navigation, which is the right answer for a soft navigation
  // into a locked route.
  if (isDocumentRequest(request)) {
    const response = NextResponse.rewrite(url);
    // Nothing may cache the login form under a dashboard URL.
    response.headers.set('cache-control', 'no-store');
    return response;
  }

  if (pathname !== '/') url.searchParams.set('next', safeNextPath(`${pathname}${search}`) ?? '/');
  return NextResponse.redirect(url);
}
