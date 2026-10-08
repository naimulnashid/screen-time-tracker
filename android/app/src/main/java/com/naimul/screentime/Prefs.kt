package com.naimul.screentime

import android.content.Context
import java.util.UUID

/**
 * Everything the app remembers, which is deliberately very little.
 *
 * No usage data is stored on the phone. Android already keeps it -- about ten
 * days at the resolution this app reads -- and this app's job is to move it,
 * not to hold a second copy.
 */
class Prefs(context: Context) {

    private val sp = context.getSharedPreferences("screen-time", Context.MODE_PRIVATE)

    /**
     * A random id generated once, at the first sync after install.
     *
     * NOT the hardware serial, ANDROID_ID or an advertising id. Those are
     * either unavailable without extra permissions or are identifiers this
     * project has no business holding; all the dashboard needs is something
     * stable enough to tell two phones apart.
     *
     * Uninstalling deletes it, so a reinstalled app reports as a new phone;
     * `npm run android:merge` folds the old entry's history into the new one.
     *
     * Created under a lock. Saving the address books the sync job, which
     * runs at once, so on a fresh install it and Sync now can ask for the id
     * together. Unlocked, both found none and each made its own: the
     * dashboard got two new phones 24 ms apart (Redmi Note 9 Pro,
     * 2026-10-08), one of them never heard from again.
     */
    val deviceId: String
        get() = synchronized(ID_LOCK) {
            sp.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
                sp.edit().putString(KEY_DEVICE_ID, it).commit()
            }
        }

    var serverUrl: String
        get() = sp.getString(KEY_URL, "") ?: ""
        set(v) = sp.edit().putString(KEY_URL, v.trim().trimEnd('/')).apply()

    var token: String
        get() = sp.getString(KEY_TOKEN, "") ?: ""
        set(v) = sp.edit().putString(KEY_TOKEN, v.trim()).apply()

    /**
     * Epoch ms the SERVER confirmed it stored through.
     *
     * Advanced from the response, never from what was sent: an upload that
     * fails halfway must be retried, not skipped. The next read starts BEFORE
     * this, because the span in flight at the last sync was clipped to that
     * moment and its later, longer reading has to replace it -- which the
     * server's MAX() upsert does.
     */
    var syncedThrough: Long
        get() = sp.getLong(KEY_THROUGH, 0L)
        set(v) = sp.edit().putLong(KEY_THROUGH, v).apply()

    /**
     * Epoch ms the server is known to hold this phone's history through.
     *
     * The same moment as [syncedThrough], but Full resync never clears it:
     * this is what the stale-sync warning measures from, and a phone that has
     * just pressed Full resync has lost nothing. Falls back to [syncedThrough]
     * for an install from before this key existed.
     */
    val safeThrough: Long
        get() = maxOf(sp.getLong(KEY_SAFE_THROUGH, 0L), syncedThrough)

    /** Advance both watermarks; see [syncedThrough] and [safeThrough]. */
    fun markSyncedThrough(t: Long) {
        sp.edit()
            .putLong(KEY_THROUGH, t)
            .putLong(KEY_SAFE_THROUGH, maxOf(t, sp.getLong(KEY_SAFE_THROUGH, 0L)))
            .apply()
    }

    /**
     * How far back `queryEvents` reached at the last sync, as a span in ms.
     * It sets the stale-sync warning's limit, because it is how long unsent
     * history survives on THIS phone -- and it is not the same on every one.
     */
    var eventReachSpanMs: Long
        get() = sp.getLong(KEY_REACH, 0L)
        set(v) = sp.edit().putLong(KEY_REACH, v).apply()

    /**
     * How often the background job runs, in hours.
     *
     * The rule is the same as everywhere in this project -- collect faster
     * than EVICTION -- but the margin here is far thinner than on the network
     * side, and that is measured, not assumed:
     *
     *   daily rollups   10 daily files, so ~10 days of per-day resolution
     *   events          MEASURED at 10.0 days by this app (dumpsys showed 24h,
     *                   but that was the dump's limit). The app re-measures the
     *                   reach every sync and the Sync page shows it.
     *
     * So 6 hours is generous: a phone can be off Wi-Fi for over a week before
     * anything is lost. If the Sync page's reach ever falls toward a day, this
     * stops being true -- check it there before widening the interval.
     */
    var syncHours: Int
        get() = sp.getInt(KEY_HOURS, DEFAULT_HOURS)
        set(v) = sp.edit().putInt(KEY_HOURS, v).apply()

    /**
     * Whether the job may run on a metered connection.
     *
     * Off by default. The first sync backfills everything Android still holds,
     * which is a few MB gzipped -- not enormous, but there is no reason to
     * spend mobile data on it when the phone is on Wi-Fi every day anyway.
     */
    var allowMetered: Boolean
        get() = sp.getBoolean(KEY_METERED, false)
        set(v) = sp.edit().putBoolean(KEY_METERED, v).apply()

    var lastResult: String
        get() = sp.getString(KEY_RESULT, "") ?: ""
        set(v) = sp.edit().putString(KEY_RESULT, v).apply()

    var lastResultAt: Long
        get() = sp.getLong(KEY_RESULT_AT, 0L)
        set(v) = sp.edit().putLong(KEY_RESULT_AT, v).apply()

    val isConfigured: Boolean
        get() = serverUrl.isNotEmpty() && token.isNotEmpty()

    companion object {
        const val DEFAULT_HOURS = 6

        /** Process-wide: every Prefs instance shares one preferences file. */
        private val ID_LOCK = Any()

        /** Offered in the app. Whole hours; see syncHours. */
        val HOUR_CHOICES = intArrayOf(1, 3, 6, 12, 24)

        private const val KEY_HOURS = "sync_hours"
        private const val KEY_METERED = "allow_metered"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_URL = "server_url"
        const val KEY_TOKEN = "token"
        const val KEY_THROUGH = "synced_through"
        const val KEY_SAFE_THROUGH = "safe_through"
        const val KEY_REACH = "event_reach_span_ms"
        const val KEY_RESULT = "last_result"
        const val KEY_RESULT_AT = "last_result_at"
    }
}
