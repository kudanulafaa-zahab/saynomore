"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  listMarketingSpend, deleteMarketingSpend,
  type MarketingSpendRow,
} from "@/lib/queries/expenses";
import { listSkusFlat, getCurrentUserRole, type SkuFullRow } from "@/lib/queries/products";
import { SpendSheet } from "@/components/expenses/expenses-view";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";

function fmt(n: number) {
  return Number(n).toLocaleString("en-MV", { maximumFractionDigits: 0 });
}

/** Campaigns — the acting half of the promotion loop. The Promo Advisor
 *  above suggests what to promote; this is where the campaign gets logged.
 *  Spend recorded here posts into the Expenses ledger (marketing_spend) and
 *  is pro-rated into the P&L automatically — Market decides, Expenses records. */
export function CampaignsCard() {
  const [rows, setRows] = useState<MarketingSpendRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; editing?: MarketingSpendRow }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<MarketingSpendRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const [r, s] = await Promise.all([listMarketingSpend(), listSkusFlat()]);
      setRows(r);
      setSkus(s);
    } catch (e) { toast.error((e as Error).message); }
  }
  useEffect(() => {
    load();
    getCurrentUserRole().then((r) => setCanWrite(r !== "viewer")).catch(() => {});
  }, []);

  const total = rows.reduce((a, r) => a + Number(r.amount_mvr), 0);

  return (
    <div className="snm-card p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>Campaigns</p>
        {canWrite && (
          <button
            onClick={() => setSheet({ open: true })}
            className="snm-pressable flex items-center gap-1.5 rounded-full px-3 py-1.5 ios-footnote font-semibold"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-3.5 w-3.5" /> Log Campaign
          </button>
        )}
      </div>
      <p className="ios-footnote mb-3" style={{ color: "var(--muted-foreground)" }}>
        {rows.length === 0
          ? "Ran a promo? Log it here — the spend posts to Expenses and the P&L automatically."
          : `MVR ${fmt(total)} across ${rows.length} campaign${rows.length === 1 ? "" : "s"} · spend posts to Expenses automatically.`}
      </p>

      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.slice(0, 5).map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}>
              <div className="min-w-0 flex-1">
                <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                  {r.campaign_name ?? "Campaign"}
                </p>
                <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
                  {new Date(r.start_date).toLocaleDateString("en-MV", { day: "numeric", month: "short" })}
                  {" · "}MVR {fmt(Number(r.amount_mvr))}
                </p>
              </div>
              {canWrite && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setSheet({ open: true, editing: r })}
                    aria-label="Edit campaign"
                    className="snm-pressable w-11 h-11 -m-1 flex items-center justify-center">
                    <Pencil className="h-3.5 w-3.5" style={{ color: "var(--muted-foreground)" }} />
                  </button>
                  <button onClick={() => setDeleteTarget(r)}
                    aria-label="Delete campaign"
                    className="snm-pressable w-11 h-11 -m-1 flex items-center justify-center">
                    <Trash2 className="h-3.5 w-3.5" style={{ color: "var(--snm-error)" }} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sheet.open && (
        <SpendSheet
          editing={sheet.editing}
          skus={skus}
          onClose={() => setSheet({ open: false })}
          onDone={() => { setSheet({ open: false }); load(); }}
        />
      )}

      <ConfirmSheet
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            await deleteMarketingSpend(deleteTarget.id);
            toast.success("Campaign deleted");
            setDeleteTarget(null);
            load();
          } catch (e) { toast.error((e as Error).message); }
          finally { setDeleting(false); }
        }}
        loading={deleting}
        title="Delete campaign?"
        message={deleteTarget ? `${deleteTarget.campaign_name ?? "This campaign"} · MVR ${fmt(Number(deleteTarget.amount_mvr))} will be permanently removed.` : ""}
        confirmLabel="Delete"
      />
    </div>
  );
}
