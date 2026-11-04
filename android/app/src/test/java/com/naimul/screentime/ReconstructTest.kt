package com.naimul.screentime

import android.app.usage.UsageEvents.Event
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The phone's reconstruction, run on the JVM (audit TEST-001). Synthetic
 * events only; nothing here comes from a real phone.
 */
class ReconstructTest {
    private val h = 60 * 60 * 1000L
    private val t0 = 1_800_000_000_000L
    private fun at(hours: Double) = t0 + (hours * h).toLong()
    private fun ev(type: Int, hours: Double, pkg: String? = null) = Reconstruct.Ev(type, pkg, at(hours))

    /** Android hands back events at or after `from`, in order. */
    private fun window(all: List<Reconstruct.Ev>, from: Long, to: Long) = all.filter { it.time in from..to }

    @Test
    fun aSessionLongerThanTheOverlapArrivesWhole() {
        // BUG-001: open at 08:00, sync at 10:00, close at 11:00, sync at 12:00.
        val all = listOf(
            ev(Event.SCREEN_INTERACTIVE, 8.0),
            ev(Event.ACTIVITY_RESUMED, 8.0, "com.example.reader"),
            ev(Event.ACTIVITY_PAUSED, 11.0, "com.example.reader"),
            ev(Event.SCREEN_NON_INTERACTIVE, 11.0),
        )
        val first = window(all, at(0.0), at(10.0))
        val s1 = Reconstruct.sessions(first, at(10.0), singleResume = false)
        val sc1 = Reconstruct.screenSpans(first, at(10.0))
        val open = Reconstruct.openSince(s1, sc1, at(10.0))
        assertEquals(at(8.0), open)

        val from = Reconstruct.readFrom(syncedThrough = at(10.0), openSince = open!!, now = at(12.0))
        assertEquals(at(8.0), from)
        val second = window(all, from, at(12.0))
        assertEquals(
            listOf(UsageReader.Session("com.example.reader", at(8.0), at(11.0))),
            Reconstruct.sessions(second, at(12.0), singleResume = false),
        )
        assertEquals(
            listOf(UsageReader.ScreenSpan("screen_on", at(8.0), at(11.0), false)),
            Reconstruct.screenSpans(second, at(12.0)),
        )

        // The old read, one hour back, saw only the close and sent nothing.
        val old = window(all, at(9.0), at(12.0))
        assertEquals(emptyList<UsageReader.Session>(), Reconstruct.sessions(old, at(12.0), singleResume = false))
    }

    @Test
    fun theReadWindow() {
        val now = at(30.0)
        assertEquals(now - Reconstruct.FIRST_READ_MS, Reconstruct.readFrom(0, 0, now))
        // Nothing open: the hour's overlap.
        assertEquals(at(9.0), Reconstruct.readFrom(at(10.0), 0, now))
        // Open inside the overlap: the overlap already covers it.
        assertEquals(at(9.0), Reconstruct.readFrom(at(10.0), at(9.5), now))
        // Open for days after a missed shutdown: at most a day back.
        assertEquals(at(10.0) - Reconstruct.MAX_OPEN_MS, Reconstruct.readFrom(at(10.0), at(-50.0), now))
    }

    @Test
    fun inFlightIsCountedAndAnUnmatchedCloseIsNot() {
        val events = listOf(
            ev(Event.SCREEN_NON_INTERACTIVE, 1.0), // began before the window
            ev(Event.SCREEN_INTERACTIVE, 2.0),
            ev(Event.KEYGUARD_HIDDEN, 2.1),
        )
        val spans = Reconstruct.screenSpans(events, at(3.0))
        assertEquals(
            listOf(
                UsageReader.ScreenSpan("screen_on", at(2.0), at(3.0), true),
                UsageReader.ScreenSpan("unlocked", at(2.1), at(3.0), true),
            ),
            spans,
        )
        assertEquals(at(2.0), Reconstruct.openSince(emptyList(), spans, at(3.0)))
        assertNull(Reconstruct.openSince(emptyList(), emptyList(), at(3.0)))
    }

    @Test
    fun shutdownClosesEverything() {
        val events = listOf(
            ev(Event.ACTIVITY_RESUMED, 1.0, "a"),
            ev(Event.ACTIVITY_RESUMED, 1.5, "b"),
            ev(Event.DEVICE_SHUTDOWN, 2.0),
        )
        assertEquals(
            setOf(UsageReader.Session("a", at(1.0), at(2.0)), UsageReader.Session("b", at(1.5), at(2.0))),
            Reconstruct.sessions(events, at(5.0), singleResume = false).toSet(),
        )
    }

    @Test
    fun belowAndroid10OneAppResumedClosesTheOthers() {
        val events = listOf(
            ev(Event.ACTIVITY_RESUMED, 1.0, "a"),
            ev(Event.ACTIVITY_RESUMED, 2.0, "b"),
        )
        // Split screen on 29+: both genuinely open until now.
        assertEquals(
            setOf(UsageReader.Session("a", at(1.0), at(3.0)), UsageReader.Session("b", at(2.0), at(3.0))),
            Reconstruct.sessions(events, at(3.0), singleResume = false).toSet(),
        )
        // Below 29 "a" left the foreground when "b" arrived.
        assertEquals(
            setOf(UsageReader.Session("a", at(1.0), at(2.0)), UsageReader.Session("b", at(2.0), at(3.0))),
            Reconstruct.sessions(events, at(3.0), singleResume = true).toSet(),
        )
    }
}
