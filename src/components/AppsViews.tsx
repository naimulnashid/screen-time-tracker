'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { formatDuration, formatOpens } from '@/lib/format';
import { Card, CardTitle } from './Card';
import { GridIcon, TableIcon } from './Icons';

export type AppsView = 'table' | 'grid';

const VIEW_KEY = 'st-apps-view';

/**
 * Table or grid, remembered per browser: a viewing preference, like the
 * theme, so localStorage rather than the database. Read in an effect, never
 * during render, so the server and the first client render agree.
 */
function useAppsView(): [AppsView, (v: AppsView) => void] {
  const [view, setView] = useState<AppsView>('table');
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'grid') setView('grid');
    } catch {
      /* storage blocked: the table it is */
    }
  }, []);
  const choose = (v: AppsView) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ }
  };
  return [view, choose];
}

/** The two-way switch in the Apps card's head. */
function ViewToggle({ view, onChange }: { view: AppsView; onChange: (v: AppsView) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Show apps as">
      <button type="button" data-active={view === 'table'} aria-pressed={view === 'table'} onClick={() => onChange('table')} title="Table">
        <TableIcon size={15} /><span>Table</span>
      </button>
      <button type="button" data-active={view === 'grid'} aria-pressed={view === 'grid'} onClick={() => onChange('grid')} title="Grid">
        <GridIcon size={15} /><span>Grid</span>
      </button>
    </div>
  );
}

/**
 * One app as a card: its logo large, then the figures. The whole card opens
 * the detail page when the app has one; the name is the link for keyboards
 * and assistive tech, and clicks on the card's own controls are left alone.
 */
export function AppCard({
  href, icon, title, badges, actions, ms, opens, days, hidden, index,
}: {
  href?: string;
  /** The logo, at 52px. */
  icon: ReactNode;
  /** The name, a link when the app has a detail page. */
  title: ReactNode;
  badges?: ReactNode;
  /** The "..." menu. */
  actions: ReactNode;
  ms: number;
  opens: number;
  days: number;
  hidden?: boolean;
  index: number;
}) {
  const router = useRouter();
  return (
    <div
      className={`app-card${href ? ' app-card--link' : ''}${hidden ? ' app-card--hidden' : ''} animate-in`}
      style={{ animationDelay: `${Math.min(index * 22, 360)}ms` }}
      onClick={(e) => {
        if (!href) return;
        if ((e.target as HTMLElement).closest('a, button, input, select, form, label, dialog')) return;
        router.push(href);
      }}
    >
      <div className="app-card-top">
        {icon}
        <span className="app-card-actions">{actions}</span>
      </div>
      <div className="app-card-name">{title}</div>
      {badges && <div className="app-card-badges">{badges}</div>}
      <div className="app-card-total">{formatDuration(ms)}</div>
      <div className="app-card-io">{formatOpens(opens)}</div>
      <div className="app-card-days">{days} active {days === 1 ? 'day' : 'days'}</div>
    </div>
  );
}

export interface AppsItem {
  key: string;
  /** Hidden from this page by the user (lib/app-prefs.ts). */
  hidden: boolean;
  /** Clears `isListed()` (lib/app-list.ts); the rest wait behind "Show all". */
  listed: boolean;
  row: ReactNode;
  card: ReactNode;
}

/**
 * By App's list: a table or a grid of the same apps, the long tail folded
 * behind "Show all N apps", and hidden apps behind "Show N hidden".
 *
 * The rows and cards arrive already rendered from the server page -- links,
 * logos and menus -- and this only decides which are in the DOM. Which apps
 * fold is `splitForList()`, not a decision made here. Client toggles rather
 * than `?all=1` links: the list is already on the page, so a press should not
 * refetch every query behind it or throw the reader back to the top.
 */
export function AppsBrowser({
  title, sub, head, items, restSummary,
}: {
  title: string;
  sub: string;
  head: ReactNode;
  items: AppsItem[];
  /** What the folded, unhidden apps add up to, so the list still reconciles. */
  restSummary: string;
}) {
  const [view, setView] = useAppsView();
  const [all, setAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const hiddenCount = items.filter((i) => i.hidden).length;
  const visible = items.filter((i) => showHidden || !i.hidden);
  const folded = visible.filter((i) => !i.listed).length;
  const shown = all ? visible : visible.filter((i) => i.listed);

  return (
    <Card delay={120}>
      <CardTitle sub={sub} aside={<ViewToggle view={view} onChange={setView} />}>
        {title}
      </CardTitle>
      {view === 'table' ? (
        <div className="table-wrap">
          <table className="app-table">
            {head}
            <tbody>{shown.map((i) => i.row)}</tbody>
          </table>
        </div>
      ) : (
        <div className="app-grid">{shown.map((i) => i.card)}</div>
      )}
      {(folded > 0 || hiddenCount > 0) && (
        <div className="table-more">
          {folded > 0 && (
            <button type="button" className="chip" onClick={() => setAll((o) => !o)} aria-expanded={all}>
              {all ? 'Show fewer apps' : `Show all ${visible.length} apps`}
            </button>
          )}
          {hiddenCount > 0 && (
            <button type="button" className="chip" onClick={() => setShowHidden((o) => !o)} aria-pressed={showHidden}>
              {showHidden ? `Leave out the ${hiddenCount} hidden` : `Show ${hiddenCount} hidden`}
            </button>
          )}
          {!all && folded > 0 && restSummary && <span className="table-more-note">{restSummary}</span>}
        </div>
      )}
    </Card>
  );
}
