'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-next';

/** "40 seconds" / "3 minutes" -- a lockout is read once, so words beat 2m 40s. */
function waitLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        // No `next` is the normal case now: the gate REWRITES this form over
        // whatever page you asked for, so the address bar already holds it and
        // `refresh()` alone re-renders that page, signed in, without a
        // navigation. `next` survives only for the hard-navigation path a soft
        // navigation into a locked route still takes.
        // Only same-origin paths, decided by the URL parser rather than by a
        // prefix check -- see safe-next.ts for the backslash that beat one.
        const next = safeNextPath(params.get('next'));
        if (next) router.replace(next);
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        retryAfterSeconds?: number;
      };
      setError(
        payload.error === 'auth-not-configured'
          ? 'No password is set on the server. Add DASHBOARD_PASSWORD to .env.local and restart.'
          : payload.error === 'too-many-attempts'
            ? `Too many attempts. Try again in ${waitLabel(payload.retryAfterSeconds ?? 60)}.`
            : 'That password is not right.',
      );
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <img src="/icon.svg" alt="" className="login-mark" width={40} height={40} />
      <h1 className="login-title">Screen Time</h1>
      <p className="login-sub">
        This dashboard is reachable from your network and shows what was used
        on these devices, and when, so it asks for the shared password first.
      </p>

      <input
        type="password"
        className="login-input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        aria-label="Password"
        autoFocus
        autoComplete="current-password"
      />

      <button className="login-button" type="submit" disabled={busy || password.length === 0}>
        {busy ? 'Checking...' : 'Unlock'}
      </button>

      {/* role="alert" so a screen reader announces it: focus stays in the
          field after a wrong password, and nothing else would say why. */}
      {error && <p className="login-error" role="alert">{error}</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login-screen">
      {/* useSearchParams needs a boundary, or this page cannot be prerendered. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
