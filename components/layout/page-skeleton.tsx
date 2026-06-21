/**
 * Instant route-loading skeleton.
 *
 * Next.js renders a route's `loading.tsx` immediately on navigation — before
 * any client data fetch — so tapping a nav item shows this placeholder at once
 * instead of a blank screen + spinner. That instant-then-fill behaviour is what
 * makes navigation feel native (iOS push-then-populate), so every primary
 * screen ships a loading.tsx that renders this.
 *
 * Pure presentational, no client JS needed — kept as a server component.
 */
/** Just the glass card of shimmer rows — for tab panes / inner panels that
    already sit under a page header. Reused by PageSkeleton for consistency. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-1)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "0.5px solid var(--glass-border-lo)",
        boxShadow: "var(--glass-shadow), var(--glass-inner)",
      }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-4"
          style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}
        >
          <div className="snm-skel h-9 w-9 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="snm-skel h-3.5 rounded" style={{ width: `${60 - (i % 3) * 10}%` }} />
            <div className="snm-skel h-3 w-1/3 rounded" />
          </div>
          <div className="snm-skel h-4 w-14 rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({
  title,
  rows = 6,
}: {
  /** Shown as a real heading so the title doesn't flash in late. */
  title?: string;
  /** How many placeholder list rows to draw. */
  rows?: number;
}) {
  return (
    <div className="max-w-4xl mx-auto">
      {/* Title — real text if known, otherwise a shimmer bar */}
      <div className="mb-4">
        {title ? (
          <h1 className="ios-page-title">{title}</h1>
        ) : (
          <div className="snm-skel h-7 w-40 rounded-lg" />
        )}
        <div className="snm-skel h-4 w-24 rounded mt-2" />
      </div>

      <SkeletonRows rows={rows} />
    </div>
  );
}
