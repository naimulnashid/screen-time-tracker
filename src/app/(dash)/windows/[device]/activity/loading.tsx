import { SkActivityPage } from '@/components/Skeleton';
import { deviceLabel } from '@/lib/config';

/** Expanded heat map skeleton: the page's own markup (components/Skeleton.tsx). */
export default function Loading() {
  return (
    <SkActivityPage
      device={deviceLabel()}
      cardSub="Active time per day. Outlined days were never recorded - before the sampler existed, or while it was not running - which is not the same as a quiet day."
    />
  );
}
