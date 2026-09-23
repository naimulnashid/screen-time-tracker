'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { deviceOf } from '@/lib/accent';
import { pagesForPath } from '@/lib/nav';

/**
 * The page tabs for the device you are currently on.
 *
 * Deliberately in the top bar and not in the sidebar. The sidebar answers
 * "which machine", the tabs answer "which view of it" -- two different
 * questions, and folding the second into the first made the sidebar re-render
 * its own contents every time you changed page, which reads as the navigation
 * moving under you.
 */
export function Nav() {
  const pathname = usePathname();
  const pages = pagesForPath(deviceOf(pathname), pathname);

  // A device with a single page has nothing to switch between.
  if (pages.length < 2) return null;

  return (
    <nav className="nav">
      {pages.map((p) => {
        // Exact match for a section root, prefix match for the rest, so a
        // nested route does not light up Overview as well as its own tab.
        const active = p.root ? pathname === p.href : pathname.startsWith(p.href);
        return (
          <Link
            key={p.href}
            href={p.href}
            className="nav-link"
            data-active={active}
            // The colour says which tab you are on; this says it to a screen
            // reader. On an app's detail page By App is the section, not the
            // page, hence 'true' rather than 'page' there.
            aria-current={active ? (pathname === p.href ? 'page' : 'true') : undefined}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
