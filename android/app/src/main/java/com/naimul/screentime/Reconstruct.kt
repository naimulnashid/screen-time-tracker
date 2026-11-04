package com.naimul.screentime

import android.annotation.SuppressLint
import android.app.usage.UsageEvents

/**
 * Sessions and screen spans rebuilt from a stream of usage events, and the
 * window the next sync reads.
 *
 * Pure functions over plain values, kept out of [UsageReader] so they run in
 * a JVM unit test (audit TEST-001): everything here that decides how much
 * time a phone reports used to be reachable only on a device. The event
 * types are `UsageEvents.Event` constants, which compile to plain ints, so
 * no Android code runs in a test.
 */
object Reconstruct {

    data class Ev(val type: Int, val pkg: String?, val time: Long)

    /** How far before the watermark a sync re-reads. */
    const val OVERLAP_MS = 60 * 60 * 1000L

    /** Furthest an open span may pull the read back: the longest span the server accepts. */
    const val MAX_OPEN_MS = 24 * 60 * 60 * 1000L

    /** How far back a first sync asks; more than Android keeps, which is harmless. */
    const val FIRST_READ_MS = 95L * 24 * 60 * 60 * 1000

    /**
     * Where the next read starts.
     *
     * An hour before the last confirmed sync, so a session that straddled it
     * is read whole. That is not enough for a span open LONGER than an hour:
     * its opening event falls before the overlap, its close is then
     * discarded as having no open, and the rest of it is never sent (audit
     * BUG-001). So the read also reaches back to the earliest span still
     * open at that sync -- at most a day, so one session left open by a
     * missed shutdown cannot pull the read back further every time.
     */
    fun readFrom(syncedThrough: Long, openSince: Long, now: Long): Long {
        if (syncedThrough <= 0) return now - FIRST_READ_MS
        val overlap = syncedThrough - OVERLAP_MS
        return if (openSince in 1 until overlap) maxOf(openSince, syncedThrough - MAX_OPEN_MS) else overlap
    }

    /**
     * Per-app foreground sessions.
     *
     * A package's session closes on PAUSED or STOPPED. DEVICE_SHUTDOWN closes
     * everything: shutdown events are NOT reliably present, so a session can
     * otherwise stay open across a power cycle and be clipped to `now` hours
     * later -- inventing screen time that looks entirely plausible.
     *
     * Below API 29 ([singleResume]) there is no DEVICE_SHUTDOWN at all. But
     * there only ONE activity can be resumed at a time, so a package coming
     * to the foreground means every other one has left it, and closing them
     * there bounds a missed close at the next app switch instead of at `now`.
     * Not applied on 29+, where split-screen apps are genuinely resumed
     * together.
     */
    fun sessions(events: List<Ev>, now: Long, singleResume: Boolean): List<UsageReader.Session> {
        val open = HashMap<String, Long>()
        val out = ArrayList<UsageReader.Session>()

        fun close(pkg: String, at: Long) {
            val start = open.remove(pkg) ?: return
            if (at > start) out.add(UsageReader.Session(pkg, start, at))
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
        // Whatever is still open is genuinely still open: count it, clipped to now.
        for ((pkg, start) in open) if (now > start) out.add(UsageReader.Session(pkg, start, now))
        return out
    }

    /**
     * Screen-on and unlocked spans.
     *
     * EMPTY below API 28, which added all four event types. Kept apart from
     * sessions and from each other because they OVERLAP: an app session
     * happens during screen-on, and unlocked time is a subset of screen-on.
     */
    @SuppressLint("InlinedApi") // intended: the constants just never match below 28
    fun screenSpans(events: List<Ev>, now: Long): List<UsageReader.ScreenSpan> {
        val out = ArrayList<UsageReader.ScreenSpan>()

        fun pair(kind: String, openType: Int, closeType: Int) {
            var openedAt: Long? = null
            for (ev in events) {
                when (ev.type) {
                    openType -> openedAt = ev.time
                    closeType -> {
                        val s = openedAt ?: continue  // close with no open: discard
                        if (ev.time > s) out.add(UsageReader.ScreenSpan(kind, s, ev.time, false))
                        openedAt = null
                    }
                }
            }
            // Still open at read time: count it, clipped, and FLAG it so the
            // server knows this is the one span a later sync may extend.
            openedAt?.let { if (now > it) out.add(UsageReader.ScreenSpan(kind, it, now, true)) }
        }

        pair("screen_on", UsageEvents.Event.SCREEN_INTERACTIVE, UsageEvents.Event.SCREEN_NON_INTERACTIVE)
        pair("unlocked", UsageEvents.Event.KEYGUARD_HIDDEN, UsageEvents.Event.KEYGUARD_SHOWN)
        return out
    }

    /** The earliest start among spans still open at `now`, or null. */
    fun openSince(sessions: List<UsageReader.Session>, screen: List<UsageReader.ScreenSpan>, now: Long): Long? =
        (sessions.filter { it.end == now }.map { it.start } + screen.filter { it.inFlight }.map { it.start }).minOrNull()
}
