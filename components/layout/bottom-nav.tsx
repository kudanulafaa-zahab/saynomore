"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { navForRole, type NavItem } from "./nav-config";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function BottomNav({ role }: { role: string }) {
  const pathname = usePathname();
  const all = navForRole(role);
  const primary = all.filter((i) => i.primary);
  const overflow = all.filter((i) => !i.primary);
  const [moreOpen, setMoreOpen] = useState(false);

  const showMore = overflow.length > 0;
  const tabs = showMore ? primary.slice(0, 4) : primary;

  return (
    <>
      <nav
        className="glass-bottom-nav fixed bottom-0 left-0 right-0 z-40 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
      >
        <div className="flex items-stretch">
          {tabs.map((item: NavItem) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "stroke-[2.25]" : ""}`} />
                <span className={active ? "font-medium" : ""}>{item.label}</span>
              </Link>
            );
          })}

          {showMore && (
            <button
              onClick={() => setMoreOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="h-5 w-5" />
              <span>More</span>
            </button>
          )}
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="bg-popover/95 backdrop-blur-xl border-border">
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            {overflow.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="glass-flat flex flex-col items-center justify-center py-5 gap-2 text-foreground hover:bg-accent transition"
                >
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="text-xs">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
