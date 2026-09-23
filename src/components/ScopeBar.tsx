'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { RANGES, DEFAULT_DAYS, rangeLabel } from '@/lib/scope';

/**
 * Window length, kept in the URL.
 *
 * In the query string rather than component state so a view is linkable and
 * survives a refresh, and so every page reads the same scope without a shared
 * client store.
 *
 * The sibling Data Usage Tracker also carries a NETWORK selector here, because
 * Windows' own Data usage page is scoped to one Wi-Fi profile and an unscoped
 * total legitimately disagrees with it. Screen time has no equivalent axis --
 * time in an app is time in an app regardless of what it was connected to --
 * so this is range chips and nothing else.
 *
 * If a second axis ever does belong here, the likely candidate is "exclude
 * idle/launcher time", which is a definition toggle rather than a filter, and
 * probably belongs on the page rather than in the chrome.
 */
export function ScopeBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const days = Number(params.get('days') ?? DEFAULT_DAYS);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      startTransition(() => router.push(`${pathname}?${next.toString()}`));
    },
    [params, pathname, router],
  );

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        opacity: pending ? 0.55 : 1, transition: 'opacity 200ms var(--ease)',
      }}
    >
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        {RANGES.map((d) => (
          <button
            key={d}
            className="chip"
            data-active={days === d}
            onClick={() => setParam('days', String(d))}
            aria-pressed={days === d}
          >
            {rangeLabel(d)}
          </button>
        ))}
      </div>
    </div>
  );
}
