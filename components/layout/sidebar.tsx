"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { navForRole, type NavItem } from "./nav-config";
import { ThemeToggle } from "./theme-toggle";

// Section groupings for the sidebar — mirrors the nav architecture
const SECTIONS = [
  {
    label: "Core",
    hrefs: ["/dashboard", "/shipments", "/inventory", "/sales", "/financials"],
  },
  {
    label: "Procurement",
    hrefs: ["/suppliers", "/expenses"],
  },
  {
    label: "Catalogue",
    hrefs: ["/products", "/godowns", "/competitors"],
  },
  {
    label: "Operations",
    hrefs: ["/customers", "/dispatch", "/reports"],
  },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all"
      style={{
        background: active ? "var(--snm-brand-muted)" : "transparent",
        color: active ? "var(--snm-brand)" : "var(--muted-foreground)",
      }}
    >
      <Icon
        className="h-[15px] w-[15px] shrink-0"
        style={{ opacity: active ? 1 : 0.6 }}
      />
      {item.label}
    </Link>
  );
}

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const items = navForRole(role);
  const itemMap = new Map(items.map((i) => [i.href, i]));

  return (
    <aside
      className="fixed left-0 top-0 z-40 h-dvh w-60 hidden lg:flex flex-col"
      style={{
        background: "color-mix(in srgb, var(--background) 88%, transparent)",
        backdropFilter: "blur(32px)",
        WebkitBackdropFilter: "blur(32px)",
        borderRight: "1px solid var(--glass-border)",
      }}
    >
      {/* Logo — same height as topbar (52px) */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{ height: 52, borderBottom: "1px solid var(--glass-border)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ background: "var(--snm-brand)", color: "#ffffff" }}
          >
            S
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold text-foreground">SayNoMore</p>
            <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>FMCG Ops</p>
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
                className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: "var(--muted-foreground)", opacity: 0.5 }}
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
        <div className="px-3 py-3 shrink-0" style={{ borderTop: "1px solid var(--glass-border)" }}>
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all"
            style={{
              background: pathname === "/settings" ? "var(--snm-brand-muted)" : "transparent",
              color: pathname === "/settings" ? "var(--snm-brand)" : "var(--muted-foreground)",
            }}
          >
            <Settings className="h-[15px] w-[15px] shrink-0" style={{ opacity: pathname === "/settings" ? 1 : 0.6 }} />
            Settings
          </Link>
        </div>
      )}
    </aside>
  );
}
