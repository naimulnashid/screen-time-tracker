import { SkActivityPage } from '@/components/Skeleton';

/**
 * Expanded heat map skeleton: the page's own markup (components/Skeleton.tsx).
 * The phone's name is a stand-in: a loading boundary is given no params.
 */
export default function Loading() {
  return (
    <SkActivityPage
      device="My Phone"
      cardSub="Screen-on per day. Outlined days were never recorded - before the phone first synced, or evicted before it did - which is not the same as a quiet day."
    />
  );
}
