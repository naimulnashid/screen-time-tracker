package com.naimul.screentime

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The whole UI: where to send, what to send with, and whether it is working.
 *
 * Built in code rather than XML, and on the framework theme rather than
 * AppCompat or Material, because the app has no dependencies at all -- see the
 * note in build.gradle.kts. One screen with five controls does not justify
 * bringing a UI toolkit along.
 */
class MainActivity : Activity() {

    private lateinit var prefs: Prefs
    private lateinit var urlField: EditText
    private lateinit var tokenField: EditText
    private lateinit var status: TextView
    private lateinit var intervalGroup: RadioGroup
    private lateinit var meteredBox: CheckBox

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)

        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        root.addView(heading("Screen Time Reporter"))
        root.addView(
            body(
                "Reads Android's own screen time history and posts it to the " +
                    "dashboard on your PC. Nothing leaves your network, and nothing " +
                    "is stored on the phone.",
            ),
        )

        // Each label is bound to its field with labelFor, so TalkBack reads
        // "Dashboard address, edit box" rather than the hint text alone, which
        // disappears the moment the field has a value.
        val urlLabel = label("Dashboard address")
        root.addView(urlLabel)
        urlField = EditText(this).apply {
            id = View.generateViewId()
            hint = "http://192.168.x.y:7844"
            setText(prefs.serverUrl)
            // The CLASS is required: a variation on its own is not a valid
            // input type, and the keyboard never got its URL layout.
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
        }
        urlLabel.labelFor = urlField.id
        root.addView(urlField)

        val tokenLabel = label("Ingest token")
        root.addView(tokenLabel)
        tokenField = EditText(this).apply {
            id = View.generateViewId()
            hint = "ANDROID_INGEST_TOKEN from .env.local"
            setText(prefs.token)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
        }
        tokenLabel.labelFor = tokenField.id
        root.addView(tokenField)

        root.addView(button("Save and test connection") { saveAndTest() })
        root.addView(button("Grant usage access") {
            // Cannot be granted by a runtime prompt; it is a Settings toggle.
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        })
        root.addView(button("Sync now") { syncNow() })
        root.addView(button("Full resync (re-send everything)") { fullResync() })

        /*
          Background sync settings.

          Worth being clear about what these can and cannot do. Android decides
          when a periodic job actually runs -- it batches them, and App Standby
          throttles apps you rarely open -- so the interval is a REQUEST, not a
          promise. refreshStatus reads back what the system accepted rather
          than echoing what was asked for.
        */
        root.addView(label("Background sync"))
        root.addView(
            body(
                "How often to try. Android batches and throttles background work, " +
                    "so treat this as a request rather than a schedule.",
            ),
        )

        intervalGroup = RadioGroup(this).apply {
            orientation = LinearLayout.HORIZONTAL
            for (h in Prefs.HOUR_CHOICES) {
                addView(
                    RadioButton(this@MainActivity).apply {
                        id = 1000 + h
                        text = if (h == 24) "24h" else "${h}h"
                        setTextColor(Color.LTGRAY)
                    },
                )
            }
            check(1000 + prefs.syncHours)
            setOnCheckedChangeListener { _, id ->
                prefs.syncHours = id - 1000
                // Re-registering with the same job id replaces the old one,
                // which is what makes a change take effect at all.
                SyncJobService.schedule(this@MainActivity)
                refreshStatus()
            }
        }
        root.addView(intervalGroup)

        meteredBox = CheckBox(this).apply {
            text = "Also sync on mobile data"
            setTextColor(Color.LTGRAY)
            isChecked = prefs.allowMetered
            setOnCheckedChangeListener { _, checked ->
                prefs.allowMetered = checked
                SyncJobService.schedule(this@MainActivity)
                refreshStatus()
                if (checked) {
                    toast("A first sync backfills everything Android holds.")
                }
            }
        }
        root.addView(meteredBox)
        root.addView(
            body(
                "Off by default. There is no need to spend mobile data on this when " +
                    "the phone is on Wi-Fi every day; unlike the sibling app, though, the " +
                    "margin here is thin. Daily detail survives about ten days.",
            ),
        )

        status = body("").apply { setPadding(0, pad, 0, 0) }
        root.addView(status)

        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun save() {
        prefs.serverUrl = urlField.text.toString()
        prefs.token = tokenField.text.toString()
        if (prefs.isConfigured) SyncJobService.schedule(this)
    }

    private fun saveAndTest() {
        save()
        if (!prefs.isConfigured) {
            toast("Enter the address and the token first")
            return
        }
        Thread {
            val result = try {
                Uploader(prefs).test()
            } catch (e: Exception) {
                Uploader.Result(false, e.message ?: "failed", null)
            }
            runOnUiThread {
                toast(if (result.ok) "Connected" else result.message)
                refreshStatus()
            }
        }.start()
    }

    private fun syncNow() {
        save()
        toast("Syncing...")
        Thread {
            val outcome = SyncRunner(applicationContext).runOnce()
            runOnUiThread {
                toast(outcome.message)
                refreshStatus()
            }
        }.start()
    }

    /**
     * Forget the watermark and re-send every bucket Android still holds.
     *
     * Needed whenever the SERVER's copy is not what the phone assumes: the
     * database restored from backup, rows deleted, or a bug fixed in how
     * sessions are reconstructed, where corrected figures only reach the server
     * if the history is sent again. The server's MAX() upsert makes this safe
     * to press at any time: nothing is duplicated, and a corrected larger value
     * replaces a smaller one.
     *
     * It cannot recover what Android has already evicted, which for per-day
     * detail is about ten days.
     */
    private fun fullResync() {
        prefs.syncedThrough = 0
        toast("Watermark cleared, re-sending everything")
        syncNow()
    }

    private fun refreshStatus() {
        val granted = SyncRunner.hasUsageAccess(this)
        val scheduled = SyncJobService.isScheduled(this)
        val through = prefs.syncedThrough
        val fmt = SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault())

        status.text = buildString {
            append(if (granted) "Usage access: granted\n" else "Usage access: NOT GRANTED\n")
            if (scheduled) {
                // What the SYSTEM accepted, not what was asked for. Android
                // clamps a periodic job's interval by its own flex rules and by
                // whatever App Standby bucket the app is in, so the two often
                // differ and only the accepted one is true.
                val actual = SyncJobService.scheduledIntervalMs(this@MainActivity)
                val hrs = actual?.let { it / 3_600_000.0 }
                append("Background sync: every ")
                append(
                    if (hrs != null) String.format(Locale.getDefault(), "%.1fh", hrs)
                    else "${prefs.syncHours}h",
                )
                if (hrs != null && kotlin.math.abs(hrs - prefs.syncHours) > 0.1) {
                    append(" (asked for ${prefs.syncHours}h; Android chose this)")
                }
                append(if (prefs.allowMetered) ", any network\n" else ", unmetered only\n")
            } else {
                append("Background sync: not scheduled\n")
            }
            append(
                if (through > 0) "Synced through: ${fmt.format(Date(through))}\n"
                else "Synced through: nothing yet\n",
            )
            // The measured event reach rides along in lastResult; see
            // SyncRunner. It is the one number Phase 1 could not determine, and
            // it decides whether this cadence is generous or tight.
            if (prefs.lastResult.isNotEmpty()) {
                append("\nLast run ")
                append(fmt.format(Date(prefs.lastResultAt)))
                append("\n")
                append(prefs.lastResult)
            }
        }
        status.setTextColor(if (granted) Color.LTGRAY else Color.parseColor("#ff8a80"))
    }

    /* ------------------------------------------------------------ views */

    private fun heading(text: String) = TextView(this).apply {
        this.text = text
        // Announced as a heading, so TalkBack's heading navigation finds it.
        isAccessibilityHeading = true
        textSize = 22f
        setTextColor(Color.WHITE)
        setPadding(0, 0, 0, 8)
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(Color.LTGRAY)
        setPadding(0, 24, 0, 4)
    }

    private fun body(text: String) = TextView(this).apply {
        this.text = text
        textSize = 14f
        setTextColor(Color.LTGRAY)
    }

    private fun button(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
            topMargin = 24
        }
        setOnClickListener { onClick() }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }
}
