// Server-renderable SVG — no client JS, no chart library. Every number here
// comes straight from get_daily_revenue (Postgres); this file only draws
// what the RPC already computed. Liquid Glass palette: the accent line/area
// use --glass-accent (purple), everything else stays neutral so the accent
// reads as the one thing worth looking at, not decoration everywhere.
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

// Catmull-Rom → cubic-bezier smoothing so the trend line curves gently
// through each real data point instead of a jagged polyline — purely a
// rendering choice, the underlying values are exact.
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export function RevenueTrendChart({ days, todayIso }: { days: DayPoint[]; todayIso: string }) {
  const max = Math.max(...days.map((d) => d.revenue_mvr), 1);
  const total = days.reduce((s, d) => s + d.revenue_mvr, 0);
  const totalOrders = days.reduce((s, d) => s + d.orders_count, 0);
  const avg = total / days.length;
  const todayPoint = days.find((d) => d.day_date === todayIso);
  const prevPoint = days[days.length - 2];
  const changePct = prevPoint && prevPoint.revenue_mvr > 0 && todayPoint
    ? ((todayPoint.revenue_mvr - prevPoint.revenue_mvr) / prevPoint.revenue_mvr) * 100
    : null;

  const n = days.length;
  const plotH = 100; // viewBox units
  const points = days.map((d, i) => ({
    x: n > 1 ? (i / (n - 1)) * 100 : 50,
    y: plotH - (max > 0 ? (d.revenue_mvr / max) * (plotH - 8) : 0) - 4, // 4px headroom top/bottom
  }));
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${points[n - 1].x},${plotH} L ${points[0].x},${plotH} Z`;

  // Orders sparkline — a second, smaller trend beneath the revenue area so
  // the card shows volume alongside value, not just one metric.
  const maxOrders = Math.max(...days.map((d) => d.orders_count), 1);

  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Revenue — Last {n} Days
          </p>
          <p className="text-[22px] font-bold leading-tight snm-num mt-1" style={{ color: "var(--foreground)" }}>
            {mvrShort(total)} <span className="text-[13px] font-medium" style={{ color: "var(--muted-foreground)" }}>MVR total</span>
          </p>
        </div>
        {changePct !== null && (
          <div
            className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-full"
            style={{
              background: changePct >= 0 ? "var(--status-success-bg)" : "var(--status-danger-bg)",
              color: changePct >= 0 ? "var(--status-success)" : "var(--status-danger)",
            }}
          >
            <span className="ios-caption1 font-semibold snm-num">
              {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Revenue trend — smooth line + gradient area, accent purple */}
      <div className="relative mt-4" style={{ height: 100 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id="revenueArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--glass-accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--glass-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Average reference line */}
          <line
            x1="0" x2="100"
            y1={plotH - (max > 0 ? (avg / max) * (plotH - 8) : 0) - 4}
            y2={plotH - (max > 0 ? (avg / max) * (plotH - 8) : 0) - 4}
            stroke="var(--glass-divider)" strokeWidth="0.5" strokeDasharray="2,2"
          />
          <path d={areaPath} fill="url(#revenueArea)" />
          <path d={linePath} fill="none" stroke="var(--glass-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => {
            const isToday = days[i].day_date === todayIso;
            return (
              <circle
                key={days[i].day_date}
                cx={p.x} cy={p.y}
                r={isToday ? 3 : 1.6}
                fill={isToday ? "var(--glass-accent)" : "var(--background)"}
                stroke="var(--glass-accent)"
                strokeWidth={isToday ? 0 : 1.4}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      </div>

      <div className="flex mt-1.5">
        {days.map((d) => {
          const isToday = d.day_date === todayIso;
          return (
            <div key={d.day_date} className="flex-1 text-center min-w-0">
              <p className="ios-caption1" style={{ color: isToday ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: isToday ? 700 : 400 }}>
                {d.day_label}
              </p>
            </div>
          );
        })}
      </div>

      {/* Orders volume — a second real metric, small bar row beneath the
          revenue trend, so the card reads as analytics, not one chart. */}
      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--glass-divider)" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="ios-caption1 font-medium" style={{ color: "var(--muted-foreground)" }}>Orders</p>
          <p className="ios-caption1 font-semibold snm-num" style={{ color: "var(--foreground)" }}>{totalOrders} total</p>
        </div>
        <div className="flex items-end gap-[3px]" style={{ height: 24 }}>
          {days.map((d) => {
            const h = maxOrders > 0 ? Math.max((d.orders_count / maxOrders) * 100, d.orders_count > 0 ? 12 : 4) : 4;
            const isToday = d.day_date === todayIso;
            return (
              <div key={d.day_date} className="flex-1" style={{ height: "100%", display: "flex", alignItems: "flex-end" }}>
                <div
                  style={{
                    width: "100%",
                    height: `${h}%`,
                    borderRadius: 2,
                    background: isToday ? "var(--glass-accent)" : "color-mix(in srgb, var(--foreground) 18%, transparent)",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
