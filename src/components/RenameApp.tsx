'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { MAX_NAME_LENGTH } from '@/lib/rename-limits';
import { cleanColour } from '@/lib/colour-hex';
import { PencilIcon } from './Icons';

export interface RenameTarget {
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
 * Rename an app, or change its bar colour, in a modal dialog.
 *
 * Opened from the detail page's pencil and from the "..." menu on By App.
 * It used to be an inline form that replaced the name where it stood, which
 * stretched a table row and squeezed a grid card out of shape; a dialog
 * leaves the page as it was (from the sibling, 2026-11-03).
 *
 * Both values are stored server-side (lib/app-renames.ts,
 * lib/app-colour-overrides.ts) and the page is then refreshed, so every chart,
 * legend and table on it picks the change up from the same place the server
 * does. Clearing the name, or Reset name, returns the app to its original
 * name; Default colour drops the user's colour.
 *
 * The colour can be picked or typed: the native picker for choosing by eye,
 * the hex field for pasting a brand's exact code. The two stay in step.
 *
 * A native <dialog> opened with showModal(): it traps focus, closes on
 * Escape and makes the page behind it inert. Portalled into `.shell` so it
 * wears the device's accent.
 */
export function RenameDialog({ onClose, ...t }: RenameTarget & { onClose: () => void }) {
  const { platform, device, appKey, name, baseName, colour, customColour } = t;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hex, setHex] = useState(colour);
  const [host, setHost] = useState<Element | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pressed = useRef(false);
  const renamed = name !== baseName;

  useEffect(() => setHost(document.querySelector('.shell') ?? document.body), []);
  useEffect(() => {
    if (!host) return;
    dialog.current?.showModal();
    input.current?.select();
  }, [host]);

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
    if (!nameChanged && !colourChanged) { onClose(); return; }
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
      onClose();
      router.refresh();
    } catch {
      setError('Could not reach the dashboard.');
    } finally {
      setBusy(false);
    }
  }

  if (!host) return null;
  const picked = cleanColour(hex);
  return createPortal(
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="rename-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      // A click on the backdrop lands on the <dialog> itself; one inside lands
      // on its content. Both ends must be on it, or a text selection dragged
      // out of the name field would close the dialog. React events bubble
      // through portals, so the click stops here: a grid card would otherwise
      // take it as a click on the card and open the detail page.
      onMouseDown={(e) => { pressed.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        e.stopPropagation();
        if (pressed.current && e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal-body"
        onSubmit={(e) => { e.preventDefault(); void save(input.current?.value ?? ''); }}
      >
        <h2 id="rename-title" className="modal-title">Rename or recolour</h2>

        <label className="modal-field">
          <span className="modal-label">Name</span>
          <input
            ref={input}
            className="rename-input"
            defaultValue={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder={baseName}
            disabled={busy}
          />
          {renamed && <span className="modal-hint">Originally {baseName}</span>}
        </label>

        <div className="modal-field">
          <span className="modal-label" id="rename-colour">Bar colour</span>
          <span className="colour-field" role="group" aria-labelledby="rename-colour">
            {/* The native picker needs a valid #rrggbb at all times, so while
                the hex field holds a half-typed value it keeps showing the
                last good one. */}
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
        </div>

        {error && <span className="rename-error" role="alert">{error}</span>}

        <div className="modal-actions">
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
          <span className="modal-actions-gap" />
          <button type="button" className="chip chip--small" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="chip chip--small" data-active="true" disabled={busy}>Save</button>
        </div>
      </form>
    </dialog>,
    host,
  );
}

/** The detail page's heading, with a pencil after the name that opens the dialog. */
export function RenameApp({ icon, ...t }: RenameTarget & { icon: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const renamed = t.name !== t.baseName;
  return (
    <h1 className="app-title">
      {icon}{t.name}
      <button
        type="button"
        className="rename-btn"
        onClick={() => setEditing(true)}
        title={renamed ? `Rename or recolour (originally ${t.baseName})` : 'Rename or recolour'}
        aria-label={`Rename or recolour ${t.name}`}
      >
        <PencilIcon size={14} />
      </button>
      {editing && <RenameDialog {...t} onClose={() => setEditing(false)} />}
    </h1>
  );
}
