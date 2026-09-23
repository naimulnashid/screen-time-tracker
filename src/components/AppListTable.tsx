'use client';

import { useState, type ReactNode } from 'react';

/**
 * The By App table, with its long tail folded behind a button.
 *
 * The rows arrive already rendered from the server page -- links, logos and
 * all -- and this only decides whether the second half is in the DOM. Which
 * apps go in which half is `splitForList()` in `lib/app-list.ts`, not a
 * decision made here.
 *
 * A client toggle rather than a `?all=1` link: the table is already on the
 * page, so pressing the button should not refetch every query behind it or
 * throw the reader back to the top of a page they had scrolled to the end of.
 * The price is that the expanded state is not in the URL, which for a "show
 * more" is the right way round.
 */
export function AppListTable({
  head, shown, rest, restSummary, total,
}: {
  head: ReactNode;
  shown: ReactNode;
  rest: ReactNode;
  /** What the folded rows add up to, so the table still reconciles. */
  restSummary: string;
  /** Every app in the range, for the button's label. */
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const hasRest = restSummary !== '';

  return (
    <>
      <div className="table-wrap">
        <table className="app-table">
          {head}
          <tbody>
            {shown}
            {open && rest}
          </tbody>
        </table>
      </div>
      {hasRest && (
        <div className="table-more">
          <button type="button" className="chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Show fewer apps' : `Show all ${total} apps`}
          </button>
          {!open && <span className="table-more-note">{restSummary}</span>}
        </div>
      )}
    </>
  );
}
