"use client";

// iOS-style toggle. Green = on (semantic: green means good/on — the one place
// a hue is allowed to carry state). 51×31 like the native UISwitch.
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    // THE TRACK IS 51x31. THE TARGET IS 51x44.
    //
    // 51x31 is the native UISwitch to the pixel and must not change — a
    // "bigger" switch is not an iOS switch. But the button WAS 51x31, so the
    // tap target was 31px tall against a 44px floor.
    //
    // UIKit resolves this by making the control's hit area taller than its
    // ink, so the track moved into its own element and the button became the
    // 44px box around it. Nothing looks different; there are simply 6 more
    // pixels of switch to hit above and below.
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className="relative shrink-0 flex items-center justify-center disabled:opacity-40"
      style={{ width: 51, height: 44 }}
    >
      <span
        aria-hidden
        className="relative block rounded-full transition-colors duration-200"
        style={{
          width: 51,
          height: 31,
          background: checked
            ? "var(--snm-success)"
            : "color-mix(in srgb, var(--foreground) 16%, transparent)",
        }}
      >
        <span
          className="absolute rounded-full transition-transform duration-200"
          style={{
            top: 2,
            left: 2,
            height: 27,
            width: 27,
            background: "#fff",
            boxShadow: "var(--snm-thumb-shadow)",
            transform: checked ? "translateX(20px)" : "translateX(0)",
          }}
        />
      </span>
    </button>
  );
}
