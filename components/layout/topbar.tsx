"use client";

import { Bell, LogOut, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function Topbar({ name, role }: { name: string; role: string }) {
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header
      className="fixed top-0 w-full z-40 flex justify-between items-center px-5 h-16"
      style={{
        background: "color-mix(in srgb, var(--background) 80%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--glass-border)",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden shrink-0"
          style={{ background: "var(--secondary)", border: "1px solid var(--glass-border)" }}
        >
          <span className="text-[11px] font-bold text-foreground">{initials}</span>
        </div>
        <span className="text-[17px] font-bold tracking-tight text-foreground lg:hidden">
          SayNoMore
        </span>
        <span className="text-[17px] font-bold tracking-tight text-foreground hidden lg:block">
          SayNoMore
        </span>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 active:scale-95"
          style={{ color: "var(--foreground)" }}
        >
          <Bell className="h-[18px] w-[18px]" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="w-9 h-9 p-0 rounded-full hover:bg-white/10"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-foreground"
                  style={{ background: "var(--secondary)", border: "1px solid var(--glass-border)" }}
                >
                  {initials}
                </div>
              </Button>
            }
          />
          <DropdownMenuContent
            align="end"
            className="border-white/10"
            style={{ background: "var(--glass-2)", backdropFilter: "blur(20px)", color: "var(--foreground)" }}
          >
            <DropdownMenuItem className="text-on-surface-variant gap-2 focus:bg-white/10 focus:text-foreground">
              <User className="h-4 w-4" />
              <span>{name}</span>
              <span className="ml-auto text-[10px] uppercase tracking-widest opacity-50">{role}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-red-400 focus:text-red-300 focus:bg-red-500/10 gap-2"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
