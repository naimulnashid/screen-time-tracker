import { SkeletonPageHead, SkeletonCard, SkeletonTable } from '@/components/Skeleton';

/**
 * Android Sync Status skeleton. Same shape as the Windows one, but its two
 * status cards carry more rows: measured 502 @997 / 477 @1680 -> 364 of
 * content each (2026-09-23; the old 170 was 194px short).
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead />
      <div className="grid grid--2" style={{ marginBottom: '1.15rem' }}>
        <div className="card">
          <div style={{ height: 55, marginBottom: '1.15rem' }} />
          <div className="skeleton" style={{ height: 364 }} />
        </div>
        <div className="card">
          <div style={{ height: 55, marginBottom: '1.15rem' }} />
          <div className="skeleton" style={{ height: 364 }} />
        </div>
      </div>
      <SkeletonCard contentHeight={0}>
        <SkeletonTable rows={6} columns={6} rowHeight={52} />
      </SkeletonCard>
    </>
  );
}
