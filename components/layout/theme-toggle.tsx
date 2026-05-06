"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Avoid hydration mismatch — render placeholder until mounted
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="text-muted-foreground">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <Icon className="h-4 w-4" />
            <span className="sr-only">Theme</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="bg-popover border-border">
        {[
          { value: "light",  label: "Light",  Icon: Sun },
          { value: "dark",   label: "Dark",   Icon: Moon },
          { value: "system", label: "System", Icon: Monitor },
        ].map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className="text-foreground focus:bg-secondary"
          >
            <Icon className="h-4 w-4 mr-2" />
            {label}
            {theme === value && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
