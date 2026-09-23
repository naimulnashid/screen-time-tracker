/**
 * CLI for the Windows ingest. The logic lives in `src/lib/windows-ingest.ts`,
 * because the Sync now button calls it too, through `POST /api/ingest`.
 *
 *   npm run ingest
 *   npm run ingest -- --keep      leave the JSONL in place after ingest
 *
 * This file is what the hourly "Screen Time Ingest" scheduled task runs. Its
 * whole job is to turn the result object into something readable in a console
 * window nobody is watching, and to set an exit code that Task Scheduler will
 * record in LastTaskResult.
 */

import { pathToFileURL } from 'node:url';
import { ingestWindows } from '../src/lib/windows-ingest';

const HOUR_MS = 3_600_000;

async function main(): Promise<void> {
  const r = await ingestWindows({ keep: process.argv.includes('--keep') });

  if (r.note) {
    console.log(`${r.note} -- nothing to ingest.`);
    console.log('Start the sampler with: npm run sample');
    return;
  }

  console.log(`files      : ${r.files}`);
  console.log(`spans read : ${r.read}`);
  console.log(`segments   : ${r.inserted} inserted, ${r.skipped} already present`);
  if (r.malformed) console.log(`malformed  : ${r.malformed} line(s) skipped`);
  console.log(`range      : ${r.oldest ?? '-'}  ->  ${r.newest ?? '-'}`);
  if (r.removed) console.log(`pruned     : ${r.removed} completed day file(s)`);
  console.log('');
  console.log('stored by kind:');
  for (const t of r.totals) {
    console.log(`  ${t.kind.padEnd(9)} ${String(t.n).padStart(7)} segments  ${(t.ms / HOUR_MS).toFixed(2).padStart(9)} h`);
  }
}

// Only run when invoked directly, so an import cannot kick off a real ingest
// as a side effect.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
