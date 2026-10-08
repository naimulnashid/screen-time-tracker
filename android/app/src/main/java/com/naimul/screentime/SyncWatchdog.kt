package com.naimul.screentime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Warns on the phone when the dashboard has not received its history for too
 * long -- before Android evicts it, because nothing can fetch it afterwards.
 *
 * **It is its own job, with NO network constraint.** The sync job only runs
 * when the network it needs is up, so the case worth warning about -- a phone
 * that has not seen home Wi-Fi for a week -- is exactly the case in which the
 * sync job never runs. A check hung off it would stay silent all the way to
 * the data loss it exists to prevent.
 *
 * **The limit is this phone's own, measured.** Event reach is not one number:
 * measured 2026-10-08 it was about 216 hours on the Nothing and the Redmi
 * Note 9 Pro, but 138 hours on the Redmi 5 Plus (MIUI 11, Android 8.1). A
 * fixed seven days would warn that phone a day and a half after its oldest
 * unsent hours were already gone. So the warning fires at the measured reach
 * minus [MARGIN_MS], capped at [MAX_AGE_MS] and never below [MIN_AGE_MS].
 */
class SyncWatchdog : JobService() {

    override fun onStartJob(params: JobParameters?): Boolean {
        // One prefs read and at most one notify: quick enough for the main
        // thread, so the job is finished on return.
        check(applicationContext)
        return false
    }

    override fun onStopJob(params: JobParameters?): Boolean = false

    /** How far behind the server is, and how far behind is too far. */
    data class Staleness(val ageMs: Long, val limitMs: Long, val reachMs: Long?) {
        val stale: Boolean get() = ageMs >= limitMs
    }

    companion object {
        private const val JOB_ID = 4713
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "sync-stale"
        private const val HOUR_MS = 60 * 60 * 1000L

        /** The owner's figure: seven days, written as the hours it is. */
        private const val MAX_AGE_MS = 168 * HOUR_MS

        /** Time left to get the phone onto the network once warned. */
        private const val MARGIN_MS = 48 * HOUR_MS

        /** So a phone whose history is new does not warn within a day. */
        private const val MIN_AGE_MS = 48 * HOUR_MS

        /** Daily is enough against a limit measured in days of hours. */
        private const val CHECK_EVERY_MS = 24 * HOUR_MS

        /**
         * Book the daily check, unless it is already booked.
         *
         * Unlike the sync job this is NOT re-registered every time: replacing
         * a periodic job restarts its period, so calling it from onResume
         * would push the check back every time the app was opened.
         */
        fun schedule(context: Context) {
            val scheduler = context.getSystemService(JobScheduler::class.java)
            if (scheduler.allPendingJobs.any { it.id == JOB_ID }) return
            scheduler.schedule(
                JobInfo.Builder(JOB_ID, ComponentName(context, SyncWatchdog::class.java))
                    .setPeriodic(CHECK_EVERY_MS)
                    .setPersisted(true)
                    .build(),
            )
        }

        fun staleness(context: Context): Staleness {
            val prefs = Prefs(context)
            val now = System.currentTimeMillis()
            // Never synced: count from the install, so a phone that has never
            // reached the dashboard is warned about too.
            val since = prefs.safeThrough.takeIf { it > 0 }
                ?: context.packageManager.getPackageInfo(context.packageName, 0).firstInstallTime
            val reach = prefs.eventReachSpanMs.takeIf { it > 0 }
            val limit = reach?.let { (it - MARGIN_MS).coerceIn(MIN_AGE_MS, MAX_AGE_MS) } ?: MAX_AGE_MS
            return Staleness(now - since, limit, reach)
        }

        /** Post the warning if the server is too far behind, else clear it. */
        fun check(context: Context) {
            if (!Prefs(context).isConfigured) return
            val s = staleness(context)
            if (!s.stale) {
                dismiss(context)
                return
            }

            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Sync warnings", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "When the dashboard has not had this phone's history for too long" },
            )

            val kept = s.reachMs?.let { "about ${hours(it)} of history on this phone" }
                ?: "only a few hundred hours of history"
            val text = "Android keeps $kept, and anything older than that cannot be " +
                "sent later. Connect to the dashboard's network and open the app to sync."
            val open = PendingIntent.getActivity(
                context, 0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            // Posting is a no-op while notifications are off, which the app's
            // status line says rather than this failing quietly.
            nm.notify(
                NOTIFICATION_ID,
                Notification.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_clock)
                    .setContentTitle("Screen time not synced for ${hours(s.ageMs)}")
                    .setContentText(text)
                    .setStyle(Notification.BigTextStyle().bigText(text))
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .build(),
            )
        }

        fun dismiss(context: Context) {
            context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        }

        /** Spans are hours, as everywhere in this project: no day rung. */
        fun hours(ms: Long): String = "${ms / HOUR_MS} hours"
    }
}
