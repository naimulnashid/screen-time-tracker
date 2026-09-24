import { PWA_ICONS } from '@/lib/pwa';
import { renderIcon } from '@/lib/pwa-icon';

/** The manifest's PNG icons, prerendered at build; any other name is a 404. */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return PWA_ICONS.map((i) => ({ icon: i.file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ icon: string }> }) {
  const { icon } = await params;
  const spec = PWA_ICONS.find((i) => i.file === icon);
  if (!spec) return new Response('Not found', { status: 404 });
  return renderIcon(spec);
}
