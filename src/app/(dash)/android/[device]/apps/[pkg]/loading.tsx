import {
  SkeletonPageHead, SkeletonCard, SkeletonStatGrid,
} from '@/components/Skeleton';

/** Android app detail skeleton. No "merged from" card on this side. */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead backLink height={93} />
      <SkeletonStatGrid columns={4} valueHeight={54} />
      {/* Four charts, not two: daily time, daily opens, hourly time, hourly
          opens. This lagged the page when the opens charts were added, and a
          short skeleton makes the cards below it jump on load. */}
      <SkeletonCard contentHeight={260} />
      <SkeletonCard contentHeight={260} />
      <SkeletonCard contentHeight={240} />
      <SkeletonCard contentHeight={240} />
    </>
  );
}
