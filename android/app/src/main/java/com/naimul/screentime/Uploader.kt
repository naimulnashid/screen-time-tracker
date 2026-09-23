package com.naimul.screentime

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URL
import java.time.Instant
import java.util.TimeZone
import java.util.zip.GZIPOutputStream

/**
 * Sending one reading to the dashboard.
 *
 * `HttpURLConnection` rather than OkHttp: see the no-dependencies note in
 * build.gradle.kts. This posts one JSON body and reads one back.
 */
class Uploader(private val prefs: Prefs) {

    data class Result(val ok: Boolean, val message: String, val acceptedThrough: Long?)

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

    fun upload(reading: UsageReader.Reading, coverageEnd: Long): Result {
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

    private fun open(url: URL, method: String): HttpURLConnection {
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.setRequestProperty("Authorization", "Bearer ${prefs.token}")
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
