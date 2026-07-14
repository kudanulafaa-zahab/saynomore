// Server-renderable SVG bar chart — no client JS, no chart library. Matches
// skills.md: monochrome by default, color only when it means something
// (today's bar is the brand accent; nothing is colored for decoration).
interface DayPoint {
  day_label: string;
  day_date: string;
  revenue_mvr: number;
  orders_count: number;
}

function mvrShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function RevenueTrendChart({ days, todayIso }: { days: DayPoint[]; todayIso: string }) {
  const max = Math.max(...days.map((d) => d.revenue_mvr), 1);
  const total = days.reduce((s, d) => s + d.revenue_mvr, 0);
  const avg = total / days.length;

  // Layout: fixed viewBox, bars computed as percentages so it scales cleanly
  // at any container width without client-side measurement.
  const barCount = days.length;
  const gap = 3;
  const barWidth = (100 - gap * (barCount - 1)) / barCount;

  return (
    <div className="snm-card rounded-2xl p-5" style={{ border: "0.5px solid var(--glass-border-lo)" }}>
      <div className="flex items-center justify-between mb-1">
        <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          Last {barCount} Days
        </p>
        <p className="ios-caption1 font-semibold snm-num" style={{ color: "var(--muted-foreground)" }}>
          avg {mvrShort(avg)} MVR/day
        </p>
      </div>

      <div className="relative mt-4" style={{ height: 88 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style={{ overflow: "visible" }}>
          {days.map((d, i) => {
            const x = i * (barWidth + gap);
            const h = max > 0 ? Math.max((d.revenue_mvr / max) * 100, d.revenue_mvr > 0 ? 4 : 1.5) : 1.5;
            const isToday = d.day_date === todayIso;
            const hasRevenue = d.revenue_mvr > 0;
            return (
              <rect
                key={d.day_date}
                x={x}
                y={100 - h}
                width={barWidth}
                height={h}
                rx={barWidth * 0.35}
                fill={
                  isToday
                    ? "var(--snm-brand)"
                    : hasRevenue
                      ? "color-mix(in srgb, var(--foreground) 30%, transparent)"
                      : "color-mix(in srgb, var(--foreground) 10%, transparent)"
                }
              />
            );
          })}
        </svg>
      </div>

      <div className="flex mt-2" style={{ gap }}>
        {days.map((d) => {
          const isToday = d.day_date === todayIso;
          return (
            <div key={d.day_date} className="flex-1 text-center min-w-0">
              <p
                className="ios-caption1"
                style={{
                  color: isToday ? "var(--foreground)" : "var(--muted-foreground)",
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {d.day_label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
