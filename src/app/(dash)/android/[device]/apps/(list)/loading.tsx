import {
  SkeletonPageHead, SkeletonCard, SkeletonTable,
} from '@/components/Skeleton';

/**
 * Android By App skeleton.
 *
 * The charts are 320 each, as on the laptop's; Most opened adds the note
 * naming the home screen it leaves out. Measured 411 @997 / 386 @1680 -> 398.
 * No score cards: the totals are on the Overview.
 *
 * Rows are 58px, not the 42px default: each carries the package name on a
 * second line under the label, which the Windows table does not.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <SkeletonCard contentHeight={320} />
      <SkeletonCard contentHeight={398} />
      <SkeletonCard contentHeight={0}>
        <SkeletonTable rows={12} columns={5} rowHeight={58} />
      </SkeletonCard>
    </>
  );
}
