"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, X, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navForRole, type NavItem } from "./nav-config";

export function BottomNav({ role }: { role: string }) {
  const pathname = usePathname();
  const all = navForRole(role);
  const primary = all.filter((i) => i.primary).slice(0, 4);
  const overflow = all.filter((i) => !i.primary);
  const hasOverflow = overflow.length > 0 || role !== "staff";
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { setSheetOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = sheetOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [sheetOpen]);

  const startY = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) { startY.current = e.touches[0].clientY; }
  function onTouchEnd(e: React.TouchEvent) {
    if (startY.current !== null) {
      if (e.changedTouches[0].clientY - startY.current > 60) setSheetOpen(false);
      startY.current = null;
    }
  }

  const overflowActive = overflow.some(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
  ) || (pathname === "/settings" && role !== "staff");

  return (
    <>
      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden flex justify-around items-center h-20"
        style={{
          background: "color-mix(in srgb, var(--background) 80%, transparent)",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {primary.map((item: NavItem) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-1 transition-all active:scale-90 duration-200"
            >
              {active ? (
                <div
                  className="flex flex-col items-center justify-center gap-1 px-4 py-1.5 rounded-full"
                  style={{ background: "rgba(255,255,255,1)" }}
                >
                  <Icon className="h-5 w-5" style={{ color: "#2f3131", strokeWidth: 2 }} />
                  <span className="label-caps" style={{ color: "#2f3131", fontSize: 9 }}>{item.label}</span>
                </div>
              ) : (
                <>
                  <Icon className="h-5 w-5" style={{ color: "var(--muted-foreground)", strokeWidth: 1.75 }} />
                  <span className="label-caps" style={{ color: "var(--muted-foreground)", fontSize: 9 }}>{item.label}</span>
                </>
              )}
            </Link>
          );
        })}

        {hasOverflow && (
          <button
            onClick={() => setSheetOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-1 transition-all active:scale-90 duration-200"
          >
            <MoreHorizontal className="h-5 w-5" style={{ color: overflowActive ? "var(--foreground)" : "var(--muted-foreground)", strokeWidth: 1.75 }} />
            <span className="label-caps" style={{ color: overflowActive ? "var(--foreground)" : "var(--muted-foreground)", fontSize: 9 }}>More</span>
          </button>
        )}
      </nav>

      {/* Sheet backdrop */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          style={{ background: "rgba(0,0,0,0.50)", backdropFilter: "blur(4px)" }}
          onClick={() => setSheetOpen(false)}
        />
      )}

      {/* Slide-up sheet */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden transition-transform duration-300 ease-out ${sheetOpen ? "translate-y-0" : "translate-y-full"}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}
      >
        <div
          className="mx-3 mb-3 rounded-3xl overflow-hidden"
          style={{
            background: "var(--glass-1)",
            backdropFilter: "blur(48px)",
            WebkitBackdropFilter: "blur(48px)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 -8px 48px rgba(0,0,0,0.40)",
          }}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-[3px] rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
          </div>

          <div className="flex items-center justify-between px-5 py-3">
            <p className="text-sm font-semibold text-foreground">More</p>
            <button
              onClick={() => setSheetOpen(false)}
              className="h-7 w-7 rounded-full flex items-center justify-center transition"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--foreground)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-3 pb-4 space-y-1">
            {overflow.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSheetOpen(false)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors"
                  style={{
                    background: active ? "rgba(255,255,255,0.08)" : "transparent",
                    color: active ? "var(--foreground)" : "var(--muted-foreground)",
                  }}
                >
                  <div
                    className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: active ? "rgba(255,255,255,1)" : "rgba(255,255,255,0.06)" }}
                  >
                    <Icon className="h-4 w-4" style={{ color: active ? "#2f3131" : "var(--muted-foreground)" }} />
                  </div>
                  <span className="text-[15px] font-medium">{item.label}</span>
                  {active && <span className="ml-auto w-2 h-2 rounded-full bg-white" />}
                </Link>
              );
            })}

            {role !== "staff" && (
              <Link
                href="/settings"
                onClick={() => setSheetOpen(false)}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors"
                style={{
                  background: pathname === "/settings" ? "rgba(255,255,255,0.08)" : "transparent",
                  color: pathname === "/settings" ? "var(--foreground)" : "var(--muted-foreground)",
                }}
              >
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: pathname === "/settings" ? "rgba(255,255,255,1)" : "rgba(255,255,255,0.06)" }}
                >
                  <Settings className="h-4 w-4" style={{ color: pathname === "/settings" ? "#2f3131" : "var(--muted-foreground)" }} />
                </div>
                <span className="text-[15px] font-medium">Settings</span>
                {pathname === "/settings" && <span className="ml-auto w-2 h-2 rounded-full bg-white" />}
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
