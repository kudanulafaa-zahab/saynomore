"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { navForRole, type NavItem } from "./nav-config";

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const items = navForRole(role);

  return (
    <aside
      className="fixed left-0 top-0 z-40 h-dvh w-64 hidden lg:flex flex-col"
      style={{
        background: "color-mix(in srgb, var(--background) 85%, transparent)",
        backdropFilter: "blur(32px)",
        WebkitBackdropFilter: "blur(32px)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <span className="text-sm font-bold text-foreground">S</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-foreground">SayNoMore</p>
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>FMCG Operations</p>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {items.map((item: NavItem) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all"
              style={{
                background: active ? "rgba(255,255,255,0.08)" : "transparent",
                color: active ? "var(--foreground)" : "var(--muted-foreground)",
                borderLeft: active ? "2px solid rgba(255,255,255,0.60)" : "2px solid transparent",
              }}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {role !== "staff" && (
        <div className="px-3 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all"
            style={{
              background: pathname === "/settings" ? "rgba(255,255,255,0.08)" : "transparent",
              color: pathname === "/settings" ? "var(--foreground)" : "var(--muted-foreground)",
              borderLeft: pathname === "/settings" ? "2px solid rgba(255,255,255,0.60)" : "2px solid transparent",
            }}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      )}
    </aside>
  );
}
