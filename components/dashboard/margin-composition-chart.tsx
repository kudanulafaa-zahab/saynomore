// Server-renderable SVG donut — visualizes how this month's revenue splits
// into cost, expenses, and net profit. Every value comes straight from
// get_pnl (Postgres); this component only draws proportions, it computes
// nothing financial. Liquid Glass palette: COGS/expenses read as neutral
// (structural, not a status), net profit reads green/red by sign — color
// still only carries real meaning, same law as everywhere else in the app.
interface MarginCompositionProps {
  revenueMvr: number;
  cogsMvr: number;      // revenue - grossProfit
  otherCostsMvr: number; // grossProfit - netProfit (marketing + opex)
  netProfitMvr: number;
  netMarginPct: number | null;
}

function mvrShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Describes an SVG arc for a donut segment given a start/end fraction (0-1).
function arcPath(cx: number, cy: number, r: number, startFrac: number, endFrac: number): string {
  const a0 = (startFrac * 360 - 90) * (Math.PI / 180);
  const a1 = (endFrac * 360 - 90) * (Math.PI / 180);
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const largeArc = endFrac - startFrac > 0.5 ? 1 : 0;
  return `M ${x0},${y0} A ${r},${r} 0 ${largeArc} 1 ${x1},${y1}`;
}

export function MarginCompositionChart({ revenueMvr, cogsMvr, otherCostsMvr, netProfitMvr, netMarginPct }: MarginCompositionProps) {
  if (revenueMvr <= 0) return null;

  const cogsFrac   = Math.max(cogsMvr, 0) / revenueMvr;
  const costsFrac  = Math.max(otherCostsMvr, 0) / revenueMvr;
  const netFrac    = Math.max(netProfitMvr, 0) / revenueMvr;
  // Guard against float drift so the ring always closes at exactly 1.0
  const total = cogsFrac + costsFrac + netFrac;
  const scale = total > 0 ? 1 / total : 1;

  const cx = 50, cy = 50, r = 38, strokeW = 14;
  let cursor = 0;
  const segments = [
    { frac: cogsFrac * scale,  color: "color-mix(in srgb, var(--foreground) 22%, transparent)", label: "Landed Cost" },
    { frac: costsFrac * scale, color: "color-mix(in srgb, var(--foreground) 40%, transparent)",  label: "Marketing + Opex" },
    { frac: Math.max(netFrac * scale, 0), color: netProfitMvr >= 0 ? "var(--glass-accent)" : "var(--status-danger)", label: "Net Profit" },
  ].map((s) => {
    const seg = { ...s, start: cursor, end: cursor + s.frac };
    cursor += s.frac;
    return seg;
  });

  return (
    <div className="glass-panel rounded-2xl p-5">
      <p className="label-caps text-[12px] mb-4" style={{ color: "var(--muted-foreground)" }}>
        Where This Month&apos;s Revenue Went
      </p>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0" style={{ width: 112, height: 112 }}>
          <svg viewBox="0 0 100 100" width="112" height="112">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--glass-divider)" strokeWidth={strokeW} />
            {segments.filter((s) => s.frac > 0.001).map((s) => (
              <path
                key={s.label}
                d={arcPath(cx, cy, r, s.start, s.end)}
                fill="none"
                stroke={s.color}
                strokeWidth={strokeW}
                strokeLinecap={segments.filter((x) => x.frac > 0.001).length > 1 ? "butt" : "round"}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-[18px] font-bold leading-none snm-num" style={{ color: netProfitMvr >= 0 ? "var(--foreground)" : "var(--status-danger)" }}>
              {netMarginPct != null ? `${netMarginPct.toFixed(0)}%` : "—"}
            </p>
            <p className="ios-caption1 mt-0.5" style={{ color: "var(--muted-foreground)" }}>net</p>
          </div>
        </div>

        <div className="flex-1 space-y-2.5 min-w-0">
          {[
            { color: "color-mix(in srgb, var(--foreground) 22%, transparent)", label: "Landed Cost", value: cogsMvr },
            { color: "color-mix(in srgb, var(--foreground) 40%, transparent)", label: "Marketing + Opex", value: otherCostsMvr },
            { color: netProfitMvr >= 0 ? "var(--glass-accent)" : "var(--status-danger)", label: "Net Profit", value: netProfitMvr },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <span className="rounded-full shrink-0" style={{ width: 8, height: 8, background: row.color }} />
              <p className="ios-caption1 flex-1 truncate" style={{ color: "var(--muted-foreground)" }}>{row.label}</p>
              <p className="ios-caption1 font-semibold snm-num shrink-0" style={{ color: "var(--foreground)" }}>
                {mvrShort(row.value)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
