import {
  SkeletonPageHead, SkeletonCard, SkeletonStatGrid, SkeletonTable,
} from '@/components/Skeleton';

/**
 * App detail skeleton.
 *
 * `backLink` matters: this page's head carries a "back" line above the title,
 * and without it every card below starts 43px high and drops on load.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead backLink height={97} />
      <SkeletonStatGrid columns={4} valueHeight={54} />
      {/* One per card, in the page's order: daily time, daily opens, hourly
          time, hourly opens. A skeleton short of the real page is not merely
          cosmetic -- the cards below it jump on load. */}
      <SkeletonCard contentHeight={260} />
      <SkeletonCard contentHeight={260} />
      <SkeletonCard contentHeight={240} />
      <SkeletonCard contentHeight={240} />
      {/* Its title wraps: card measured 263 at both widths. */}
      <SkeletonCard contentHeight={0} titleHeight={72}>
        <SkeletonTable rows={2} columns={2} />
      </SkeletonCard>
    </>
  );
}
