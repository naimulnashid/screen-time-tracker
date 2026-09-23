/**
 * Where it is safe to send someone after they sign in.
 *
 * ⚠️ `startsWith('/') && !startsWith('//')` is NOT enough, and this project
 * shipped exactly that check. The WHATWG URL parser treats a backslash as a
 * slash in http(s) URLs, so `/\evil.example` passes it and then resolves to
 * `http://evil.example/` -- and Next's router hard-navigates to an external
 * URL without complaint. A crafted `?next=/%5Cevil.example` link would sign
 * you in and hand you straight to a look-alike page asking for the password
 * "again". Tabs and newlines are stripped by the parser too, so `/\t/evil`
 * becomes `//evil` AFTER any string check has run.
 *
 * So the answer is decided by the parser itself: resolve against a throwaway
 * origin and accept the result only if it is still on that origin. Backslashes
 * are refused outright as well, since no path this dashboard generates has one.
 *
 * Pure and dependency-free: it runs in the Edge middleware, in the browser on
 * the login page, and in the self-test.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  const base = 'http://next.invalid';
  try {
    const url = new URL(next, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
