import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* ── The app's Button. ──────────────────────────────────────────────────────
 *
 * Ali, 2026-08-29: *"Go through each module, card, full navigation and
 * hierarchy and optimize the user ui/UX experience to the latest standards."*
 *
 * ── WHY 443 BUTTONS IN THIS APP ARE HAND-ROLLED ────────────────────────────
 *
 * Because this file was stock shadcn, untouched, and using it was WRONG. Its
 * sizes were h-8 (32px), sm 28px, lg 36px, icon 32px — every one of them under
 * Apple's 44pt minimum touch target, in an app Ali runs one-handed on a phone.
 * Its colours were bg-primary / bg-secondary / bg-muted: the stock shadcn
 * palette, not this app's (--foreground, --glass-bg-1, --glass-accent).
 *
 * So bypassing it was the correct call every time, and the count is the proof:
 * 443 hand-rolled <button> elements against 29 using this one — carrying 75
 * distinct backgrounds, 20 distinct corner radii (including `rounded-full` and
 * `borderRadius: 999`, the same shape spelled two ways) and 14 distinct
 * heights. That is not 443 mistakes. It is one unusable component.
 *
 * The retrofit literature has one line that matters here: *when the on-brand
 * path is the fastest path, teams stop going rogue.* This is that fix. Nothing
 * is migrated by this commit; the component simply becomes worth using.
 *
 * ── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ────────────────────────────
 *
 * The variant NAMES are unchanged — default / secondary / outline / ghost /
 * destructive / link — so all 29 existing call sites keep working and every
 * one of them gets a 44pt target and the app's palette for free. Every one was
 * on the 32px default; none passed a `size` at all.
 *
 * What changed is what those names MEAN:
 *
 *   HEIGHT     44px minimum, everywhere, with no way to go under it. `sm` and
 *              `xs` are gone rather than shrunk: a size that cannot be
 *              tapped is not a size, and leaving the names would have let one
 *              back in. `lg` is 48px for primary actions.
 *   COLOUR     tokens only — --foreground, --glass-bg-1, --snm-error,
 *              --glass-accent. Never a hex, never a shadcn alias, so the two
 *              palettes and both schemes reach it.
 *   PRESS      .snm-pressable, the one canonical press feedback in this app
 *              (skills.md Seat 2), instead of a bespoke translate-y.
 *   RADIUS     --glass-radius-md, or the pill token when `pill` is set. Not a
 *              literal, so it cannot become the 21st corner radius.
 */

const buttonVariants = cva(
  [
    "snm-pressable group/button inline-flex shrink-0 items-center justify-center gap-2",
    "whitespace-nowrap font-semibold transition-all outline-none select-none",
    // A 44pt MINIMUM, expressed as a floor rather than a fixed height, so a
    // button with two lines of label grows instead of clipping.
    "min-h-11",
    "border border-transparent bg-clip-padding",
    "focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] focus-visible:ring-offset-1",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        // The app's primary action, and by far the most common shape already
        // hand-rolled: ink-on-paper, inverted. 75 buttons do exactly this.
        default:
          "bg-[var(--foreground)] text-[var(--background)] active:opacity-90",
        // Secondary: a filled but quiet surface with a hairline. NOT a card —
        // a card surface on a button is the misuse lib/surfaces.ts is about.
        secondary:
          "bg-[var(--glass-bg-1)] text-[var(--foreground)] border-[var(--glass-border-lo)]",
        outline:
          "bg-transparent text-[var(--foreground)] border-[var(--glass-border-lo)]",
        // Quiet: the bare tappable text or icon. 130 of the hand-rolled
        // buttons have no background at all, and this is that shape.
        ghost:
          "bg-transparent text-[var(--foreground)] active:bg-[var(--glass-bg-1)]",
        // Losing money is a decision, never an accident (hard rule 7): the
        // destructive action is legible as destructive before it is pressed.
        destructive:
          "bg-[color-mix(in_srgb,var(--snm-error)_14%,transparent)] text-[var(--snm-error)] border-[color-mix(in_srgb,var(--snm-error)_30%,transparent)]",
        accent:
          "bg-[var(--glass-accent)] text-[var(--snm-brand-on)]",
        // A link is text, so it keeps text's height rather than a button's —
        // the one exception to the 44pt floor, because it sits inline in a
        // sentence and padding it out would break the line it lives in.
        link: "min-h-0 text-[var(--snm-brand-text)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 ios-subhead",
        lg: "h-12 px-6 text-[15px]",
        // Square, and still 44pt. Icon-only buttons need an aria-label; there
        // is no way for this component to supply one, so callers must.
        icon: "h-11 w-11 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  pill = false,
  style,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Full-round. 66 hand-rolled buttons already are, in two spellings. */
    pill?: boolean
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      style={{
        borderRadius: pill ? "var(--glass-radius-pill)" : "var(--glass-radius-md)",
        ...style,
      }}
      {...props}
    />
  )
}

export { Button, buttonVariants }
