import {
  SkeletonPageHead, SkeletonCard, SkeletonTable,
} from '@/components/Skeleton';

/**
 * By App skeleton.
 *
 * The two ranked charts are `max(140, rows * 38 + 16)` high, and with eight
 * apps that is 320 -- derived, not measured, from `RankedApps` in Charts.tsx.
 * No score cards: the totals are on the Overview.
 *
 * The table lists only the apps that clear `isListed()` now, but still runs
 * well below the fold. Fourteen rows covers the first viewport's worth of it,
 * which is the only part that can visibly jump -- a deliberate departure, same
 * as the sibling project makes.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <SkeletonCard contentHeight={320} />
      <SkeletonCard contentHeight={320} />
      <SkeletonCard contentHeight={0}>
        <SkeletonTable rows={14} columns={5} />
      </SkeletonCard>
    </>
  );
}
