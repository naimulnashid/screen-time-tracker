import { SkPageHead, SkCard, SkRows, SkDataTable, SkMask, SkText } from '@/components/Skeleton';

/**
 * Laptop Sync Status skeleton: the page's own markup (components/Skeleton.tsx).
 *
 * The Sampler card is drawn running, with its "Currently in" note -- the
 * state it is in whenever anyone is at the machine to look. The run history
 * draws ten rows of its 25: it starts below the first viewport.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title="Sync Status" sub="Whether the collectors are running, and what they have stored." />
      <div className="grid grid--2">
        <SkCard title="Sampler" sub="Read from the heartbeat file, not the task state.">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className="badge" style={{ borderColor: 'transparent' }}><SkText>Running</SkText></span>
            <span style={{ fontSize: 'var(--fs-small)' }}><SkText>last tick 1s ago</SkText></span>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <SkMask>
              <p className="prose-note">
                Currently in <strong>Code Editor</strong> for 12m 4s. This span is
                not in the database yet &mdash; it is written when the foreground
                changes, so today&rsquo;s totals below exclude it.
              </p>
            </SkMask>
          </div>
        </SkCard>
        <SkCard title="Stored" sub="What the database holds for this laptop.">
          <SkRows
            rows={[
              ['Days with data', '20'],
              ['Active time', '165h 35m'],
              ['Locked', '89h 6m'],
              ['Unattributed', '0s'],
              ['Asleep / not recording', '225h 17m'],
              ['Latest day', '2026-09-30'],
            ]}
          />
        </SkCard>
      </div>
      <SkCard
        title="Run history"
        sub="Newest first. Both collectors write here, filtered by source."
        aside={<span className="pager-count"><SkText>1–25 of 318</SkText></span>}
      >
        <SkDataTable
          className=""
          head={['Started', 'Source', 'Status', 'Stored', 'Skipped', 'Took', 'Backup']}
          rows={10}
          cells={['01 Oct 2026, 00:59', 'Windows sampler', { badge: 'success' }, '361', '0', '439 ms', 'ok']}
        />
      </SkCard>
    </>
  );
}
