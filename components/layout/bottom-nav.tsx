"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, X, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navForRole, type NavItem } from "./nav-config";
import { ThemeToggle } from "./theme-toggle";

const SHEET_SECTIONS: { label: string; hrefs: string[] }[] = [
  { label: "Finance",     hrefs: ["/financials", "/reports", "/pricelists", "/expenses"] },
  { label: "Procurement", hrefs: ["/shipments", "/suppliers"] },
  { label: "Catalogue",   hrefs: ["/products", "/godowns", "/competitors"] },
  { label: "Operations",  hrefs: ["/customers"] },
];

export function BottomNav({ role }: { role: string }) {
  const pathname    = usePathname();
  const all         = navForRole(role);
  const primary     = all.filter((i) => i.primary).slice(0, 4);
  const overflow    = all.filter((i) => !i.primary);
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
    if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 60) setSheetOpen(false);
    startY.current = null;
  }

  const overflowActive =
    overflow.some((i) => pathname === i.href || pathname.startsWith(i.href + "/")) ||
    (pathname === "/settings" && role !== "staff");

  const itemMap = new Map(all.map((i) => [i.href, i]));

  return (
    <>
      {/* ── Tab bar ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden flex justify-around items-center snm-bottom-nav"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          height: "calc(60px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {primary.map((item: NavItem) => {
          const Icon   = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-[3px] pt-2 transition-all active:scale-90 duration-150"
            >
              {active ? (
                <>
                  <div
                    className="h-[30px] w-[52px] rounded-full flex items-center justify-center"
                    style={{ background: "var(--snm-brand)" }}
                  >
                    <Icon className="h-[17px] w-[17px]" style={{ color: "#ffffff", strokeWidth: 2.2 }} />
                  </div>
                  <span className="label-caps" style={{ color: "var(--snm-brand)", fontSize: 11 }}>{item.label}</span>
                </>
              ) : (
                <>
                  <Icon className="h-[22px] w-[22px]" style={{ color: "var(--muted-foreground)", strokeWidth: 1.6 }} />
                  <span className="label-caps" style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{item.label}</span>
                </>
              )}
            </Link>
          );
        })}

        {hasOverflow && (
          <button
            onClick={() => setSheetOpen(true)}
            aria-label="More navigation options"
            aria-expanded={sheetOpen}
            className="flex-1 flex flex-col items-center justify-center gap-[3px] pt-2 transition-all active:scale-90 duration-150"
          >
            {overflowActive ? (
              <>
                <div
                  className="h-[30px] w-[52px] rounded-full flex items-center justify-center"
                  style={{ background: "var(--snm-brand)" }}
                >
                  <MoreHorizontal className="h-[17px] w-[17px]" style={{ color: "#ffffff", strokeWidth: 2.2 }} />
                </div>
                <span className="label-caps" style={{ color: "var(--snm-brand)", fontSize: 11 }}>More</span>
              </>
            ) : (
              <>
                <MoreHorizontal className="h-[22px] w-[22px]" style={{ color: "var(--muted-foreground)", strokeWidth: 1.6 }} />
                <span className="label-caps" style={{ color: "var(--muted-foreground)", fontSize: 11 }}>More</span>
              </>
            )}
          </button>
        )}
      </nav>

      {/* ── Sheet backdrop ── */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          style={{ background: "rgba(0,0,0,0.50)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          onClick={() => setSheetOpen(false)}
        />
      )}

      {/* ── Slide-up sheet ── */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden transition-transform duration-300 ease-out ${sheetOpen ? "translate-y-0" : "translate-y-full"}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}
      >
        <div
          className="mx-2 mb-2 rounded-3xl overflow-hidden glass-modal"
          style={{ boxShadow: "var(--glass-shadow-lg)" }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-9 h-[3px] rounded-full" style={{ background: "var(--muted-foreground)", opacity: 0.30 }} />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <p className="text-[13px] font-semibold text-foreground">More</p>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close menu"
                className="h-9 w-9 rounded-full flex items-center justify-center transition active:scale-90"
                style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Sectioned nav items */}
          <div className="px-2 pb-3 space-y-3">
            {SHEET_SECTIONS.map((section) => {
              const sectionItems = section.hrefs
                .map((href) => itemMap.get(href))
                .filter((i): i is NavItem => i !== undefined && overflow.includes(i));
              if (sectionItems.length === 0) return null;

              return (
                <div key={section.label}>
                  <p
                    className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-widest"
                    style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
                  >
                    {section.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {sectionItems.map((item) => {
                      const Icon   = item.icon;
                      const active = pathname === item.href || pathname.startsWith(item.href + "/");
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setSheetOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-3 rounded-2xl transition-all active:scale-[0.96]"
                          style={{
                            background: active ? "var(--snm-brand-muted)" : "var(--glass-bg-1)",
                            color:      active ? "var(--snm-brand)"       : "var(--muted-foreground)",
                            border:     active ? "1px solid var(--snm-brand-border)" : "0.5px solid var(--glass-border-lo)",
                          }}
                        >
                          <div
                            className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
                            style={{ background: active ? "var(--snm-brand)" : "var(--glass-bg-2)" }}
                          >
                            <Icon
                              className="h-[15px] w-[15px]"
                              style={{ color: active ? "#ffffff" : "var(--muted-foreground)" }}
                            />
                          </div>
                          <span className="text-[13px] font-medium">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Settings */}
            {role !== "staff" && (
              <div>
                <p
                  className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--muted-foreground)", opacity: 0.6 }}
                >
                  Account
                </p>
                <Link
                  href="/settings"
                  onClick={() => setSheetOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-3 rounded-2xl transition-all active:scale-[0.96]"
                  style={{
                    background: pathname === "/settings" ? "var(--snm-brand-muted)" : "var(--glass-bg-1)",
                    color:      pathname === "/settings" ? "var(--snm-brand)"       : "var(--muted-foreground)",
                    border:     pathname === "/settings" ? "1px solid var(--snm-brand-border)" : "0.5px solid var(--glass-border-lo)",
                  }}
                >
                  <div
                    className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: pathname === "/settings" ? "var(--snm-brand)" : "var(--glass-bg-2)" }}
                  >
                    <Settings
                      className="h-[15px] w-[15px]"
                      style={{ color: pathname === "/settings" ? "#ffffff" : "var(--muted-foreground)" }}
                    />
                  </div>
                  <span className="text-[13px] font-medium">Settings</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
