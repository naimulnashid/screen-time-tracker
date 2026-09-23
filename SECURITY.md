# Security

## Reporting a problem

Please report vulnerabilities **privately**, through GitHub's
[private vulnerability reporting](https://github.com/naimulnashid/screen-time-tracker/security/advisories/new)
("Security" tab → "Report a vulnerability"), not in a public issue. This is a
personal project maintained in spare time, so expect a reply within a couple
of weeks rather than hours. Only the latest commit on `master` is supported.

## What this is, and the threat model it assumes

A **single-user, self-hosted** dashboard. It records which app was in the
foreground and for how long, on one Windows PC and its owner's Android phones,
and serves that history over **plain HTTP on the local network**. It is not
designed for the internet, for multiple users, or for hostile networks.

That data is personal, and the defaults are chosen accordingly:

| Concern | What the project does |
|---|---|
| Who can read the dashboard | Every page and API is behind one shared password (`DASHBOARD_PASSWORD`). Unset, the dashboard **refuses everything** -- it fails closed, never open. |
| Guessing the password | Wrong guesses are counted: a per-client lockout after 5, and a global budget of 30 per 15 minutes that a spoofed `X-Forwarded-For` cannot escape. |
| A copied session cookie | `httpOnly`, 30 days, HMAC-signed with a PBKDF2-derived key, so the cookie cannot be used to test password guesses offline. Rotating the password revokes every session. |
| The phone's uploads | A separate bearer token (`ANDROID_INGEST_TOKEN`), also fail-closed. Bodies are capped on the wire (8 MB) and after decompression (64 MB), and payload shapes are validated. |
| The phone sending to the wrong place | The app refuses cleartext HTTP to anything outside private, loopback and link-local ranges (carrier-grade NAT included). |
| Cross-site requests | State-changing requests from another origin -- including another port on `localhost` -- are refused. `SameSite=Lax` cookies. |
| Browser hardening | Content-Security-Policy, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, a restrictive Permissions-Policy. SVG logos are served sandboxed. |
| Window titles | **Never captured.** A title can name the document, page or person on screen; this records the app and the duration only. |
| Outbound traffic | None at runtime. No telemetry, no analytics, no remote fonts. |

## Known limitations -- read before running it

- **Plain HTTP.** The password and session cookie cross your Wi-Fi unencrypted.
  On a network you do not trust, anyone on it can read them. Put it behind a
  TLS reverse proxy if that matters to you.
- **It listens on every interface**, because the phone must reach it. On
  Windows, run `npm run firewall` from an Administrator shell to block the port
  on **Public** networks -- after marking your home network **Private**, or
  the phone will be cut off. See `scripts/firewall-private-only.ps1`.
- **One password, one user.** There are no accounts, roles or audit log.
- **Sign-out is per browser.** Sessions are stateless: signing out clears this
  browser's cookie, but a copied cookie stays valid until it expires or the
  password changes.
- **`.env.local` and the recovery kit's copy of it are plaintext** on local
  disk, with the protection your user account gives them and no more.
