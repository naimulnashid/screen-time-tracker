'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_NAME_LENGTH } from '@/lib/rename-limits';
import { cleanColour } from '@/lib/colour-hex';

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
  /**
   * The colour the picker starts from, #rrggbb: the user's own, else the
   * brand colour, else the device accent the bars fall back to.
   */
  colour: string;
  /** Whether that colour is the user's own rather than the brand's or the accent. */
  customColour: boolean;
}

/**
 * Rename an app, or change its bar colour, from the page it is shown on.
 *
 * Two placements share one form:
 *
 * - `title`: the detail page's heading. The pencil sits after the name.
 * - `row`: a By App name cell. The pencil appears on row hover or focus, so a
 *   table of a hundred rows is not a column of pencils; on a touch screen,
 *   which has no hover, it is always shown.
 *
 * Both are stored server-side (lib/app-renames.ts, lib/app-colour-overrides.ts)
 * and the page is then refreshed, so every chart, legend and table on it picks
 * the change up from the same place the server does. Clearing the name, or
 * Reset name, returns the app to its original name; Default colour drops the
 * user's colour. Enter saves, Escape cancels.
 *
 * The colour can be picked or typed: the native picker for choosing by eye,
 * the hex field for pasting a brand's exact code. The two stay in step.
 *
 * Ported from the sibling Data Usage Tracker, 2026-10-01.
 */
export function RenameApp(props: Target & (
  | { variant: 'title'; icon: ReactNode }
  | { variant: 'row'; children: ReactNode }
)) {
  const { platform, device, appKey, name, baseName, colour, customColour } = props;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hex, setHex] = useState(colour);
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
    setHex(colour);
    setEditing(true);
  }

  async function post(path: string, body: Record<string, string>): Promise<string | null> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform, device, key: appKey, ...body }),
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return res.ok && out.ok ? null : (out.message ?? 'Could not save.');
  }

  /**
   * Save whatever changed. `next` is the name field; `nextColour` null means
   * "back to the default colour", undefined means "whatever the colour field
   * holds".
   */
  async function save(next: string, nextColour?: string | null) {
    const wanted = nextColour === undefined ? cleanColour(hex) : nextColour;
    if (nextColour === undefined && wanted === null) {
      setError('A colour is a hex code like #7c5cff.');
      return;
    }
    const nameChanged = next.trim() !== name;
    const colourChanged = wanted === null ? customColour : wanted !== colour.toLowerCase();
    if (!nameChanged && !colourChanged) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    try {
      if (nameChanged) {
        const failed = await post('/api/apps/name', { name: next });
        if (failed) { setError(failed); return; }
      }
      if (colourChanged) {
        const failed = await post('/api/apps/colour', { colour: wanted ?? '' });
        if (failed) { setError(failed); return; }
      }
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
      title={renamed ? `Rename or recolour (originally ${baseName})` : 'Rename or recolour'}
      aria-label={`Rename or recolour ${name}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );

  const picked = cleanColour(hex);
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
      <span className="colour-field" title="Bar colour: pick one, or type a hex code">
        {/* The native picker needs a valid #rrggbb at all times, so while the
            hex field holds a half-typed value it keeps showing the last
            good one. */}
        <input
          type="color"
          className="colour-swatch-input"
          value={picked ?? colour}
          onChange={(e) => setHex(e.target.value)}
          aria-label={`Colour for ${name}`}
          disabled={busy}
        />
        <input
          className="rename-input colour-hex-input"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          maxLength={7}
          spellCheck={false}
          aria-label={`Colour hex code for ${name}`}
          aria-invalid={picked === null}
          disabled={busy}
        />
      </span>
      <button type="submit" className="chip chip--small" data-active="true" disabled={busy}>Save</button>
      {renamed && (
        <button
          type="button"
          className="chip chip--small"
          disabled={busy}
          onClick={() => void save('', customColour ? colour : undefined)}
          title={`Back to ${baseName}`}
        >
          Reset name
        </button>
      )}
      {customColour && (
        <button
          type="button"
          className="chip chip--small"
          disabled={busy}
          onClick={() => void save(input.current?.value ?? name, null)}
          title="Back to the brand colour"
        >
          Default colour
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
