import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { APP_BACKGROUND, MASKABLE_GLYPH, glyphOnly, iconDataUri, type PwaIcon } from './pwa';

/**
 * An app icon, rasterised from `src/app/icon.svg`. Called at build time by
 * the `/pwa/` route and by `app/apple-icon.tsx`.
 *
 * PNG because an install check and a phone launcher both want pixels at
 * named sizes, and drawn from the favicon rather than committed as binaries
 * so the mark has one definition. `next/og` ships its own WASM renderer, so
 * this adds no dependency -- in particular no native one, which a clean
 * `npm install` during a restore could fail to build.
 */
export function renderIcon({ size, purpose }: Pick<PwaIcon, 'size' | 'purpose'>): ImageResponse {
  const svg = readFileSync(join(process.cwd(), 'src', 'app', 'icon.svg'), 'utf8');
  const maskable = purpose === 'maskable';
  const glyph = maskable ? Math.round(size * MASKABLE_GLYPH) : size;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: maskable ? APP_BACKGROUND : 'transparent',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconDataUri(maskable ? glyphOnly(svg) : svg)} width={glyph} height={glyph} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
