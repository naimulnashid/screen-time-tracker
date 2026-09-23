import { SkeletonPageHead, SkeletonCard, SkeletonTable } from '@/components/Skeleton';

/**
 * Sync Status skeleton.
 *
 * The run history grows with every collector run up to its 40-row cap, so like
 * the By App table it has no height a skeleton can match for long. It covers
 * the first viewport and no more.
 *
 * Rows are 52px rather than the 42px default: each carries a status badge and
 * can carry an error line, which makes them taller than an app row.
 *
 * The two status cards measured 338 at both widths on 2026-09-23 -> 212 of
 * content each; the old 150 left the table starting 62px high.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <div className="grid grid--2" style={{ marginBottom: '1.15rem' }}>
        <div className="card">
          <div style={{ height: 55, marginBottom: '1.15rem' }} />
          <div className="skeleton" style={{ height: 212 }} />
        </div>
        <div className="card">
          <div style={{ height: 55, marginBottom: '1.15rem' }} />
          <div className="skeleton" style={{ height: 212 }} />
        </div>
      </div>
      <SkeletonCard contentHeight={0}>
        <SkeletonTable rows={8} columns={6} rowHeight={52} />
      </SkeletonCard>
    </>
  );
}
