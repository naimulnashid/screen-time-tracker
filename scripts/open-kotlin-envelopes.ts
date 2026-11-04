/**
 * Open the envelopes the phone's Sealer.kt wrote, with the laptop's code.
 *
 *   cd android && ./gradlew testDebugUnitTest
 *   npx tsx scripts/open-kotlin-envelopes.ts [android/app/build/sealer-golden]
 *
 * Audit TEST-001. The self-test round-trips envelopes Node sealed itself,
 * which cannot catch the two implementations drifting apart; this is the
 * cross-language check, run in CI after the Android unit tests. The key and
 * token are throwaway, made by SealerGoldenTest.kt for this run.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { openEnvelope, publicKeyB64, fingerprint, uploadBearer } from '../src/lib/inbox';

const dir = process.argv[2] ?? join('android', 'app', 'build', 'sealer-golden');
if (!existsSync(join(dir, 'key.pem'))) {
  console.error(`no envelopes in ${dir}: run the Android unit tests first`);
  process.exit(1);
}

const read = (f: string) => readFileSync(join(dir, f), 'utf8').trim();
const key = createPrivateKey(read('key.pem'));
const token = read('token.txt');
let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failed++;
};

check('the public key matches', publicKeyB64(key) === read('public.txt'));
check('the fingerprint matches', fingerprint(read('public.txt')) === read('fingerprint.txt'));
check('the upload bearer matches', uploadBearer(token) === read('bearer.txt'));

const envelopes = readdirSync(dir).filter((f) => /^envelope-\d+\.bin$/.test(f)).sort();
check('there are envelopes', envelopes.length > 0);
for (const f of envelopes) {
  const n = f.match(/\d+/)![0];
  const plain = readFileSync(join(dir, `plain-${n}.bin`));
  let opened: Buffer | null = null;
  try { opened = openEnvelope(readFileSync(join(dir, f)), key, token); } catch { opened = null; }
  check(`${f} (${plain.length} bytes) opens to its plaintext`, opened !== null && opened.equals(plain));
  let forged = false;
  try { openEnvelope(readFileSync(join(dir, f)), key, token + 'x'); forged = true; } catch { /* refused */ }
  check(`${f} is refused under another token`, !forged);
}

console.log(failed ? `${failed} failed` : 'Kotlin-sealed envelopes open in Node');
process.exitCode = failed ? 1 : 0;
