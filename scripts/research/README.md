# Phase 1 research scripts

**Nothing here is needed to run the tracker.** These are the measurements that
decided how it was built, kept because `CLAUDE.md` quotes their results and
someone re-checking a claim should be able to reproduce it.

| Script | Answers | Run |
|---|---|---|
| `phase1-probe-windows.ps1` | Is SRUM's `AppTimelineProvider` populated? (Yes -- and it is not screen time.) Elevated, read-only, cleans up after itself. | Administrator PowerShell |
| `srum-recover.ps1` | Dot-sourced by the probe: replays `SRU*.log` so SrumECmd can open a dirty snapshot. A copy of the sibling project's, on purpose. | -- |
| `phase1-analyze-atp.ts` | What is `DurationMs`? Four independent tests; all say process presence, not focus. | `npm run atp` |
| `phase1-android-capture.ts` | Captures `dumpsys usagestats` from a phone over adb. | `npm run android:capture` |
| `phase1-android-analyze.ts` | Retention, the event vocabulary, and which field is really screen time. No device needed. | `npm run android:analyze` |
| `csv.ts` | The CSV reader the SRUM analysis uses. | -- |

⚠️ **The Android capture contains a record of every app opened and when.**
Its output files are gitignored (`dumpsys-*.txt`, `android-capture/`); keep it
that way if you add a new output format.
