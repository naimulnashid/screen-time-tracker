package com.naimul.screentime

import android.annotation.SuppressLint
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build

/**
 * Reading screen time out of Android.
 *
 * ONE source: events. A second source was tried and removed -- see note 2.
 * Everything here was measured against this exact device (Nothing A001,
 * Android 16 / API 36) and reconciled with Digital Wellbeing's own figure.
 *
 * ## 1. EVENTS are the truth, and the only source of screen-on time
 *
 * `queryEvents` gives ACTIVITY_RESUMED / PAUSED / STOPPED, plus
 * SCREEN_INTERACTIVE / SCREEN_NON_INTERACTIVE and KEYGUARD_SHOWN / HIDDEN.
 * Digital Wellbeing derives its number from these, which is why apps that use
 * `totalTimeInForeground` instead disagree with it.
 *
 * The screen-on spans matter more than they look: measured, per-app session
 * time UNDERSHOOTS screen-on at 0.76x, because the lock screen, the launcher
 * and system surfaces hold time no app claims. A headline built by summing
 * apps under-reports, so screen-on has to be measured separately and sent
 * separately.
 *
 * ## 2. THE DAILY ROLLUP API WAS TRIED AND REMOVED
 *
 * `queryAndAggregateUsageStats` looked like the way to reach further back than
 * events. It is not usable, and it fails SILENTLY in the flattering direction.
 * Measured 2026-08-31 against a real 96-day pull: 88 of 96 days reported more
 * than 24 HOURS of foreground time in a single day, peaking at 478h.
 *
 * Two defects, both in the API rather than in the parsing:
 *
 *   1. Outside daily-file retention it falls back to the enclosing
 *      weekly/monthly/yearly bucket and returns that whole bucket's totals for
 *      EVERY day inside it -- 29 consecutive days each reporting an identical
 *      236.65h.
 *   2. Even inside retention it includes any bucket that OVERLAPS the range,
 *      in full rather than clipped. 2026-08-30 reported 16.29h against 8.40h
 *      of measured screen-on: 1.94x, where the true ratio is 0.94x.
 *
 * It bought nothing anyway. Its whole justification was reaching further back
 * than events, and [measureEventReach] measured events at 10.0 days -- the
 * same ~10 days of daily files. Event-derived rows over the same pull had 0 of
 * 11 days exceeding 24h.
 *
 * Do not reintroduce it without re-measuring against a day of known
 * screen-on.
 *
 * ## 3. THE IN-FLIGHT SPAN COUNTS
 *
 * Whatever is open when the sync runs has no closing event yet. Discarding it
 * made "today" read a quarter below Digital Wellbeing's. The two ends of
 * the stream are NOT symmetrical:
 *
 *   - a CLOSE with no matching open began before the window: discard it, its
 *     start is unknown;
 *   - an OPEN with no matching close is still running: COUNT it, clipped to
 *     now, because its start is known and the time is real.
 *
 * The server upserts on MAX(duration), so the same span arriving longer next
 * sync replaces rather than duplicates.
 *
 * ## 4. THE OPEN QUESTION THIS ANSWERS
 *
 * Phase 1 could only see 24h of events through `dumpsys`, but that is a
 * property of the DUMP -- it prints a "last 24 hour events" section -- not of
 * the API. Nobody has measured how far `queryEvents` actually reaches. So
 * [measureEventReach] asks for a year and reports the oldest event returned.
 * That figure decides whether events can be the primary store or only a
 * high-fidelity recent layer, and it is sent with every sync.
 */
class UsageReader(private val context: Context) {

    private val usm: UsageStatsManager
        get() = context.getSystemService(UsageStatsManager::class.java)

    /** One uninterrupted foreground stretch of a single package. */
    data class Session(val packageName: String, val start: Long, val end: Long)

    /** A screen-on or unlocked stretch. `inFlight` was still open when read. */
    data class ScreenSpan(val kind: String, val start: Long, val end: Long, val inFlight: Boolean)

    data class AppInfo(val packageName: String, val label: String, val isSystem: Boolean)

    data class Reading(
        val sessions: List<Session>,
        val screen: List<ScreenSpan>,
        val apps: List<AppInfo>,
        /** Oldest event the API would return, or null when it returned none. */
        val eventReachMs: Long?,
    )

    class UsageAccessDenied : Exception("Usage access has not been granted")

    /* ------------------------------------------------------------------ */

    fun read(from: Long, now: Long = System.currentTimeMillis()): Reading {
        val events = collectEvents(from, now)
        return Reading(
            sessions = buildSessions(events, now),
            screen = buildScreenSpans(events, now),
            apps = apps(),
            eventReachMs = measureEventReach(now),
        )
    }

    /* ------------------------------------------------------------------ */
    /* Events                                                              */
    /* ------------------------------------------------------------------ */

    private data class Ev(val type: Int, val pkg: String?, val time: Long)

    private fun collectEvents(from: Long, to: Long): List<Ev> {
        val out = ArrayList<Ev>()
        val events = try {
            usm.queryEvents(from, to)
        } catch (e: SecurityException) {
            throw UsageAccessDenied()
        }
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            out.add(Ev(e.eventType, e.packageName, e.timeStamp))
        }
        // The API returns events in order, but sorting costs nothing and the
        // reconstruction below is only correct on an ordered stream.
        out.sortBy { it.time }
        return out
    }

    /**
     * Per-app foreground sessions.
     *
     * A package's session closes on PAUSED or STOPPED. DEVICE_SHUTDOWN closes
     * everything: measured on this device, shutdown events are NOT reliably
     * present, so a session can otherwise stay open across a power cycle and
     * be clipped to `now` hours later -- inventing screen time that looks
     * entirely plausible.
     *
     * Below API 29 there is no DEVICE_SHUTDOWN at all, so that guard is gone
     * too. But below 29 only ONE activity can be resumed at a time -- multi-
     * resume arrived with 29 -- so a package coming to the foreground means
     * every other one has left it, and closing them there bounds a missed
     * close at the next app switch instead of at `now`. Not applied on 29+,
     * where split-screen apps are genuinely resumed together.
     */
    private fun buildSessions(events: List<Ev>, now: Long): List<Session> {
        val open = HashMap<String, Long>()
        val out = ArrayList<Session>()
        val singleResume = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

        fun close(pkg: String, at: Long) {
            val start = open.remove(pkg) ?: return
            if (at > start) out.add(Session(pkg, start, at))
        }

        for (ev in events) {
            when (ev.type) {
                // MOVE_TO_FOREGROUND below 29: the same constant, renamed.
                UsageEvents.Event.ACTIVITY_RESUMED -> ev.pkg?.let { pkg ->
                    if (singleResume) for (other in open.keys.toList()) if (other != pkg) close(other, ev.time)
                    open[pkg] = ev.time
                }
                UsageEvents.Event.ACTIVITY_PAUSED,
                UsageEvents.Event.ACTIVITY_STOPPED -> ev.pkg?.let { close(it, ev.time) }
                UsageEvents.Event.DEVICE_SHUTDOWN ->
                    for (pkg in open.keys.toList()) close(pkg, ev.time)
            }
        }
        // Whatever is still open is genuinely still open. See note 3.
        for ((pkg, start) in open) if (now > start) out.add(Session(pkg, start, now))
        return out
    }

    /**
     * Screen-on and unlocked spans.
     *
     * EMPTY below API 28, which added all four event types. That is a fact
     * about the phone, not a failure; the dashboard reads the device's
     * sdkInt and takes its headline from app time instead.
     *
     * Kept apart from sessions and from each other because they OVERLAP: an app
     * session happens during screen-on, and unlocked time is a subset of
     * screen-on time (measured at 0.96x of it). Summing across them counts
     * the same minutes twice, which is why the server stores them in their own
     * table with a kind column that every query must filter.
     */
    @SuppressLint("InlinedApi") // intended: the constants just never match below 28
    private fun buildScreenSpans(events: List<Ev>, now: Long): List<ScreenSpan> {
        val out = ArrayList<ScreenSpan>()

        fun pair(kind: String, openType: Int, closeType: Int) {
            var openedAt: Long? = null
            for (ev in events) {
                when (ev.type) {
                    openType -> openedAt = ev.time
                    closeType -> {
                        val s = openedAt ?: continue  // close with no open: discard
                        if (ev.time > s) out.add(ScreenSpan(kind, s, ev.time, false))
                        openedAt = null
                    }
                }
            }
            // Still open at read time: count it, clipped, and FLAG it so the
            // server knows this is the one span a later sync may extend.
            openedAt?.let { if (now > it) out.add(ScreenSpan(kind, it, now, true)) }
        }

        pair("screen_on", UsageEvents.Event.SCREEN_INTERACTIVE, UsageEvents.Event.SCREEN_NON_INTERACTIVE)
        pair("unlocked", UsageEvents.Event.KEYGUARD_HIDDEN, UsageEvents.Event.KEYGUARD_SHOWN)
        return out
    }

    /*
      NOTE: launch counts are NOT read here.

      UsageStats has no getAppLaunchCount() -- verified against
      android-37.0/android.jar rather than assumed, because it is exactly the
      kind of method that feels like it should exist. With the daily rollup
      gone there is nowhere else to get it, and nowhere else is needed: the
      server already stores session_start_utc per segment, so "opens" is
      COUNT(DISTINCT session_start_utc) and costs nothing to send.
    */

    /* ------------------------------------------------------------------ */
    /* The open question                                                   */
    /* ------------------------------------------------------------------ */

    /**
     * How far back `queryEvents` actually reaches, measured on the device.
     *
     * Phase 1 saw only 24h through `dumpsys`, which prints a "last 24 hour
     * events" section -- a property of the dump, not the API. This asks for a
     * year and reports the oldest event that comes back.
     *
     * Cheap enough to run every sync: it walks the stream but keeps nothing,
     * and the answer can change (a factory reset, a retention setting) so a
     * one-off measurement would go stale.
     */
    private fun measureEventReach(now: Long): Long? {
        val events = try {
            usm.queryEvents(now - 365L * 24 * 60 * 60 * 1000, now)
        } catch (e: SecurityException) {
            throw UsageAccessDenied()
        }
        val e = UsageEvents.Event()
        var oldest: Long? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            val t = e.timeStamp
            if (t > 0 && (oldest == null || t < oldest!!)) oldest = t
        }
        return oldest
    }

    /* ------------------------------------------------------------------ */

    /**
     * package -> label, for every installed package.
     *
     * The phone is the only thing that can answer this, which is why the
     * Android half needs no curated name table at all -- unlike the Windows
     * side, where `app-name.ts` has to turn exe paths into something a person
     * recognises.
     */
    fun apps(): List<AppInfo> {
        val pm = context.packageManager
        return pm.getInstalledApplications(PackageManager.GET_META_DATA).map { info ->
            AppInfo(
                packageName = info.packageName,
                label = pm.getApplicationLabel(info).toString(),
                isSystem = (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0,
            )
        }
    }
}
