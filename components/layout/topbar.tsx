"use client";

import { LogOut, User, Wifi, WifiOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./theme-toggle";
import { useEffect, useState } from "react";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  staff: "Delivery Staff",
};

export function Topbar({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 glass-sidebar border-b border-sidebar-border">
      <div className="flex items-center justify-between px-4 sm:px-6 py-2.5">
        {/* Mobile: show logo here since sidebar is hidden */}
        <div className="flex items-center gap-2 lg:hidden">
          <div
            className="h-7 w-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <span className="text-[11px] font-bold text-white">S</span>
          </div>
          <span className="text-sm font-semibold text-foreground">SayNoMore</span>
        </div>
        <div className="hidden lg:block" />

        <div className="flex items-center gap-1">
          {/* Online indicator (mobile useful) */}
          <div
            className={`hidden sm:flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg ${
              online
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
            title={online ? "Online" : "Offline — changes will sync when back"}
          >
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span className="hidden md:inline">{online ? "Online" : "Offline"}</span>
          </div>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" className="gap-2 px-2 hover:bg-secondary">
                  <div
                    className="h-7 w-7 rounded-full flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
                  >
                    <span className="text-[11px] font-semibold text-white">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="text-left leading-tight hidden sm:block">
                    <p className="text-xs font-medium text-foreground">{name}</p>
                    <p className="text-[10px] text-muted-foreground">{ROLE_LABEL[role]}</p>
                  </div>
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="bg-popover border-border">
              <DropdownMenuItem className="text-muted-foreground">
                <User className="h-4 w-4 mr-2" />
                {name}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="text-red-500 focus:text-red-600 focus:bg-red-500/10"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
