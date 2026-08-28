"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { navForRole, NAV_SECTIONS, activeItem, type NavItem } from "./nav-config";
import { ThemeToggle } from "./theme-toggle";

// Headings come from NAV_SECTIONS and each item's own `section` — see the
// note in nav-config.ts. A local list of hrefs here is how a page ends up
// built, routable and invisible.

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`snm-navlink flex items-center gap-3 rounded-xl px-3 ios-subhead font-medium active:scale-[0.97] ${active ? "snm-navlink-active" : ""}`}
      style={{
        minHeight: 40,
        color: active ? undefined : "var(--muted-foreground)",
      }}
    >
      <Icon
        className="h-[16px] w-[16px] shrink-0"
        style={{ opacity: active ? 1 : 0.65 }}
      />
      {item.label}
    </Link>
  );
}

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const items    = navForRole(role);
  // ONE definition of "which screen is open", shared with the tab bar.
  const current  = activeItem(items, pathname);

  return (
    <aside
      className="fixed left-0 top-0 z-40 h-dvh w-60 hidden lg:flex flex-col glass-panel--strong"
      style={{ borderRadius: 0, borderTop: "none", borderLeft: "none", borderBottom: "none" }}
    >
      {/* Logo — 52px matches topbar */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{ height: 52, borderBottom: "0.5px solid var(--glass-border-lo)" }}
      >
        <div className="flex items-center gap-2.5">
          <Image
            src="/icon.svg"
            alt="SayNoMore"
            width={28}
            height={28}
            unoptimized
            className="w-7 h-7 rounded-lg shrink-0"
            style={{ objectFit: "cover" }}
          />
          <div className="leading-tight">
            <p className="snm-wordmark text-[15px] text-foreground">saynomore</p>
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>FMCG Ops</p>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {NAV_SECTIONS.map((section) => {
          const sectionItems = items.filter((i) => i.section === section);
          if (sectionItems.length === 0) return null;

          return (
            <div key={section}>
              <p
                className="px-3 mb-1 text-[12px] font-bold uppercase tracking-widest"
                style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
              >
                {section}
              </p>
              <div className="space-y-0.5">
                {sectionItems.map((item) => (
                  <NavLink key={item.href} item={item} active={item.href === current?.href} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

    </aside>
  );
}
