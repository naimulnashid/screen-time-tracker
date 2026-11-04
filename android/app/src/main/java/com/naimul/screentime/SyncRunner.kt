package com.naimul.screentime

import android.app.AppOpsManager
import android.content.Context
import android.os.Build
import android.os.Process
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One sync, start to finish. Shared by the button and the periodic job so the
 * two cannot drift apart.
 */
class SyncRunner(private val context: Context) {

    data class Outcome(val ok: Boolean, val message: String)

    /**
     * One sync at a time, per process. The button and the job each run on a
     * thread of their own, and two at once read the same window and send it
     * twice. The loser returns without touching the last result: the sync
     * already running is the one that will report.
     */
    fun runOnce(cancel: Cancel = Cancel()): Outcome {
        if (!running.compareAndSet(false, true)) return Outcome(true, ALREADY_RUNNING)
        return try {
            runLocked(cancel)
        } finally {
            running.set(false)
        }
    }

    /** Thrown out of a sync that [Cancel.cancel] stopped. */
    class Cancelled : Exception("Stopped by Android before it finished; the next sync picks it up")

    private fun runLocked(cancel: Cancel): Outcome {
        val prefs = Prefs(context)
        if (!prefs.isConfigured) return finish(prefs, false, "Server address and token not set")
        if (!hasUsageAccess(context)) return finish(prefs, false, "Usage access not granted")

        return try {
            val now = System.currentTimeMillis()

            /*
              Start BEFORE the watermark, deliberately.

              Whatever was in the foreground when the last sync ran had no
              closing event yet, so it was sent clipped to that moment. Starting
              exactly at the watermark would leave that truncated span in the
              database forever -- which is the bug that made "today" read a
              quarter below Digital Wellbeing's figure.

              Overlapping by an hour lets the server's MAX() upsert replace it
              with the full span, and costs one extra hour of events per sync.

              An hour is not enough for a span that was open LONGER than that:
              its opening event falls before the overlap, its close is then
              discarded as having no open, and the rest of it is never sent.
              So the read also reaches back to the earliest span still open at
              the last confirmed sync -- at most a day, the longest span the
              server accepts, so one session left open by a missed shutdown
              cannot pull the read back further every time.
            */
            val from = if (prefs.syncedThrough > 0) {
                val overlap = prefs.syncedThrough - OVERLAP_MS
                val open = prefs.openSince
                if (open in 1 until overlap) maxOf(open, prefs.syncedThrough - MAX_OPEN_MS) else overlap
            } else {
                // First run: ask for everything Android might still hold. Daily
                // rollups measured 10 days; asking for more is harmless, and
                // the event reach is exactly what we are trying to find out.
                now - 95L * 24 * 60 * 60 * 1000
            }

            val reading = UsageReader(context).read(from, now)
            cancel.check()
            // Measured every sync, kept as a SPAN: it is how long unsent
            // history survives on this phone, which is the stale-sync
            // warning's limit. See SyncWatchdog.
            reading.eventReachMs?.let { prefs.eventReachSpanMs = now - it }
            if (reading.sessions.isEmpty() && reading.screen.isEmpty()) {
                // Still advance: an empty window is a fact, not a failure, and
                // not advancing would re-read the same empty range forever.
                prefs.markSyncedThrough(now, null)
                return finish(prefs, true, "Nothing new to send")
            }

            val result = Uploader(prefs, cancel).upload(reading, now)
            if (result.ok && result.acceptedThrough != null) {
                // Advance from what the SERVER confirmed, never from what was
                // sent. An upload that fails halfway must be retried, not
                // skipped past.
                prefs.markSyncedThrough(result.acceptedThrough, reading.openSince)
            }

            // Surface the measured event reach in the result line: it is the
            // one number this app exists to discover beyond the usage itself,
            // and it decides the cadence.
            val reach = reading.eventReachMs?.let {
                val days = (now - it) / (24.0 * 60 * 60 * 1000)
                " | events reach ${String.format("%.1f", days)}d"
            } ?: ""
            finish(prefs, result.ok, result.message + reach)
        } catch (e: UsageReader.UsageAccessDenied) {
            finish(prefs, false, "Usage access was revoked")
        } catch (e: Cancelled) {
            finish(prefs, false, e.message!!)
        } catch (e: Exception) {
            // A disconnected upload surfaces as an IOException, not Cancelled.
            val message = if (cancel.cancelled) Cancelled().message!! else e.message ?: e.javaClass.simpleName
            finish(prefs, false, message)
        }
    }

    private fun finish(prefs: Prefs, ok: Boolean, message: String): Outcome {
        prefs.lastResult = (if (ok) "OK - " else "Failed - ") + message
        prefs.lastResultAt = System.currentTimeMillis()
        // Clears the warning once the server has caught up; never posts it.
        // A failed sync leaves posting to the daily check, so a phone off
        // its network is not re-notified every six hours.
        if (ok && !SyncWatchdog.staleness(context).stale) SyncWatchdog.dismiss(context)
        return Outcome(ok, message)
    }

    companion object {
        /** How far before the watermark to re-read. See the note in runOnce. */
        private const val OVERLAP_MS = 60 * 60 * 1000L

        /** Furthest an open span may pull the read back. See runOnce. */
        private const val MAX_OPEN_MS = 24 * 60 * 60 * 1000L

        private val running = AtomicBoolean(false)

        private const val ALREADY_RUNNING = "A sync is already running"

        /**
         * Whether PACKAGE_USAGE_STATS has actually been granted.
         *
         * It is an appop, not a runtime permission: `checkSelfPermission` says
         * "granted" as soon as it is in the manifest, whether or not the user
         * has switched it on. Asking AppOpsManager is the only honest check,
         * and getting it wrong means the app silently reports almost nothing
         * while looking like it works.
         */
        fun hasUsageAccess(context: Context): Boolean {
            val ops = context.getSystemService(AppOpsManager::class.java)
            // unsafeCheckOpNoThrow is 29+; below that the same call has its
            // older, deprecated name.
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ops.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName,
                )
            } else {
                @Suppress("DEPRECATION")
                ops.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName,
                )
            }
            return mode == AppOpsManager.MODE_ALLOWED
        }
    }
}
