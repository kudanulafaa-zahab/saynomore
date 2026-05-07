"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navForRole, type NavItem } from "./nav-config";

export function BottomNav({ role }: { role: string }) {
  const pathname = usePathname();
  const all = navForRole(role);
  const primary = all.filter((i) => i.primary).slice(0, 4);
  const overflow = all.filter((i) => !i.primary);

  const hasOverflow = overflow.length > 0 || role !== "staff";
  const [sheetOpen, setSheetOpen] = useState(false);

  // Close sheet on route change
  useEffect(() => { setSheetOpen(false); }, [pathname]);

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (sheetOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [sheetOpen]);

  // Drag-to-dismiss
  const startY = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) { startY.current = e.touches[0].clientY; }
  function onTouchEnd(e: React.TouchEvent) {
    if (startY.current !== null) {
      const delta = e.changedTouches[0].clientY - startY.current;
      if (delta > 60) setSheetOpen(false);
      startY.current = null;
    }
  }

  // Is any overflow item active?
  const overflowActive = overflow.some(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
  ) || (pathname === "/settings" && role !== "staff");

  return (
    <>
      {/* Bottom tab bar */}
      <nav
        className="glass-bottom-nav fixed bottom-0 left-0 right-0 z-40 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-stretch h-[56px]">
          {primary.map((item: NavItem) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center justify-center gap-[3px] text-[10px] transition-colors relative ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-b-full bg-primary" />
                )}
                <Icon className={`h-[22px] w-[22px] ${active ? "stroke-[2.25]" : "stroke-[1.75]"}`} />
                <span className={`leading-none ${active ? "font-medium" : ""}`}>{item.label}</span>
              </Link>
            );
          })}

          {hasOverflow && (
            <button
              onClick={() => setSheetOpen(true)}
              className={`flex-1 flex flex-col items-center justify-center gap-[3px] text-[10px] transition-colors relative ${
                overflowActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {overflowActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-b-full bg-primary" />
              )}
              <MoreHorizontal className={`h-[22px] w-[22px] ${overflowActive ? "stroke-[2.25]" : "stroke-[1.75]"}`} />
              <span className={`leading-none ${overflowActive ? "font-medium" : ""}`}>More</span>
            </button>
          )}
        </div>
      </nav>

      {/* Sheet backdrop */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSheetOpen(false)}
        />
      )}

      {/* Slide-up sheet */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden transition-transform duration-300 ease-out ${
          sheetOpen ? "translate-y-0" : "translate-y-full"
        }`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}
      >
        <div
          className="mx-3 mb-3 rounded-3xl overflow-hidden"
          style={{
            background: "var(--popover)",
            backdropFilter: "blur(48px) saturate(180%)",
            WebkitBackdropFilter: "blur(48px) saturate(180%)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 -8px 48px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(255,255,255,0.1) inset",
          }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-[4px] rounded-full bg-foreground/20" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3">
            <p className="text-sm font-semibold text-foreground">More</p>
            <button
              onClick={() => setSheetOpen(false)}
              className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Nav items — full width rows */}
          <div className="px-3 pb-3 space-y-1">
            {overflow.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSheetOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-secondary"
                  }`}
                >
                  <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                    active ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
                  }`}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <span className={`text-[15px] ${active ? "font-semibold" : "font-medium"}`}>
                    {item.label}
                  </span>
                  {active && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-primary" />
                  )}
                </Link>
              );
            })}

            {/* Settings — always accessible on mobile for non-staff */}
            {role !== "staff" && (
              <Link
                href="/settings"
                onClick={() => setSheetOpen(false)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors ${
                  pathname === "/settings"
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-secondary"
                }`}
              >
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                  pathname === "/settings" ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
                }`}>
                  <Settings className="h-4.5 w-4.5" />
                </div>
                <span className={`text-[15px] ${pathname === "/settings" ? "font-semibold" : "font-medium"}`}>
                  Settings
                </span>
                {pathname === "/settings" && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-primary" />
                )}
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
