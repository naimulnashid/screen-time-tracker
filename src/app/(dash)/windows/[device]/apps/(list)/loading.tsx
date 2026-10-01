import { SkPageHead, SkCard, SkRanked, SkDataTable } from '@/components/Skeleton';
import { listRule } from '@/lib/app-list';

/**
 * Laptop By App skeleton: the page's own markup (components/Skeleton.tsx).
 *
 * The two rankings draw eight bars each, as the page does once eight apps
 * exist. The table is a deliberate departure: its length is data, so it
 * draws ten rows -- it starts below the first viewport, where a wrong
 * length moves nothing anyone is looking at.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title="By App" sub="24 apps across 20 days" />
      <SkCard title="Top apps" sub="Grouped by resolved app, not by executable path. Hover a bar for time, share and opens.">
        <SkRanked />
      </SkCard>
      <SkCard title="Most opened" sub="Ranked by how often you switched to it. Hover a bar for share and time.">
        <SkRanked />
      </SkCard>
      <SkCard
        title="Apps · 12 of 24"
        sub={
          `${listRule()} ` +
          'On Windows every row together DOES sum to the active total: the ' +
          'sampler records exactly one foreground app at a time, so the rows ' +
          'partition the time rather than overlapping it.'
        }
      >
        <SkDataTable
          icon
          head={['App', 'Time', 'Share', 'Opens', 'Days']}
          rows={10}
          cells={['Code Editor', '57h 43m', '34.9%', '122', '20']}
        />
      </SkCard>
    </>
  );
}
