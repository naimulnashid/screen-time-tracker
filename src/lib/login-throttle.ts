/**
 * Brute-force protection for the one shared password.
 *
 * The first version was a 400 ms sleep after a wrong guess. That slows ONE
 * attacker who waits for each answer; a hundred requests in parallel still got
 * a hundred guesses per 400 ms. This counts attempts instead.
 *
 * TWO LAYERS, because the per-client one can be walked around:
 *
 *   per client  after FREE_FAILURES wrong guesses, an exponential lockout
 *               (1s, 2s, 4s ... capped at 15 min). This is what a person who
 *               mistypes meets, and it forgives them after a quiet window.
 *
 *   global      at most GLOBAL_FAILURES wrong guesses per window from
 *               EVERYONE. ⚠️ This is the real bound. The client key is the
 *               `x-forwarded-for` header, and Next only fills that in when it
 *               is ABSENT (`??=` in base-server.js, measured 2026-09-23) -- so
 *               a caller can send any value it likes and be a new client every
 *               request. Nothing a caller controls escapes this counter.
 *
 * The cost of the global layer is that someone hammering the form can keep the
 * OWNER from signing in until it cools down. That is the right way round: a
 * signed-in device keeps its 30-day session and is not affected, and a locked
 * form is recoverable while a guessed password is not.
 *
 * An attempt is charged BEFORE the password is checked and refunded on
 * success. Charging after would let a burst of parallel requests all pass the
 * check before any of them had been counted.
 *
 * Pure, with an injectable clock, so `npm run selftest` can drive it. State is
 * per process, which is the whole server here.
 */

export const FREE_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
export const MAX_LOCK_MS = 15 * 60_000;
export const GLOBAL_FAILURES = 30;
/** Past this many tracked clients, forget the quiet ones -- bounded memory. */
const MAX_CLIENTS = 1000;

interface ClientState {
  failures: number;
  lastFailure: number;
  lockedUntil: number;
}

export type Verdict =
  | { allowed: true; ticket: Ticket }
  | { allowed: false; retryAfterMs: number };

/** Proof of an admitted attempt, handed back to refund it on success. */
export interface Ticket {
  client: string;
  at: number;
}

export class LoginThrottle {
  private clients = new Map<string, ClientState>();
  private global: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Admit or refuse an attempt. An admitted one is charged as a failure. */
  attempt(client: string): Verdict {
    const t = this.now();
    this.global = this.global.filter((at) => t - at < WINDOW_MS);

    let state = this.clients.get(client);
    if (state && t - state.lastFailure >= WINDOW_MS) {
      this.clients.delete(client);
      state = undefined;
    }

    if (state && state.lockedUntil > t) {
      return { allowed: false, retryAfterMs: state.lockedUntil - t };
    }
    if (this.global.length >= GLOBAL_FAILURES) {
      return { allowed: false, retryAfterMs: this.global[0]! + WINDOW_MS - t };
    }

    const failures = (state?.failures ?? 0) + 1;
    const lockedUntil = failures >= FREE_FAILURES
      ? t + Math.min(1000 * 2 ** (failures - FREE_FAILURES), MAX_LOCK_MS)
      : 0;
    this.clients.set(client, { failures, lastFailure: t, lockedUntil });
    this.global.push(t);
    this.prune(t);
    return { allowed: true, ticket: { client, at: t } };
  }

  /** The password was right: forget this client's failures, refund the charge. */
  succeeded(ticket: Ticket): void {
    this.clients.delete(ticket.client);
    const i = this.global.indexOf(ticket.at);
    if (i >= 0) this.global.splice(i, 1);
  }

  private prune(t: number): void {
    if (this.clients.size <= MAX_CLIENTS) return;
    for (const [key, s] of this.clients) {
      if (t - s.lastFailure >= WINDOW_MS || s.lockedUntil <= t) this.clients.delete(key);
    }
  }
}

/**
 * Who is asking, as far as the request can say.
 *
 * Spoofable by design of the header -- see the global layer above -- but
 * accurate for every honest client, which is who the per-client layer is for.
 */
export function clientKey(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
