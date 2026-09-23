import { SkeletonPageHead, SkeletonCard } from '@/components/Skeleton';

/**
 * Activity skeleton: a back link, then one block of the heat map. A second
 * block appears once history outgrows six months; this covers the first.
 *
 * One block with its date heading: card measured 446 @997 / 518 @1680,
 * title 79 / 55 -> 67, content 344.
 */
export default function Loading() {
  return (
    <>
      <SkeletonPageHead backLink />
      <SkeletonCard contentHeight={344} titleHeight={67} />
    </>
  );
}
