package com.naimul.screentime

import android.app.AppOpsManager
import android.content.Context
import android.os.Process

/**
 * One sync, start to finish. Shared by the button and the periodic job so the
 * two cannot drift apart.
 */
class SyncRunner(private val context: Context) {

    data class Outcome(val ok: Boolean, val message: String)

    fun runOnce(): Outcome {
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
            */
            val from = if (prefs.syncedThrough > 0) {
                prefs.syncedThrough - OVERLAP_MS
            } else {
                // First run: ask for everything Android might still hold. Daily
                // rollups measured 10 days; asking for more is harmless, and
                // the event reach is exactly what we are trying to find out.
                now - 95L * 24 * 60 * 60 * 1000
            }

            val reading = UsageReader(context).read(from, now)
            if (reading.sessions.isEmpty() && reading.screen.isEmpty()) {
                // Still advance: an empty window is a fact, not a failure, and
                // not advancing would re-read the same empty range forever.
                prefs.syncedThrough = now
                return finish(prefs, true, "Nothing new to send")
            }

            val result = Uploader(prefs).upload(reading, now)
            if (result.ok && result.acceptedThrough != null) {
                // Advance from what the SERVER confirmed, never from what was
                // sent. An upload that fails halfway must be retried, not
                // skipped past.
                prefs.syncedThrough = result.acceptedThrough
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
        } catch (e: Exception) {
            finish(prefs, false, e.message ?: e.javaClass.simpleName)
        }
    }

    private fun finish(prefs: Prefs, ok: Boolean, message: String): Outcome {
        prefs.lastResult = (if (ok) "OK - " else "Failed - ") + message
        prefs.lastResultAt = System.currentTimeMillis()
        return Outcome(ok, message)
    }

    companion object {
        /** How far before the watermark to re-read. See the note in runOnce. */
        private const val OVERLAP_MS = 60 * 60 * 1000L

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
            val mode = ops.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
            return mode == AppOpsManager.MODE_ALLOWED
        }
    }
}
