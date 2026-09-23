import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import {
  getAndroidDeviceBySlug, getAndroidSyncInfo, getAndroidOverview,
} from '@/lib/android-queries';
import { getSyncRuns } from '@/lib/queries';
import {
  formatDateTime, formatDuration, formatElapsed, formatCount, formatPercent,
} from '@/lib/format';
import type { Metadata } from 'next';
import { androidTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  return androidTitle((await params).device, 'Sync Status');
}

export const dynamic = 'force-dynamic';

export default async function AndroidSyncPage({
  params,
}: {
  params: Promise<{ device: string }>;
}) {
  const { device: slug } = await params;
  const device = getAndroidDeviceBySlug(slug);
  if (!device) notFound();

  const info = getAndroidSyncInfo(device.deviceId);
  const overview = getAndroidOverview(device.deviceId, { days: 36500 });
  const runs = getSyncRuns(60).filter((r) => r.deviceId === device.deviceId);

  // Hours, not days -- the same unit `splitDuration` uses for every other
  // span on this dashboard, and it keeps "days" meaning "calendar days with
  // data" (the Row below) rather than two units spelled the same on one card.
  //
  // ⚠️ Measured against WHEN THE PHONE LOOKED, not against now. The reach is a
  // span between two instants the phone observed; anchoring it to the server's
  // clock makes it creep upward by however long it has been since the last
  // sync, so a phone that stopped reporting a week ago would appear to be
  // remembering a week more history than it did when last asked.
  const reachHours = device.eventsReachUtc
    ? (Date.parse(device.lastSeenUtc) - Date.parse(device.eventsReachUtc)) / 3_600_000
    : null;

  return (
    <>
      <div className="page-head">
        <h1>Sync Status</h1>
        <p>The phone pushes on its own schedule.</p>
      </div>

      <div className="grid grid--2">
        <Card delay={0}>
          <CardTitle sub="Measured on the phone every sync, not assumed.">
            How far back Android remembers
          </CardTitle>
          <div className="stat-value stat-value--accent" style={{ marginTop: '0.3rem' }}>
            {reachHours !== null ? reachHours.toFixed(0) : '?'}
            <span className="stat-unit">hours</span>
          </div>
          {/*
            The number the whole Android design rests on, so it gets its own
            card rather than being buried. Phase 1 could not measure it:
            dumpsys prints a "last 24 hour events" section, and that limit
            belongs to the dump rather than to queryEvents.
          */}
          <p className="prose-note" style={{ marginTop: '0.9rem' }}>
            <code className="mono">queryEvents</code> reach, as measured by the
            phone on {formatDateTime(device.lastSeenUtc)}. Anything older than
            this is gone from the phone for good, so the sync interval has to
            beat it comfortably. If this figure falls, sync more often.
          </p>
        </Card>

        <Card delay={60}>
          <CardTitle sub="What the database holds for this phone.">Stored</CardTitle>
          <div style={{ display: 'grid', gap: '0.55rem' }}>
            {/* The Android release used to lead the Overview's subtitle. It is
                a fact about the DEVICE, not about how current the numbers are,
                and the reach figure beside it is version-dependent -- so it
                belongs here, next to what it explains. */}
            <Row label="Android" value={`${device.androidRelease} (API ${device.sdkInt})`} />
            <Row label="Days with data" value={formatCount(overview.daysWithData)} />
            {overview.source === 'screen' ? (
              <>
                <Row label="Screen on" value={formatDuration(overview.rangeScreenOn)} />
                <Row label="Unlocked" value={formatDuration(overview.rangeUnlocked)} />
                <Row label="In an app" value={formatDuration(overview.rangeApps)} />
              </>
            ) : (
              <>
                {/* Below Android 9 the events do not exist. "Not recorded"
                    rather than 0s, which would read as a phone never used.
                    "In an app" is the union the Overview's total shows, so
                    the two pages agree to the second. */}
                <Row label="Screen on" value="not recorded below Android 9" />
                <Row label="Unlocked" value="not recorded below Android 9" />
                <Row label="In an app" value={formatDuration(overview.rangeScreenOn)} />
              </>
            )}
            <Row label="Apps seen" value={formatCount(overview.appCount)} />
            <Row label="Latest day" value={overview.latestDate ?? '-'} />
            <Row
              label="Last sync"
              value={info.lastSuccessUtc ? formatDateTime(info.lastSuccessUtc) : '-'}
            />
          </div>
          {info.provisionalShare > 0.5 && (
            // The in-flight span is real time, but it was clipped to the moment
            // the phone read it and WILL grow. Saying so stops a later sync
            // correcting "today" upward from looking like a glitch.
            <p className="prose-note" style={{ marginTop: '0.9rem' }}>
              {formatPercent(info.provisionalShare)} of stored screen-on is still
              provisional &mdash; the last sync caught the phone mid-use, and
              those spans will grow on the next one.
            </p>
          )}
        </Card>
      </div>

      <Card delay={120}>
        <CardTitle sub="Newest first. Only this phone's pushes.">Run history</CardTitle>
        {runs.length === 0 ? (
          <p className="prose-note">No syncs recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Stored</th>
                  <th style={{ textAlign: 'right' }}>Rejected</th>
                  <th style={{ textAlign: 'right' }}>Took</th>
                  <th>Backup</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(r.startedAt)}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          r.status === 'success' ? 'badge--ok'
                            : r.status === 'failed' ? 'badge--bad'
                              : 'badge--accent'
                        }`}
                      >
                        {r.status}
                      </span>
                      {r.error && (
                        <div style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-small)' }}>
                          {r.error}
                        </div>
                      )}
                    </td>
                    <td className="num mono">{formatCount(r.rowsInserted)}</td>
                    {/*
                      NOT the same meaning as the Windows column. There,
                      "skipped" is the dedup working and a healthy re-ingest is
                      almost all skips. Here it counts rows the server REFUSED
                      as malformed, so a non-zero value is worth looking at: a
                      field-name mismatch once rejected all 414 app labels and
                      this counter was the only place it showed.
                    */}
                    <td
                      className="num mono"
                      style={{ color: r.rowsSkipped > 0 ? '#ff8a80' : 'var(--text-dim)' }}
                    >
                      {formatCount(r.rowsSkipped)}
                    </td>
                    <td className="num mono">{formatElapsed(r.durationMs)}</td>
                    <td style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-small)' }}>
                      {r.backupStatus ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-small)' }}>{label}</span>
      <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
