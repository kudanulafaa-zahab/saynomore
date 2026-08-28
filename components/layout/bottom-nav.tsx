"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navForRole, tabsForRole, activeItem } from "./nav-config";

/* Five tabs, and no "More".
 *
 * Ali, 2026-08-28: *"No proper navigation hierarchy. It's poorly designed."*
 *
 * This used to be four screens plus an overflow sheet holding the other
 * sixteen. Apple's guidance is three to five tabs and NO overflow tab — a
 * "More" sheet is the pattern to avoid rather than a way to fit more in — and
 * the sheet was where the app's real structure went to hide.
 *
 * Every tab is now a SECTION and every screen belongs to one, so the sheet has
 * nothing left to hold and is gone. The section switcher at the top of the page
 * moves between screens inside a tab.
 *
 * A ROLE WITH FEW ENOUGH SCREENS STILL GETS THEM DIRECTLY. A driver has one
 * screen; giving them a tab labelled with a section name would be a heading
 * over a single row, which is the noise this whole change removes. So at five
 * screens or fewer the items themselves are the tabs — which is exactly what
 * the driver has always seen.
 *
 * Headings and destinations both come from nav-config. Never reintroduce a
 * local list of hrefs here: that is how the Price Simulator once shipped built,
 * routable and unreachable. */

export function BottomNav({ role }: { role: string }) {
  const pathname = usePathname();
  const items    = navForRole(role);

  // Under six screens, the screens ARE the tabs. Otherwise the sections are.
  const tabs = items.length <= 5
    ? items.map((i) => ({ key: i.href, label: i.label, href: i.href, icon: i.icon }))
    : tabsForRole(role).map((t) => ({ key: t.section, label: t.section, href: t.href, icon: t.icon }));

  // WHICH TAB IS LIT is decided by the screen you are on, not by the tab's own
  // href — otherwise opening Godowns would light nothing, because no tab points
  // at it. A nested route (/sales/abc123) resolves to its parent screen, so the
  // tab stays lit three levels into an order.
  const current    = activeItem(items, pathname);
  const activeKey  = items.length <= 5 ? current?.href : current?.section;

  return (
    /* ── Floating tab bar — Liquid Glass pinned/translucent layer (z-axis
          anatomy layer 4). glass-tabbar carries the fill/blur/specular recipe
          from the palette; the active tab uses --glass-accent. ── */
    <nav
      className="fixed left-4 right-4 z-40 lg:hidden glass-tabbar"
      style={{
        bottom: "max(14px, env(safe-area-inset-bottom, 0px))",
        borderRadius: "var(--glass-radius-pill)",
        height: 64,
        paddingLeft: 6,
        paddingRight: 6,
      }}
    >
      {tabs.map((tab) => {
        const Icon   = tab.icon;
        const active = activeKey === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-[3px] transition-all active:scale-90 duration-150 glass-tab${active ? " glass-tab--active" : ""}`}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.6} />
            <span style={{ fontSize: 11 }}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
