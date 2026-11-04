package com.naimul.screentime

import java.io.File
import java.security.KeyPairGenerator
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Envelopes sealed by the PHONE's code, for the LAPTOP's code to open
 * (audit TEST-001). The Node self-test only ever opened envelopes Node had
 * sealed; this writes Kotlin-sealed ones under build/sealer-golden, and
 * scripts/open-kotlin-envelopes.ts opens them with src/lib/inbox.ts. CI runs
 * both, in that order. A throwaway key and token, made fresh each run.
 */
class SealerGoldenTest {
    @Test
    fun writeEnvelopesForNodeToOpen() {
        val gen = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }
        val pair = gen.generateKeyPair()
        val spki = Base64.getEncoder().encodeToString(pair.public.encoded)
        val key = Sealer.parseKey(spki)
        assertEquals((pair.public as ECPublicKey).w, key.w)

        val token = "test-token-" + System.nanoTime()
        val out = File("build/sealer-golden").apply { deleteRecursively(); mkdirs() }
        val pem = "-----BEGIN PRIVATE KEY-----\n" +
            Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(pair.private.encoded) +
            "\n-----END PRIVATE KEY-----\n"
        File(out, "key.pem").writeText(pem)
        File(out, "token.txt").writeText(token)
        File(out, "public.txt").writeText(spki)
        File(out, "fingerprint.txt").writeText(Sealer.fingerprint(spki))
        File(out, "bearer.txt").writeText(Sealer.uploadBearer(token))

        val plains = listOf(
            ByteArray(0),
            "{\"device\":{\"deviceId\":\"golden\"}}".toByteArray(),
            ByteArray(70_000) { (it * 31 % 251).toByte() },
        )
        plains.forEachIndexed { i, p ->
            File(out, "plain-$i.bin").writeBytes(p)
            File(out, "envelope-$i.bin").writeBytes(Sealer.seal(p, key, token))
        }
    }
}
