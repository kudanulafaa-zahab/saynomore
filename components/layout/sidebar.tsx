"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { navForRole, type NavItem } from "./nav-config";
import { ThemeToggle } from "./theme-toggle";

const SECTIONS = [
  { label: "Core",        hrefs: ["/dashboard", "/sales", "/inventory", "/dispatch"] },
  { label: "Finance",     hrefs: ["/financials", "/reports", "/pricelists", "/expenses"] },
  { label: "Procurement", hrefs: ["/reorder", "/shipments", "/suppliers"] },
  { label: "Catalogue",   hrefs: ["/products", "/godowns", "/stock-ops", "/competitors"] },
  { label: "Operations",  hrefs: ["/customers"] },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-xl px-3 ios-subhead font-medium transition-all active:scale-[0.97]"
      style={{
        minHeight: 44,
        background: active ? "var(--snm-brand-muted)" : "transparent",
        color:      active ? "var(--snm-brand)"       : "var(--muted-foreground)",
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
  const itemMap  = new Map(items.map((i) => [i.href, i]));

  return (
    <aside
      className="fixed left-0 top-0 z-40 h-dvh w-60 hidden lg:flex flex-col glass-sidebar"
    >
      {/* Logo — 52px matches topbar */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{ height: 52, borderBottom: "0.5px solid var(--glass-border-lo)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center ios-subhead font-bold shrink-0"
            style={{ background: "var(--snm-brand)", color: "#ffffff" }}
          >
            S
          </div>
          <div className="leading-tight">
            <p className="ios-subhead font-semibold text-foreground">SayNoMore</p>
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>FMCG Ops</p>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {SECTIONS.map((section) => {
          const sectionItems = section.hrefs
            .map((href) => itemMap.get(href))
            .filter((i): i is NavItem => i !== undefined);
          if (sectionItems.length === 0) return null;

          return (
            <div key={section.label}>
              <p
                className="px-3 mb-1 text-[12px] font-bold uppercase tracking-widest"
                style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
              >
                {section.label}
              </p>
              <div className="space-y-0.5">
                {sectionItems.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return <NavLink key={item.href} item={item} active={active} />;
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Settings footer */}
      {role !== "staff" && (
        <div className="px-3 py-3 shrink-0" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-xl px-3 py-2 ios-subhead font-medium transition-all active:scale-[0.97]"
            style={{
              background: pathname === "/settings" ? "var(--snm-brand-muted)" : "transparent",
              color:      pathname === "/settings" ? "var(--snm-brand)"       : "var(--muted-foreground)",
            }}
          >
            <Settings
              className="h-[15px] w-[15px] shrink-0"
              style={{ opacity: pathname === "/settings" ? 1 : 0.55 }}
            />
            Settings
          </Link>
        </div>
      )}
    </aside>
  );
}
