import {
  SkeletonPageHead, SkeletonCard, SkeletonStatGrid, HEATMAP_HEIGHT,
} from '@/components/Skeleton';

/**
 * Windows Overview skeleton.
 *
 * Heights here are DERIVED rather than eyeballed, because most of this page
 * has a known size: the trend is `ResponsiveContainer height={280}` and the
 * hourly chart `{240}`. Only the page head and the stat values use the
 * measured constants baked into Skeleton.tsx.
 *
 * The heat map is the one width-sensitive panel; see `HEATMAP_HEIGHT`.
 *
 * `SkeletonCard`'s own chrome (title block + its 1.15rem margin + card
 * padding) is added by the component, so these numbers are content only.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <SkeletonStatGrid columns={3} />
      {/* The trend's title carries the Heaviest day callout. With the
          sidebar collapsed it fits beside the sub at both widths: 405. */}
      <SkeletonCard contentHeight={280} />
      <SkeletonCard contentHeight={HEATMAP_HEIGHT} titleHeight={79} />
      <SkeletonCard contentHeight={240} />
      {/* KindBar: 12px bar + 0.85rem + one legend row. Measured 176 for the
          card at both widths -> 50 of content. */}
      <SkeletonCard contentHeight={50} />
    </>
  );
}
