'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { deviceOf } from '@/lib/accent';
import { LaptopIcon, PhoneIcon, MenuIcon } from './DeviceIcons';

/**
 * Namespaced away from the sibling project's key.
 *
 * localStorage IS partitioned by port, unlike cookies, so `localhost:7843` and
 * `localhost:7844` could not actually collide here. The distinct name is for
 * the human reading DevTools, not for correctness -- and it costs nothing.
 * (The cookie name in `auth.ts` is a different story: that one MUST differ.)
 */
const STORAGE_KEY = 'screen-time.sidebar-collapsed';

export interface SidebarPhone {
  slug: string;
  label: string;
}

/**
 * Device switcher, and only that.
 *
 * The sidebar answers "which machine". The page tabs -- Overview, By App, Sync
 * Status -- answer "which view of it", and live in the top bar. Two different
 * questions; folding the second into the first made the sidebar re-render its
 * own contents on every page change, which reads as navigation moving under you.
 *
 * The phones come from the database rather than a constant, because there can
 * be any number of them and the dashboard should not need editing to show one.
 */
export function Sidebar({
  phones, windowsLabel, windowsSlug,
}: {
  phones: SidebarPhone[];
  windowsLabel: string;
  windowsSlug: string;
}) {
  const pathname = usePathname();
  const active = deviceOf(pathname);
  // `/android/<slug>/...` -- which phone, if any, is open.
  const activeSlug = active === 'android' ? pathname.split('/')[2] : undefined;

  /*
    COLLAPSED BY DEFAULT: the icon rail, unless this browser has been told
    otherwise. Only an explicit '0' -- someone pressing the hamburger to open
    it -- expands it, and that choice is remembered.

    The default moved from expanded when phones started getting the desktop
    layout (see `viewport` in the root layout): on a 1024px canvas scaled onto
    a phone, a 232px sidebar is a fifth of the screen spent on three device
    names.

    Starts collapsed and corrects itself after mount. Reading localStorage
    during render gives the server one answer and the client another, which
    React reports as a hydration mismatch. The flash of a collapsed rail on an
    expanded setup lasts one frame; the alternative -- suppressing hydration
    warnings -- hides real mismatches later.
  */
  const [collapsed, setCollapsed] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) !== '0');
    } catch {
      // Private windows and blocked site data throw on access. A sidebar that
      // is merely always collapsed beats a crash.
    }
    setReady(true);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* see above */ }
  };

  return (
    <aside
      className="sidebar"
      data-collapsed={collapsed}
      // Until the stored value is read, skip the width transition, or a
      // collapsed sidebar visibly slides shut on every page load.
      data-ready={ready}
    >
      <div className="sidebar-head">
        <button
          className="sidebar-burger"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <MenuIcon />
        </button>
        {/* Deliberately `/` and not the laptop's own address: the brand is
            "home", and `/` is the one URL that is guaranteed to mean that
            however the devices are named. It redirects to the laptop. */}
        <Link href="/" className="brand sidebar-label" title="Screen Time">
          {/* Same file the browser uses for the tab icon, so the mark and the
              favicon cannot drift apart. */}
          <img src="/icon.svg" alt="" className="brand-mark" width={20} height={20} />
          <span>Screen Time</span>
        </Link>
      </div>

      <nav className="sidebar-nav">
        <Link
          href={`/windows/${windowsSlug}`}
          className="side-device"
          // Scopes the accent variables to this entry, so each row carries its
          // own device's colour even while you are looking at another. Which
          // machine you are about to switch to is legible before you click.
          data-device="zephyrus"
          data-active={active === 'zephyrus'}
          // Which device you are on, for a screen reader; `true` rather than
          // `page`, since the device is the section and the tab is the page.
          aria-current={active === 'zephyrus' ? 'true' : undefined}
          title={`${windowsLabel} - Windows`}
        >
          <span className="side-device-icon"><LaptopIcon size={20} /></span>
          <span className="sidebar-label side-device-text">
            <span className="side-device-name">{windowsLabel}</span>
            <span className="side-device-sub">Windows</span>
          </span>
        </Link>

        {phones.map((p) => (
          <Link
            key={p.slug}
            href={`/android/${p.slug}`}
            className="side-device"
            data-device="android"
            data-active={active === 'android' && activeSlug === p.slug}
            aria-current={active === 'android' && activeSlug === p.slug ? 'true' : undefined}
            title={`${p.label} - Android`}
          >
            <span className="side-device-icon"><PhoneIcon size={20} /></span>
            <span className="sidebar-label side-device-text">
              <span className="side-device-name">{p.label}</span>
              <span className="side-device-sub">Android</span>
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
