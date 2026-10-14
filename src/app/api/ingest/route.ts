/**
 * Run the Windows ingest on demand, for the Sync now button.
 *
 * POST, not GET. It writes to the database, prunes completed JSONL files and
 * appends a `sync_log` row, so it must not be reachable by a link, a prefetch
 * or a browser that decided to warm a URL.
 *
 * Auth comes from the proxy, which covers everything except `/login` and
 * the phone's own bearer-token route. There is no extra check here on purpose:
 * a second, different rule is a second thing to get wrong.
 *
 * The hourly scheduled task remains the primary path. This is the "I want the
 * number now" path, because the sampler writes continuously while ingest runs
 * on a timer, so the dashboard is always a little behind by design.
 */

import { ingestWindows, describeIngest } from '@/lib/windows-ingest';
import { drainInbox, describeDrain } from '@/lib/inbox';

/**
 * The phones' cloud inbox rides along, so Sync now brings in whatever the
 * phones have sent too. Its failure never fails the button: the laptop's own
 * numbers are what was asked for, and the envelopes wait for the next run.
 */
async function inboxNote(): Promise<string> {
  try {
    const said = describeDrain(await drainInbox());
    return said ? ` ${said}` : '';
  } catch (err) {
    return ` The cloud inbox could not be read: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function POST() {
  try {
    const result = await ingestWindows();
    return Response.json({
      ok: true,
      message: describeIngest(result) + (await inboxNote()),
      inserted: result.inserted,
      read: result.read,
    });
  } catch (err) {
    // The message reaches a toast, so it has to be readable rather than a
    // stack. `ingestWindows` already recorded the failure in `sync_log` and
    // rolled back, so nothing is half-written.
    return Response.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
