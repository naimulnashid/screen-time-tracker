/**
 * Shown when the sampler has never recorded anything.
 *
 * Note there is NO "run as Administrator" here, unlike the sibling project.
 * Windows screen time is sampled from the foreground window, which any
 * ordinary user process can read -- telling someone to elevate would be
 * cargo-culted from a collector that has a reason to.
 *
 * There is no "nothing in this range" counterpart: ranges are anchored on the
 * newest day that HAS data, so a range with data somewhere is never empty.
 */
export function SamplerEmpty() {
  return (
    <div className="empty">
      <h1 style={{ marginBottom: '0.8rem' }}>Nothing recorded yet</h1>
      <p style={{ maxWidth: 560, margin: '0 auto 1.6rem' }}>
        The sampler records from the moment it starts &mdash; there is no
        history to backfill. Install it once and it runs at every logon,
        unelevated.
      </p>
      <pre
        className="mono"
        style={{
          display: 'inline-block', textAlign: 'left', padding: '1rem 1.3rem',
          background: 'var(--bg-panel)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-small)',
          color: 'var(--text-dim)', whiteSpace: 'pre-wrap',
        }}
      >
        {'powershell -ExecutionPolicy Bypass -File scripts\\install-sampler.ps1 -RunNow\nnpm run ingest'}
      </pre>
    </div>
  );
}
