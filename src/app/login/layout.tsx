import type { Metadata } from 'next';

/**
 * Only here for the title: the login page is a client component, and those
 * cannot export metadata.
 *
 * Note the gate REWRITES rather than redirects, so this form usually renders
 * at a dashboard URL -- "Sign in" is what the tab should say there too, since
 * the page it names is not what is showing.
 */
export const metadata: Metadata = { title: 'Sign in' };

/**
 * Rendered per request, never prerendered, so the response is `no-store`.
 *
 * A static /login is served with Next's own `s-maxage=31536000`, and that
 * REPLACED the `no-store` the gate sets on a rewrite -- so the form could go
 * out marked cacheable for a year under a dashboard URL. Measured 2026-09-23
 * on fresh Next 15 and 16 builds alike. A long-running server happened to
 * send `no-store`, which is how it went unnoticed. The page is a few KB with
 * no data, so rendering it per request costs nothing.
 */
export const dynamic = 'force-dynamic';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
