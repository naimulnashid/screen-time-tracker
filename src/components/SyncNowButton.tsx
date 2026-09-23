'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toast, type ToastKind } from '@/components/Toast';

/**
 * Fold the sampler's pending JSONL into the database, now.
 *
 * WHY THIS EXISTS. The sampler writes continuously; ingest runs on a timer. So
 * the dashboard is always slightly behind by design, and the gap is however
 * long it has been since the last run. When that timer was DAILY the gap was
 * up to 24 hours, and the symptom was a laptop that appeared to have one hour
 * of use across one day while 722 unread spans sat on disk. The task is hourly
 * now, which makes that a much smaller lie -- but "I want the number now" is
 * still a real thing to want, and this is the button for it.
 *
 * It does not fetch new data from anywhere: everything it folds in was already
 * recorded and safe on disk. Pressing it can only move rows forward, and
 * pressing it twice does nothing the first press did not -- the ingest is
 * idempotent by construction.
 *
 * `router.refresh()` afterwards, because every dashboard page is
 * `force-dynamic`: the server re-runs the queries and the numbers change under
 * the toast without a full page load.
 */
export function SyncNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);

  async function sync() {
    setBusy(true);
    try {
      const res = await fetch('/api/ingest', { method: 'POST' });
      const body = (await res.json()) as { ok?: boolean; message?: string };

      setToast({
        message: body.message ?? (res.ok ? 'Done.' : `Failed with ${res.status}.`),
        kind: res.ok && body.ok ? 'ok' : 'error',
      });

      if (res.ok && body.ok) router.refresh();
    } catch (err) {
      // A dead dashboard process is the likely cause, and "Failed to fetch"
      // alone would not say that.
      setToast({
        message: `Could not reach the server: ${err instanceof Error ? err.message : String(err)}`,
        kind: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="chip"
        onClick={() => void sync()}
        disabled={busy}
        title="Fold the sampler's pending spans into the database"
      >
        <span className="sync-label">
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            className={busy ? 'spin' : undefined}
            aria-hidden
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {busy ? 'Syncing' : 'Sync now'}
        </span>
      </button>

      {toast && (
        <Toast
          message={toast.message}
          kind={toast.kind}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
