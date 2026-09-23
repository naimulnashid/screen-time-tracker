import {
  SkeletonPageHead, SkeletonCard, SkeletonStatGrid, HEATMAP_HEIGHT,
} from '@/components/Skeleton';

/**
 * Android Overview skeleton.
 *
 * NOTE: a cold load of a nested route paints this ANCESTOR skeleton first, not
 * the child's -- visiting /android/<slug>/sync directly shows this one while
 * the sync segment resolves. That is Next's boundary nesting working, not a
 * bug, but it does mean measuring a child skeleton by loading its URL silently
 * measures the parent.
 *
 * Two rows of three stat cards, as the page has: screen time on top, unlocks
 * beneath, each for the latest day, per day and the range total.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <SkeletonStatGrid columns={3} />
      <SkeletonStatGrid columns={3} />
      <SkeletonCard contentHeight={280} />
      <SkeletonCard contentHeight={HEATMAP_HEIGHT} titleHeight={79} />
      <SkeletonCard contentHeight={240} />
      {/* Attributed bar: 12px bar + legend + the explanatory note.
          Card measured 268 @997 / 243 @1680 -> 130 of content. */}
      <SkeletonCard contentHeight={130} />
    </>
  );
}
