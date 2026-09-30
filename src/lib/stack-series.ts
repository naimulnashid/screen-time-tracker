import 'server-only';
import type { StackSeriesDatum } from '@/components/Charts';
import { brandColour } from './app-colour';
import { logoUrl, needsLightPlate } from './app-logo';
import { OTHER, type StackSeries } from './stack';

/**
 * Name, logo and brand colour for each band of a stacked chart.
 *
 * Resolved here because the logo manifest and the colour map read files, and
 * `Charts.tsx` is a client component -- the same split `TopAppDatum` makes on
 * By App. `device` is the logo scope: the laptop's scope list, or a phone's
 * slug.
 */
export function stackSeries(
  series: StackSeries[],
  nameOf: (id: string) => string,
  device: string | string[],
): StackSeriesDatum[] {
  return series.map((s) => {
    if (s.id === null) return { key: OTHER, name: 'Other', total: s.total };
    const name = nameOf(s.id);
    return {
      key: s.key,
      name,
      total: s.total,
      colour: brandColour(name, device),
      icon: logoUrl(name, device),
      plate: needsLightPlate(name, device),
    };
  });
}
