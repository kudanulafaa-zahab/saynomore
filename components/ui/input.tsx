import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, onFocus, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      // Number fields are always "replace the whole value", never "edit part
      // of it" — select-all on focus so tapping in immediately lets you type
      // a fresh figure instead of having to backspace the old one first
      // (Ali: had to manually clear every numeric field before typing).
      // Text/search/etc keep native focus behaviour, where partial edits are
      // the normal case. A caller-supplied onFocus still runs first/wins.
      onFocus={type === "number" ? (e) => { onFocus?.(e); e.currentTarget.select(); } : onFocus}
      className={cn(
        // h-11 (44px) — Apple HIG minimum touch target. Was h-8 (32px);
        // every consumer of this shared primitive (Customer form, SKU forms,
        // godown/category managers) inherited an undersized input with no
        // per-call override, failing the 44pt minimum across the app.
        "h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
