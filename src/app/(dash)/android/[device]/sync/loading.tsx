import { SkPageHead, SkCard, SkRows, SkDataTable, SkMask, SkText } from '@/components/Skeleton';

/**
 * Phone Sync Status skeleton: the page's own markup (components/Skeleton.tsx).
 * The run history draws ten rows of its 25: it starts below the first
 * viewport.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title="Sync Status" sub="The phone pushes on its own schedule." />
      <div className="grid grid--2">
        <SkCard title="How far back Android remembers" sub="Measured on the phone every sync, not assumed.">
          <div className="stat-value" style={{ marginTop: '0.3rem' }}>
            <SkText>240<span className="stat-unit">hours</span></SkText>
          </div>
          <div style={{ marginTop: '0.9rem' }}>
            <SkMask>
              <p className="prose-note">
                <code className="mono">queryEvents</code> reach, as measured by the
                phone on 01 Oct 2026, 01:12. Anything older than this is gone from
                the phone for good, so the sync interval has to beat it
                comfortably. If this figure falls, sync more often.
              </p>
            </SkMask>
          </div>
        </SkCard>
        <SkCard title="Stored" sub="What the database holds for this phone.">
          <SkRows
            rows={[
              ['Android', '15 (API 35)'],
              ['Days with data', '27'],
              ['Screen on', '169h 35m'],
              ['Unlocked', '168h 30m'],
              ['In an app', '127h 10m'],
              ['Apps seen', '11'],
              ['Latest day', '2026-09-30'],
              ['Last sync', '01 Oct 2026, 00:59'],
            ]}
          />
        </SkCard>
      </div>
      <SkCard
        title="Run history"
        sub="Newest first. Only this phone's pushes."
        aside={<span className="pager-count"><SkText>1–25 of 120</SkText></span>}
      >
        <SkDataTable
          className=""
          head={['Started', 'Status', 'Stored', 'Rejected', 'Took', 'Backup']}
          rows={10}
          cells={['01 Oct 2026, 00:59', { badge: 'success' }, '361', '0', '439 ms', 'ok']}
        />
      </SkCard>
    </>
  );
}
