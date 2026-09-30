import 'server-only';
import type { StackSeriesDatum } from '@/components/Charts';
import { brandColour } from './app-colour';
import { logoUrl, needsLightPlate, lookName } from './app-logo';
import { OTHER, type StackSeries } from './stack';

/**
 * Name, logo and brand colour for each band of a stacked chart.
 *
 * Resolved here because the logo manifest and the colour map read files, and
 * `Charts.tsx` is a client component -- the same split `TopAppDatum` makes on
 * By App. `device` is the logo scope: the laptop's scope list, or a phone's
 * slug. `nameOf` gives the shown name and the name before any rename, since
 * the logo and colour follow `lookName()`.
 */
export function stackSeries(
  series: StackSeries[],
  nameOf: (id: string) => { name: string; base: string },
  device: string | string[],
): StackSeriesDatum[] {
  return series.map((s) => {
    if (s.id === null) return { key: OTHER, name: 'Other', total: s.total };
    const { name, base } = nameOf(s.id);
    const look = lookName(name, base, device);
    return {
      key: s.key,
      name,
      total: s.total,
      colour: brandColour(look, device),
      icon: logoUrl(look, device),
      plate: needsLightPlate(look, device),
    };
  });
}
