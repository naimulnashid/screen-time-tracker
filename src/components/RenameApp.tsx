'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_NAME_LENGTH } from '@/lib/rename-limits';

interface Target {
  platform: 'windows' | 'android';
  /** The device's URL slug. */
  device: string;
  /** Resolved key on the laptop, package name on a phone -- what detail URLs carry. */
  appKey: string;
  /** As shown now, rename included. */
  name: string;
  /** As it would be without a rename. */
  baseName: string;
}

/**
 * Rename an app from the page it is shown on.
 *
 * Two placements share one form:
 *
 * - `title`: the detail page's heading. The pencil sits after the name.
 * - `row`: a By App name cell. The pencil appears on row hover or focus, so a
 *   table of a hundred rows is not a column of pencils; on a touch screen,
 *   which has no hover, it is always shown.
 *
 * The rename is stored server-side (lib/app-renames.ts) and the page is then
 * refreshed, so every chart, legend and table on it picks the change up from
 * the same place the server does. Clearing the field, or Reset, returns the
 * app to its original name. Enter saves, Escape cancels.
 *
 * Ported from the sibling Data Usage Tracker, 2026-10-01.
 */
export function RenameApp(props: Target & (
  | { variant: 'title'; icon: ReactNode }
  | { variant: 'row'; children: ReactNode }
)) {
  const { platform, device, appKey, name, baseName } = props;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const renamed = name !== baseName;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  // The field is disabled while a save is in flight, and a disabled field
  // loses focus -- so after a refused save, Escape and Enter would reach
  // nothing. Hand focus back so the reader can correct the name or cancel.
  useEffect(() => {
    if (editing && !busy && error) input.current?.focus();
  }, [editing, busy, error]);

  function open() {
    setError(null);
    setEditing(true);
  }

  async function save(next: string) {
    if (next.trim() === name) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/apps/name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, device, key: appKey, name: next }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !out.ok) { setError(out.message ?? 'Could not save.'); return; }
      setEditing(false);
      router.refresh();
    } catch {
      setError('Could not reach the dashboard.');
    } finally {
      setBusy(false);
    }
  }

  const pencil = (
    <button
      type="button"
      className="rename-btn"
      onClick={open}
      title={renamed ? `Rename (originally ${baseName})` : 'Rename'}
      aria-label={`Rename ${name}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );

  const form = (
    <form
      className="rename-form"
      onSubmit={(e) => { e.preventDefault(); void save(input.current?.value ?? ''); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }}
    >
      <input
        ref={input}
        className="rename-input"
        defaultValue={name}
        maxLength={MAX_NAME_LENGTH}
        placeholder={baseName}
        aria-label={`New name for ${name}`}
        disabled={busy}
        autoFocus
      />
      <button type="submit" className="chip chip--small" data-active="true" disabled={busy}>Save</button>
      {renamed && (
        <button
          type="button"
          className="chip chip--small"
          disabled={busy}
          onClick={() => void save('')}
          title={`Back to ${baseName}`}
        >
          Reset
        </button>
      )}
      <button type="button" className="chip chip--small" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && <span className="rename-error" role="alert">{error}</span>}
    </form>
  );

  if (props.variant === 'title') {
    return editing ? (
      <div className="app-title">{props.icon}{form}</div>
    ) : (
      <h1 className="app-title">{props.icon}{name}{pencil}</h1>
    );
  }
  return editing ? form : <>{props.children}{pencil}</>;
}
