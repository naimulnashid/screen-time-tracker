# Project site

The one-page site for people who find the repository: the problem it solves,
what it does, every chart the dashboard draws (live), how it works, how to
install it, and a short FAQ. Built on the **Onyx** design system, on the same
structure as the sibling Data Usage Tracker's site, from which it was ported
on 2026-11-04.

| | |
|---|---|
| Built with | [Astro](https://astro.build) 7, static output; Geist from Fontsource, self-hosted |
| Design | Onyx tokens in `src/styles/onyx.css`, copied unchanged from the Onyx repo: refresh it there, never edit it here |
| Light theme | A grey page (`#e6e6ea`) behind white cards, overridden in `src/styles/global.css`, not in `onyx.css` |
| Accent | **The dashboard's own: Focus Violet for the laptop, Android Green for a phone** (`src/lib/accent.ts` in the dashboard), not Onyx's. `data-device` on `<html>` or a section picks the family |
| Icons | Lucide shapes inlined in `src/components/Icon.astro`; no icon library ships |
| Charts | `src/scripts/charts.js`: drawn from a fixed seed, so the same on every load and nobody's usage; they follow the dashboard's (`src/components/Charts.tsx`, `ActivityHeatmap.tsx`, `KindBar.tsx`). The demo apps' logos are in `public/logos/` (generic marks for the invented apps only, as the Data Usage site ships its own); an app without one shows its initial |
| Screenshots | **None.** The screenshot tour has been hidden since 2026-10-15, pending the owner's review, so the hero shows how much history each source keeps instead |

`?device=android` opens the chart gallery on the phone.

**Phones get the desktop layout, zoomed out to fit**: a `width=1280` viewport.
The narrow styles stay for a narrow desktop window.

## Build and preview

Needs Node.js 22.12 or newer (Astro's `engines`). From `site\`:

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run preview
```

`npm run build` writes `dist/` (gitignored) and then runs
`scripts/check-csp.mjs`, which fails if the page holds an inline script the
Content-Security-Policy does not allow (below). `npm run preview` serves
`dist/` at http://localhost:4321.

## Deploying on Vercel

Root Directory `site`; everything else is in `vercel.json`: the Astro build,
the security headers and when to build at all.

- **CSP.** Scripts load only from the site itself, plus the one inline theme
  snippet in `src/layouts/Base.astro` (it must run before first paint), allowed
  by its hash. Edit that snippet and the build prints the new hash to put in
  `vercel.json`. Astro is told never to inline anything else
  (`assetsInlineLimit: 0`). Styles allow `'unsafe-inline'`: the charts colour
  their shapes through style attributes.
- **A push builds only when the site could have changed**: something under
  `site/`, `docs/screenshots/`, `docs/social-preview.png` or the root
  `package.json` (the footer's version) differs from the last successful
  deployment (`ignoreCommand`; exit 0 skips). With no previous deployment it
  builds.
- Link previews use the repository's social card (`docs/social-preview.png`),
  with absolute URLs from `VERCEL_PROJECT_PRODUCTION_URL`.
