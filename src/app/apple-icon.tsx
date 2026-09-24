import { APPLE_ICON } from '@/lib/pwa';
import { renderIcon } from '@/lib/pwa-icon';

/**
 * iOS reads neither the manifest nor its icons; it wants an apple-touch-icon.
 *
 * A file convention rather than `metadata.icons.apple` on purpose: setting
 * `icons` in the root layout's metadata REPLACES the file-based `icon.svg`
 * instead of adding to it, and every page lost its favicon. Measured
 * 2026-09-24 on a production build.
 */
export const size = { width: APPLE_ICON.size, height: APPLE_ICON.size };
export const contentType = 'image/png';

export default function AppleIcon() {
  return renderIcon(APPLE_ICON);
}
