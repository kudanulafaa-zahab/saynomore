"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { navForRole, type NavItem } from "./nav-config";

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const items = navForRole(role);

  return (
    <aside className="glass-sidebar fixed left-0 top-0 z-40 h-dvh w-64 hidden lg:flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{
            background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
            boxShadow: "0 4px 16px rgba(99,102,241,0.35)",
          }}
        >
          <span className="text-sm font-bold text-white">S</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-foreground">SayNoMore</p>
          <p className="text-[11px] text-muted-foreground">FMCG Operations</p>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {items.map((item: NavItem) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all border ${
                active
                  ? "bg-accent text-accent-foreground border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border-transparent"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {role !== "staff" && (
        <div className="px-3 py-4 border-t border-sidebar-border">
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      )}
    </aside>
  );
}
