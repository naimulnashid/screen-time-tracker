# App logos

Drop image files in here by hand. **The project downloads nothing at runtime.**

`.svg`, `.png`, `.jpg`, `.jpeg`, `.webp` and `.gif` are served; anything else in
the folder is ignored, which is why this README does not show up as an app.

## This folder is local-only

**Everything here except this README is gitignored**, and a fresh clone ships
no logos at all -- every app draws its initial until you add some. Two reasons:

- **The artwork is not ours to license.** App icons are their owners'
  trademarks and copyrighted images; committing them would put them under this
  repository's licence.
- **A logo folder is an inventory of what is installed on each device.** On a
  real phone that means banking, password and health apps, next to the device
  model. That is not something to publish by accident.

Their brand colours are local for the same reason: `config/app-colours.json`,
with `config/app-colours.example.json` showing the shape. `npm run backup:kit`
copies both off the system drive, and `npm run drill` fails if the copy is
missing or stale -- git no longer protects them from a reset.

## The layout: one folder per device

**Every logo lives in the folder of the device that shows it**, copied rather
than shared when two devices show the same app:

```
apps_logo/
  My Laptop/        the Windows machine, named as the sidebar shows it
  pixel-8/          a phone, by its label or slug
  another-phone/
```

So a browser's logo may exist three times, and that is deliberate. A folder is then a
complete, readable answer to "what does this device show", and changing one
device's icon cannot possibly affect another.

**The cost is drift, and nothing here will catch it.** Replace the artwork in
one folder and the other devices keep the old one. Weigh that against the
alternative, which is that two Androids cannot both have a "Gallery".

**The root is a DROP ZONE, not a library.** Put a new logo at the top level,
run the distributor, and it lands in the folders whose devices need it:

```bash
npm run logo:distribute              # report only, changes nothing
npm run logo:distribute -- --apply   # place the copies, clear the root
```

It matches each device's recorded app names with the same rules the dashboard
uses, so a name that resolves on the page resolves here. Two things it will not
do:

- **It never copies between devices.** A file in `nothing-a001/` is the
  Nothing's artwork and may be the wrong picture entirely for another phone --
  that is the whole reason the folders exist. A device needing a logo nobody
  has is reported, never filled in from a neighbour.
- **It never deletes a root file no device claims.** No app matching it today
  is not the same as the artwork being useless.

The code still falls back from a device folder to the root, so a file left at
the top level keeps working. The layout is a choice on top of that, not
something the resolver enforces.

**An app whose device has no copy draws its initial.** That is the normal case
for most apps -- the distributor lists them per device when it runs, so you can
see what artwork is worth finding.

## Naming

**Name the file after the app's display name**, and put it in a device folder
(or the root, to be distributed). Matching ignores case and every character
that is not a letter or a digit, so all of these work as they are:

| File | Matches the app called |
|---|---|
| `Telegram.svg` | Telegram |
| `Keep Notes.svg` | Keep Notes |
| `Acme e-Reader.png` | Acme e-Reader |
| `iPlayer.png` | iPlayer |
| `X.svg` | X |

The display name is what the dashboard shows: for Android it is the label the
phone itself reports, and for Windows it is whatever `src/lib/app-name.ts`
resolves. If you are unsure, read it off the By App page — that string is what
the file has to be named.

One convenience on top of exact matching: a leading **Google** or **Microsoft**
is dropped on a second attempt, so `Chrome.svg` matches "Google Chrome". Exact
still wins first, which is why `Google Play Store.png` matches on its own name.

**An app with no file falls back to its initial in a muted square.** That is the
normal case, not a gap — there are hundreds of executables and only as many
logos as you have added. Nothing needs to be registered anywhere; adding the
file is the whole step (plus a line in `config/app-colours.json` if you want
the bars in its brand colour).

## Adding one while the dashboard is running

Just drop it in. The folder is rescanned whenever its modification time
changes, so a new logo appears on the next page load — **no restart, no cache
to clear.**

This is the reason logos are served by `/api/app-logo/...` instead of being
linked straight out of `public/`. Measured on 2026-09-01 against the live
server:

| Request | Result |
|---|---|
| `/apps_logo/Claude.svg` — present when the server booted | 200 |
| `/snapshot-probe.txt` — added afterwards | **404** |

`next start` snapshots `public/` at boot, and this dashboard runs as a logon
task that stays up for weeks. A logo added in the meantime would 404 with the
file plainly sitting on disk, spelled correctly — a failure that looks exactly
like broken matching code.

Replacing a logo's artwork in place keeps the same file name, so it is picked
up too; the route sets a 60-second cache, so give it a minute or hard-reload.

## One name, two different apps

The root is **one namespace shared by every device**, and a duplicate file name
is resolved by whichever sorts first -- silently, and in whichever direction the
alphabet happens to fall. That is a real bug, not a hypothetical: `Photos.png`
(the Windows icon) sorted ahead of `Photos.svg` and was being served for the
phone's **Google Photos**.

There are two fixes, and which one applies depends on whether the display names
can be told apart.

### If the names can differ, make them differ

Where a word names two different programs and the dashboard can say which, the
display name carries it: the laptop's are `Windows Camera`, `Windows Photos`
and `Windows Settings`, and their files are named to match. Names for the
laptop live in `src/lib/app-name.ts` -- if a Windows app shows a logo that
belongs to a phone app, that file is where to fix it, not here.

Where the two devices genuinely run the **same** app -- Brave, ChatGPT, Claude,
Telegram, VLC -- one file is the right answer and they share it.

### If they cannot, the folders already handle it

Two Android phones can report the same label for genuinely different apps, and
neither is wrong. **Measured 2026-09-04** across the Nothing and the Redmi:

| Display name | Nothing A001 | Redmi Note 9 Pro |
|---|---|---|
| Camera | `com.nothing.camera` | `com.android.camera` |
| Gallery | `com.nothing.gallery` | `com.miui.gallery` |

Each phone's folder holds its own `Gallery.png`, and no renaming is needed --
which is the case the per-device layout exists for. The Nothing's are the
monochrome-with-a-red-dot Nothing OS icons; the Redmi has no artwork for either
yet and draws its initial.

**Name the folder after the device as the dashboard shows it.** The folder is
matched with the same normalisation as a file name -- everything that is not a
letter or a digit is dropped -- so `nothing-a001`, `Nothing A001` and
`NothingA001` are the same folder. The sidebar's label and the URL's slug
normalise identically, so either works. The laptop answers to both its label
(`Zephyrus G16`) and its internal name (`zephyrus`).

**The brand colour follows the artwork.** `config/app-colours.json` is keyed by
the logo's identity and falls back from `nothing-a001/gallery` to a bare
`gallery`, so one entry still covers every copy of a shared logo. That
fallback needs watching where a logo is genuinely device-specific: when the
Nothing's Camera and Gallery became its own, their colours had to move with
them, or the Redmi would have drawn **no icon and a Nothing-red bar** -- a
colour inherited from another phone's logo, which is the mismatch the folders
exist to stop. `NEEDS_PLATE` in `src/lib/app-logo.ts` falls back the same way.


## Vacuum an SVG before deriving a colour from it

An editor export can be almost entirely dead weight. `Notepad.svg` arrived at
**92,380 bytes of which 173 of its 177 `<defs>` children were unreferenced** --
gradients and filters no painted element could reach. Four definitions and 16
elements draw the whole mark.

That is not just a big file. `measure-logo-colours.ts` counts paint
**declarations**, so it ranked 142 candidates that never render and proposed
`#d3ed89`, a pale green, for a logo that is **sky blue**. Not the wrong paint
of several -- a colour that is not in the picture at all.

```bash
npm run logo:vacuum -- -Path "public/apps_logo/Thing.svg" -InPlace
```

| | |
|---|---|
| Notepad.svg | 92,380 -> 4,627 bytes, 177 definitions -> 4 |
| colour candidates afterwards | 142 -> 4 |

Running it twice is safe: the second pass removes nothing.

### It refuses more often than it deletes

- **A file containing `<style>` or `<script>` is refused** unless you pass
  `-Force`. Only attribute values are scanned, so a `url(#id)` living in CSS
  is invisible to it and its target would be deleted. Nothing here has one.
- **It will not write if the rendered tree changed.** Every element with no
  `<defs>` in its ancestry is compared before and after, attribute for
  attribute. A difference means the reachability pass is wrong, not that the
  file got tidier.

### Then look at the difference blend. Actually look at it.

The script writes an HTML page and prints its path. Three panels: the original,
the vacuumed file, and the two overlaid with `mix-blend-mode: difference`.

**The third panel must be black.** A hairline at the outlines is anti-aliasing
between the two composited layers and is expected. Any solid shape is content
you just deleted -- do not commit it.

This is not ceremony, and the reason is worth keeping. The structural check
above was written first in a version that sliced the file from the first
`<defs` to the last `</defs>` and compared the remainder -- and this file has
**five** `<defs>` blocks, one of them nested. So the entire middle of the
document was cut from both sides and compared equal while genuinely differing.
It reported success on a file that had lost **16 `<path>` elements**. They
turned out to be unreferenced as well, so the answer was right by luck while
the check was wrong.

A render cannot be fooled that way. Two panels that differ show it; a diff of
two files can be talked into anything.

## Logos that are invisible on this page

The dashboard is near-black, so a logo drawn in black on transparency loads
perfectly and shows nothing — which reads as a failed lookup rather than as a
logo that worked. Those need a light plate behind them.

**Which ones cannot be guessed from the file name, only measured:**

```bash
npx tsx scripts/measure-logo-plates.ts
```

Anything it lists goes in `NEEDS_PLATE` in `src/lib/app-logo.ts`. Right now
that is `X.svg`, which is a single `<path>` with no `fill` attribute at all —
and SVG defaults that to black.

The script reads SVG source, so **it cannot judge a PNG or a JPG.** If a raster
logo turns up invisible, add it to the set by eye.
