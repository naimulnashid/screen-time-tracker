import type { MetadataRoute } from 'next';
import { PWA_MANIFEST } from '@/lib/pwa';

/**
 * `/manifest.webmanifest`, which makes the dashboard installable as an app.
 * Next links it from every page by itself. The content lives in `lib/pwa.ts`,
 * where the self-test can reach it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    ...PWA_MANIFEST,
    icons: PWA_MANIFEST.icons.map((i) => ({ ...i })),
  };
}
