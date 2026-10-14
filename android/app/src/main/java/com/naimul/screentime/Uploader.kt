package com.naimul.screentime

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URL
import java.time.Instant
import java.util.TimeZone
import java.util.zip.GZIPOutputStream

/**
 * Sending one reading to the dashboard, or to the cloud inbox.
 *
 * `HttpURLConnection` rather than OkHttp: see the no-dependencies note in
 * build.gradle.kts. This posts one body and reads one back.
 *
 * With the cloud inbox on (`prefs.usesInbox`), the same gzipped JSON is sealed
 * to the laptop's key (Sealer) and posted to the inbox, which stores it until
 * the laptop collects it. Nothing else about an upload changes.
 */
class Uploader(private val prefs: Prefs) {

    data class Result(val ok: Boolean, val message: String, val acceptedThrough: Long?)

    /** What the dashboard hands out for "Set up from the dashboard". */
    data class InboxSetup(val url: String, val publicKey: String, val fingerprint: String)

    /**
     * Refuse to send cleartext anywhere but the local network.
     *
     * The network security config has to allow cleartext broadly, because
     * Android matches domain names and cannot express "the private ranges" --
     * a literal address list breaks the day the PC's DHCP lease changes. So the
     * real check lives here, where CIDR arithmetic is possible.
     *
     * Not paranoia about the LAN. A typo in the server field would otherwise
     * post a minute-by-minute record of what this person looked at, in clear,
     * to whatever host happened to answer at that address. That is a more
     * sensitive disclosure than the sibling project's byte counts.
     */
    private fun assertPrivateIfCleartext(url: URL) {
        if (!url.protocol.equals("http", ignoreCase = true)) return

        val addr: InetAddress = try {
            InetAddress.getByName(url.host)
        } catch (e: Exception) {
            throw IllegalArgumentException("Cannot resolve ${url.host}")
        }
        val private = addr.isLoopbackAddress || addr.isLinkLocalAddress || addr.isSiteLocalAddress
        if (!private) {
            throw IllegalArgumentException(
                "Refusing to send screen time in clear to ${url.host}, which is not a " +
                    "private address. Use https, or check the server address.",
            )
        }
        if (addr is Inet4Address) {
            // isSiteLocalAddress already covers 10/8, 172.16/12 and 192.168/16.
            // Carrier-grade NAT (100.64/10) is NOT yours -- a phone on mobile
            // data can reach other subscribers there -- so it is excluded.
            val b = addr.address
            val first = b[0].toInt() and 0xFF
            val second = b[1].toInt() and 0xFF
            if (first == 100 && second in 64..127) {
                throw IllegalArgumentException("Refusing to send to carrier-grade NAT space")
            }
        }
    }

    private fun endpoint(): URL = URL("${prefs.serverUrl}/api/android/ingest")

    /**
     * Reachability check for the setup screen.
     *
     * A 401 here is a PASS for reachability and a FAIL for the token, and the
     * message says so: the endpoint only accepts POST, so any response at all
     * proves the address is right, which is the harder half to get correct.
     */
    fun test(): Result {
        if (prefs.usesInbox) return testInbox()
        val url = endpoint()
        assertPrivateIfCleartext(url)
        val conn = open(url, "POST")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        return try {
            conn.outputStream.use { it.write("{}".toByteArray()) }
            when (val code = conn.responseCode) {
                // {} has no device, so a reachable and authorised server
                // rejects it at validation with a clean 400 -- which is the
                // answer we want, and which writes nothing to the run history.
                400 -> Result(true, "Reachable, token accepted", null)
                401 -> Result(false, "Reached the server, but the token was rejected", null)
                503 -> Result(false, "Server has no ANDROID_INGEST_TOKEN set", null)
                else -> Result(code == 200, "HTTP $code: ${readBody(conn)}", null)
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun testInbox(): Result {
        val conn = open(URL(prefs.inboxUrl), "GET", Sealer.uploadBearer(prefs.token))
        return try {
            val code = conn.responseCode
            val body = readBody(conn)
            val isInbox = code == 200 && try {
                JSONObject(body).optBoolean("inbox")
            } catch (e: Exception) {
                false
            }
            Result(isInbox, if (isInbox) "Cloud inbox reachable" else "Cloud inbox: HTTP $code: $body", null)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Ask the dashboard, over the LAN, where its cloud inbox is and which key
     * to seal to. Fetched from the dashboard rather than typed in or taken
     * from the inbox: the inbox is exactly the party that must not be able to
     * substitute its own key.
     */
    fun fetchInboxSetup(): InboxSetup {
        val url = endpoint()
        assertPrivateIfCleartext(url)
        val conn = open(url, "GET")
        try {
            val code = conn.responseCode
            val body = readBody(conn)
            if (code == 401) throw IllegalStateException("The dashboard rejected the token")
            if (code != 200) throw IllegalStateException("Dashboard: HTTP $code: $body")
            val inbox = JSONObject(body).optJSONObject("inbox")
                ?: throw IllegalStateException(
                    "The dashboard has no cloud inbox set up, or is older than 1.5.0",
                )
            inbox.optString("error").takeIf { it.isNotEmpty() }?.let {
                throw IllegalStateException("The dashboard's inbox is misconfigured: $it")
            }
            val setup = InboxSetup(
                inbox.getString("url"), inbox.getString("publicKey"), inbox.getString("fingerprint"),
            )
            // The inbox is on the internet, so cleartext is never acceptable.
            if (!setup.url.startsWith("https://")) {
                throw IllegalStateException("Refusing an inbox address that is not https: ${setup.url}")
            }
            Sealer.parseKey(setup.publicKey) // throws on anything but a P-256 key
            return setup
        } finally {
            conn.disconnect()
        }
    }

    fun upload(reading: UsageReader.Reading, coverageEnd: Long): Result {
        if (prefs.usesInbox) return uploadToInbox(reading, coverageEnd)
        val url = endpoint()
        assertPrivateIfCleartext(url)

        val body = buildPayload(reading, coverageEnd).toString().toByteArray(Charsets.UTF_8)
        val conn = open(url, "POST")
        conn.setRequestProperty("Content-Type", "application/json")
        // Ten days of sessions is a few MB of very repetitive JSON; gzip takes
        // it to a fraction of that over Wi-Fi that may be the phone's own
        // hotspot.
        conn.setRequestProperty("Content-Encoding", "gzip")
        conn.doOutput = true

        return try {
            GZIPOutputStream(BufferedOutputStream(conn.outputStream)).use { it.write(body) }
            val code = conn.responseCode
            val text = readBody(conn)
            if (code != 200) return Result(false, "HTTP $code: $text", null)

            val json = JSONObject(text)
            if (!json.optBoolean("ok")) {
                return Result(false, json.optString("error", "rejected"), null)
            }
            Result(
                ok = true,
                message = "${json.optInt("sessionSegments")} session, " +
                    "${json.optInt("screenSegments")} screen segments" +
                    (json.optInt("rejected").takeIf { it > 0 }?.let { ", $it rejected" } ?: ""),
                acceptedThrough = parseIso(json.optString("acceptedThrough", "")),
            )
        } finally {
            conn.disconnect()
        }
    }

    private fun uploadToInbox(reading: UsageReader.Reading, coverageEnd: Long): Result {
        val json = buildPayload(reading, coverageEnd).toString().toByteArray(Charsets.UTF_8)
        val zipped = ByteArrayOutputStream().also { out ->
            GZIPOutputStream(out).use { it.write(json) }
        }.toByteArray()
        val envelope = Sealer.seal(zipped, Sealer.parseKey(prefs.inboxKey), prefs.token)

        val conn = open(URL(prefs.inboxUrl), "POST", Sealer.uploadBearer(prefs.token))
        conn.setRequestProperty("Content-Type", "application/octet-stream")
        // Lets the dashboard say which phone an envelope it cannot open came from.
        conn.setRequestProperty("X-Device-Hint", prefs.deviceId)
        conn.doOutput = true
        conn.setFixedLengthStreamingMode(envelope.size)

        return try {
            conn.outputStream.use { it.write(envelope) }
            val code = conn.responseCode
            val text = readBody(conn)
            if (code != 200) return Result(false, "Cloud inbox: HTTP $code: $text", null)
            val reply = JSONObject(text)
            if (!reply.optBoolean("ok") || !reply.optBoolean("inbox")) {
                return Result(false, reply.optString("error", "rejected by the cloud inbox"), null)
            }
            /*
              The inbox cannot read what it stored, so it cannot echo
              coverageEndMs back as the dashboard does; the phone stands in
              with the same value. The inbox answers 200 only once the
              envelope is stored. If the laptop later rejects it, the Sync page
              says so and Full resync sends the window again.
            */
            Result(
                ok = true,
                message = "Sent ${reading.sessions.size} sessions to the cloud inbox",
                acceptedThrough = coverageEnd,
            )
        } finally {
            conn.disconnect()
        }
    }

    private fun open(url: URL, method: String, bearer: String = prefs.token): HttpURLConnection {
        val conn = url.openConnection() as HttpURLConnection
        // Never follow a redirect: it would carry the bearer token to an
        // address nobody vetted. Neither the dashboard nor the inbox redirects.
        conn.instanceFollowRedirects = false
        conn.requestMethod = method
        conn.setRequestProperty("Authorization", "Bearer $bearer")
        conn.setRequestProperty("Accept", "application/json")
        conn.connectTimeout = 10_000
        conn.readTimeout = 60_000
        return conn
    }

    private fun readBody(conn: HttpURLConnection): String =
        try {
            (if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
        } catch (e: Exception) {
            e.message ?: "no response"
        }

    private fun buildPayload(reading: UsageReader.Reading, coverageEnd: Long): JSONObject {
        val now = System.currentTimeMillis()
        val label = "${Build.MANUFACTURER} ${Build.MODEL}"

        return JSONObject().apply {
            put("device", JSONObject().apply {
                put("deviceId", prefs.deviceId)
                put("label", label)
                put("brand", Build.MANUFACTURER)
                put("model", Build.MODEL)
                put("androidRelease", Build.VERSION.RELEASE)
                put("sdkInt", Build.VERSION.SDK_INT)
                put("appVersion", BuildConfig.VERSION_NAME)
                // How far queryEvents actually reaches, measured on device.
                // Phase 1 could not answer this: dumpsys shows 24h, but that
                // is the dump's limit, not the API's.
                put("eventsReachUtc", reading.eventReachMs?.let { Instant.ofEpochMilli(it).toString() })
            })

            // The PHONE's offset, so the server buckets days the way this
            // device experiences them rather than the way the server does.
            put("tzOffsetMinutes", TimeZone.getDefault().getOffset(now) / 60_000)

            // What this payload covers. The server echoes it back as
            // acceptedThrough only if the whole transaction committed, and the
            // watermark advances from THAT rather than from what was sent.
            put("coverageEndMs", coverageEnd)

            put("sessions", JSONArray().also { arr ->
                for (s in reading.sessions) {
                    arr.put(
                        JSONObject()
                            .put("packageName", s.packageName)
                            .put("start", s.start)
                            .put("end", s.end),
                    )
                }
            })

            put("screen", JSONArray().also { arr ->
                for (s in reading.screen) {
                    arr.put(
                        JSONObject()
                            .put("kind", s.kind)
                            .put("start", s.start)
                            .put("end", s.end)
                            .put("inFlight", s.inFlight),
                    )
                }
            })

            put("apps", JSONArray().also { arr ->
                for (a in reading.apps) {
                    arr.put(
                        JSONObject()
                            // "packageName", not "package" -- the server keys
                            // on the former, and a mismatch here rejected all
                            // 414 labels silently apart from the rejected
                            // counter, which is precisely why it exists.
                            .put("packageName", a.packageName)
                            .put("label", a.label)
                            .put("isSystem", a.isSystem),
                    )
                }
            })
        }
    }

    private fun parseIso(s: String): Long? =
        if (s.isEmpty()) null
        else try {
            Instant.parse(s).toEpochMilli()
        } catch (e: Exception) {
            null
        }
}
