/**
 * Security headers on every response.
 *
 * The dashboard is plain HTTP on a LAN and serves a minute-by-minute record of
 * what someone looked at, so the browser is told as little trust as possible:
 *
 *   frame-ancestors 'none' / X-Frame-Options  nobody may frame it -- the Sync
 *       now and Sign out buttons are state-changing, which is what makes
 *       clickjacking worth blocking.
 *   script-src 'self' 'unsafe-inline'  Next's App Router streams its payload
 *       in inline <script> tags, so a nonce-free CSP cannot drop
 *       'unsafe-inline'. It still refuses every external script, which is the
 *       half that matters for a page that loads nothing from anywhere else.
 *       Development adds 'unsafe-eval' for React Refresh; production never has
 *       it.
 *   style-src 'unsafe-inline'  Recharts and the components set inline styles.
 *   connect-src 'self'  the only thing the page ever fetches is its own API.
 *   Referrer-Policy no-referrer  dashboard URLs name devices and apps; a link
 *       out should not carry them.
 *
 * `poweredByHeader: false` drops `X-Powered-By: Next.js`, which told any
 * visitor the framework before they had signed in.
 *
 * Telemetry is NOT configured here -- there is no config key for it. It is a
 * property of the `next` CLI, off with `NEXT_TELEMETRY_DISABLED=1` or
 * `npx next telemetry disable`, and it concerns the build tooling, not the
 * running dashboard, which makes no outbound requests.
 */

const isDev = process.env.NODE_ENV === 'development';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

/**
 * App logos get a STRICTER policy than the pages.
 *
 * An SVG opened directly is a document, and this one would run with the
 * dashboard's origin and cookies. No logo here has script, but the folder is
 * hand-filled from the internet, so it gets no script, no network and a unique
 * origin regardless. Inline styles stay: plenty of real SVGs colour themselves
 * with a <style> block. It does not affect an <img> of the logo, where SVG
 * script never runs anyway.
 *
 * ⚠️ It has to live HERE, after the site-wide rule. Set in the route handler it
 * was silently overwritten: config headers are applied after the route's own,
 * and for a repeated key the later rule wins. Measured 2026-09-23 -- the route
 * sent the sandbox and the browser received the page policy.
 */
const logoCsp = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/api/app-logo/:path*',
        headers: [{ key: 'Content-Security-Policy', value: logoCsp }],
      },
    ];
  },
};

export default nextConfig;
