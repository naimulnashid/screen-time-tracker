import { SkPageHead, SkCard, SkRanked, SkDataTable, SkMask } from '@/components/Skeleton';
import { HomeRankNote } from '@/components/Notes';
import { listRule } from '@/lib/app-list';

/**
 * Phone By App skeleton: the page's own markup (components/Skeleton.tsx).
 *
 * Eight bars per ranking, and the note under Most opened that names the home
 * screen, which every phone has. The table draws ten rows: its length is
 * data, and it starts below the first viewport.
 */
export default function Loading() {
  return (
    <>
      <SkPageHead title="By App" sub="31 apps across 27 days" />
      <SkCard title="Top apps" sub="Named by the phone itself. Hover a bar for time, share and opens.">
        <SkRanked />
      </SkCard>
      <SkCard title="Most opened" sub="Ranked by how often you opened it. Hover a bar for share and time.">
        <SkRanked />
        <SkMask><HomeRankNote names="Launcher" verb="is" opens="1,108" /></SkMask>
      </SkCard>
      <SkCard
        title="Apps · 14 of 31"
        sub={
          `${listRule()} ` +
          'These rows do NOT sum to screen-on time, unlike the Windows side. ' +
          'A phone session leaves gaps no app claims; the laptop sampler ' +
          'partitions its time exclusively.'
        }
      >
        <SkDataTable
          icon
          head={['App', 'Time', 'Share', 'Opens', 'Days']}
          rows={10}
          cells={[{ text: 'Video', sub: 'com.example.video' }, '41h 2m', '24.2%', '163', '27']}
        />
      </SkCard>
    </>
  );
}
