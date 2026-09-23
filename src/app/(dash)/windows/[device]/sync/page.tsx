import { notFound } from 'next/navigation';
import { Card, CardTitle } from '@/components/Card';
import { getSyncRuns, getSamplerStatus, getOverview, hasWindowsData } from '@/lib/queries';
import { windowsSlug } from '@/lib/config';
import { resolveApp } from '@/lib/app-name';
import { formatDateTime, formatDuration, formatElapsed, formatCount } from '@/lib/format';
import type { Metadata } from 'next';
import { windowsTitle } from '@/lib/page-title';

/** `<page> · <device> · Screen Time` -- see lib/page-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ device: string }>;
}): Promise<Metadata> {
  return windowsTitle((await params).device, 'Sync Status');
}

export const dynamic = 'force-dynamic';

/**
 * Is the collector working, and what has it stored?
 *
 * The first card answers "is the sampler alive right now", which is the
 * question you actually open this page to ask. It reads the HEARTBEAT FILE,
 * not the scheduled task's state -- the task reports 'Ready' even while the
 * sampler runs, because its VBS launcher does not wait for the child, so task
 * state would answer a different question and answer it misleadingly.
 */

function SourceBadge({ source }: { source: string }) {
  const label =
    source === 'win-sampler' ? 'Windows sampler'
      : source === 'android-events' ? 'Android'
        : source;
  return <span className="app-kind">{label}</span>;
}

export default async function SyncPage({
  params,
}: {
  params: Promise<{ device: string }>;
}) {
  const { device: slug } = await params;
  if (slug !== windowsSlug()) notFound();

  const status = getSamplerStatus();
  const runs = getSyncRuns(40);
  const overview = hasWindowsData() ? getOverview({ days: 36500 }) : null;

  const inFlightApp =
    status.inFlight && status.inFlight.kind === 'app'
      ? resolveApp(status.inFlight.app).name
      : null;

  return (
    <>
      <div className="page-head">
        <h1>Sync Status</h1>
        <p>Whether the collectors are running, and what they have stored.</p>
      </div>

      <div className="grid grid--2">
        <Card delay={0}>
          <CardTitle sub="Read from the heartbeat file, not the task state.">
            Sampler
          </CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className={`badge ${status.alive ? 'badge--ok' : 'badge--bad'}`}>
              {status.alive ? 'Running' : 'Not running'}
            </span>
            {status.updated && (
              <span style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-small)' }}>
                last tick {status.staleSeconds}s ago
              </span>
            )}
          </div>

          {status.alive && status.inFlight ? (
            <p className="prose-note" style={{ marginTop: '1rem' }}>
              Currently{' '}
              {inFlightApp ? (
                <>
                  in <strong>{inFlightApp}</strong>
                </>
              ) : (
                <strong>{status.inFlight.kind}</strong>
              )}{' '}
              for {formatDuration(status.inFlight.ms)}. This span is not in the
              database yet &mdash; it is written when the foreground changes, so
              today&rsquo;s totals below exclude it.
            </p>
          ) : (
            !status.alive && (
              <p className="prose-note" style={{ marginTop: '1rem' }}>
                No recent heartbeat. The sampler records only while it runs and
                nothing backfills, so time passing now is time lost. Start it
                with{' '}
                <code className="mono">
                  install-sampler.ps1 -RunNow
                </code>
                .
              </p>
            )
          )}
        </Card>

        <Card delay={60}>
          <CardTitle sub="What the database holds for this laptop.">Stored</CardTitle>
          {overview ? (
            <div style={{ display: 'grid', gap: '0.55rem' }}>
              <Row label="Days with data" value={formatCount(overview.daysWithData)} />
              <Row label="Active time" value={formatDuration(overview.kinds.active)} />
              <Row label="Locked" value={formatDuration(overview.kinds.locked)} />
              <Row label="Unattributed" value={formatDuration(overview.kinds.unknown)} />
              <Row label="Asleep / not recording" value={formatDuration(overview.kinds.gap)} />
              <Row label="Latest day" value={overview.latestDate ?? '-'} />
            </div>
          ) : (
            <p className="prose-note">Nothing stored yet.</p>
          )}
        </Card>
      </div>

      <Card delay={120}>
        <CardTitle sub="Newest first. Both collectors write here, filtered by source.">
          Run history
        </CardTitle>
        {runs.length === 0 ? (
          <p className="prose-note">No runs recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Stored</th>
                  <th style={{ textAlign: 'right' }}>Skipped</th>
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
                    <td><SourceBadge source={r.source} /></td>
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
                    {/* Skipped is not a failure: it is the dedup working, and a
                        healthy re-ingest is almost entirely skips. */}
                    <td className="num mono" style={{ color: 'var(--text-dim)' }}>
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
