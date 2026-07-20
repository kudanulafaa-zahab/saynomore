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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className="relative shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40"
      style={{
        width: 51,
        height: 31,
        background: checked
          ? "var(--snm-success)"
          : "color-mix(in srgb, var(--foreground) 16%, transparent)",
      }}
    >
      <span
        aria-hidden
        className="absolute rounded-full transition-transform duration-200"
        style={{
          top: 2,
          left: 2,
          height: 27,
          width: 27,
          background: "#fff",
          boxShadow: "0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16)",
          transform: checked ? "translateX(20px)" : "translateX(0)",
        }}
      />
    </button>
  );
}
