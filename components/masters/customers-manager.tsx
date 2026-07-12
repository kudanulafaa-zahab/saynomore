"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import { Loader2, Plus, Search, Pencil, Trash2, Phone, Mail, MapPin, X, MessageCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  listCustomers, deleteCustomer,
  type CustomerRow, type CustomerChannel, type PriceTier,
} from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";
import { CustomerForm } from "@/components/masters/customer-form";
import { SkeletonRows } from "@/components/layout/page-skeleton";
import { haptic } from "@/lib/haptics";

const CHANNELS: { value: CustomerChannel; label: string }[] = [
  { value: "whatsapp",  label: "WhatsApp" },
  { value: "viber",     label: "Viber" },
  { value: "messenger", label: "Messenger" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok",    label: "TikTok" },
  { value: "facebook",  label: "Facebook" },
  { value: "phone",     label: "Phone" },
  { value: "walkin",    label: "Walk-in" },
  { value: "other",     label: "Other" },
];

const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

// Non-hierarchical peer categories — dedicated --snm-tag-* palette, never the
// semantic tokens (a price tier isn't "primary action"/"attention"/"good money").
const TIERS: { value: PriceTier; label: string; color: string }[] = [
  { value: "retail",    label: "Retail",    color: "var(--muted-foreground)" },
  { value: "wholesale", label: "Wholesale", color: "var(--snm-tag-slate)" },
  { value: "vip",       label: "VIP",       color: "var(--snm-tag-violet)" },
  { value: "promo",     label: "Promo",     color: "var(--snm-tag-sage)" },
];
const TIER_MAP = Object.fromEntries(TIERS.map((t) => [t.value, t]));

function channelIcon(ch: string | null) {
  if (!ch) return "person";
  if (ch === "whatsapp") return "💬";
  if (ch === "viber") return "📱";
  return ch.charAt(0).toUpperCase();
}

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export function CustomersManager() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; editing?: CustomerRow }>({ open: false });
  const [role, setRole] = useState<string | null>(null);
  const [confirmCustomer, setConfirmCustomer] = useState<{ id: string; name: string } | null>(null);

  async function load() {
    try { setRows(await listCustomers()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);
  const isAdmin = role === "admin";
  const canWrite = role !== "viewer" && role !== null;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.name, r.company ?? "", r.phone ?? "", r.email ?? "", r.island ?? ""]
        .join(" ").toLowerCase().includes(term),
    );
  }, [rows, q]);

  // Stats
  const topChannel = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => { if (r.channel) counts[r.channel] = (counts[r.channel] ?? 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? CHANNEL_LABEL[top[0]] ?? top[0] : "—";
  }, [rows]);

  if (loading) {
    return <SkeletonRows rows={7} />;
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="ios-page-title">Customer Directory</h1>
          <p className="ios-subhead mt-1 text-muted-foreground">
            Your shops and customers, with contact details and price tiers.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setDialog({ open: true })}
            className="flex items-center gap-2 h-11 px-5 rounded-2xl text-sm font-semibold transition active:scale-95 shrink-0"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Customer</span>
            <span className="sm:hidden">Add</span>
          </button>
        )}
      </div>

      {/* Search */}
      <div
        className="flex items-center rounded-2xl px-4 gap-3"
        style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", height: 52 }}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, phone, island…"
          aria-label="Search customers"
          className="flex-1 bg-transparent border-none outline-none ios-subhead text-foreground placeholder:text-muted-foreground"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:opacity-60"
            style={{ color: "var(--muted-foreground)" }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Stats bento */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[12px] text-muted-foreground">Active Clients</p>
          <div className="flex items-baseline gap-2">
            <span className="snm-num text-4xl font-semibold text-foreground">{rows.length.toLocaleString()}</span>
          </div>
        </div>
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[12px] text-muted-foreground">Avg. Lifetime Value</p>
          <div className="flex items-baseline gap-2">
            <span className="snm-num text-3xl font-light tracking-tight text-foreground">—</span>
            <span className="ios-subhead text-muted-foreground">MVR</span>
          </div>
        </div>
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[12px] text-muted-foreground">Top Channel</p>
          <div className="flex items-center gap-3 mt-2">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--glass-bg-2)" }}>
              <MessageCircle className="h-4 w-4 text-foreground" />
            </div>
            <span className="text-lg font-semibold text-foreground">{topChannel}</span>
          </div>
        </div>
      </div>

      {/* Customer list */}
      {filtered.length === 0 ? (
        <div
          className="rounded-3xl p-12 text-center space-y-4"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
        >
          <p className="text-base font-semibold text-foreground">
            {rows.length === 0 ? "No customers yet" : "No matches"}
          </p>
          <p className="ios-subhead text-muted-foreground">
            {rows.length === 0
              ? "Add your first customer to get started."
              : "Try a different search term."}
          </p>
          {rows.length === 0 && canWrite && (
            <button
              onClick={() => setDialog({ open: true })}
              className="px-5 py-2.5 rounded-full ios-subhead font-semibold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Add first customer
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="snm-pressable rounded-3xl p-5 cursor-pointer"
              style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
            >
              <div className="flex items-center justify-between gap-4">
                {/* Avatar + name */}
                <div className="flex items-center gap-4 min-w-0">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-sm font-bold"
                    style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
                  >
                    {getInitials(c.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-foreground">{c.name}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {/* Price tier badge */}
                      {(() => {
                        const t = TIER_MAP[c.price_tier ?? "retail"];
                        return (
                          <span
                            className="ios-subhead font-bold px-2 py-0.5 rounded-full"
                            style={{ background: `color-mix(in srgb, ${t.color} 15%, transparent)`, color: t.color }}
                          >
                            {t.label}
                          </span>
                        );
                      })()}
                      {c.channel && (
                        <span
                          className="ios-subhead font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          {channelIcon(c.channel)} {CHANNEL_LABEL[c.channel] ?? c.channel}
                        </span>
                      )}
                      {c.phone && (
                        <span
                          className="snm-num ios-subhead font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          <Phone className="h-2.5 w-2.5" /> {c.phone}
                        </span>
                      )}
                      {c.island && (
                        <span
                          className="ios-subhead font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          <MapPin className="h-2.5 w-2.5" /> {c.island}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {canWrite && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setDialog({ open: true, editing: c })}
                      aria-label={`Edit ${c.name}`}
                      className="snm-pressable flex items-center justify-center rounded-xl"
                      style={{ width: 44, height: 44, background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmCustomer({ id: c.id, name: c.name })}
                      aria-label={`Delete ${c.name}`}
                      className="snm-pressable flex items-center justify-center rounded-xl"
                      style={{ width: 44, height: 44, background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Extra row */}
              {(c.company || c.email) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                  {c.company && (
                    <p className="ios-subhead text-muted-foreground">{c.company}</p>
                  )}
                  {c.email && (
                    <p className="ios-subhead flex items-center gap-1 text-muted-foreground">
                      <Mail className="h-3 w-3" /> {c.email}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <CustomerDialog
        open={dialog.open}
        editing={dialog.editing}
        customers={rows}
        onOpenChange={(o) => setDialog({ open: o })}
        onSaved={load}
      />

      <ConfirmSheet
        open={confirmCustomer !== null}
        onClose={() => setConfirmCustomer(null)}
        title="Delete customer?"
        message={confirmCustomer ? `"${confirmCustomer.name}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmCustomer) return;
          try { await deleteCustomer(confirmCustomer.id); haptic("success"); toast.success("Deleted"); setConfirmCustomer(null); load(); }
          catch (e) { haptic("error"); toast.error((e as Error).message); }
        }}
      />
    </div>
  );
}

function CustomerDialog({
  open, editing, customers, onOpenChange, onSaved,
}: {
  open: boolean;
  editing?: CustomerRow;
  customers: CustomerRow[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent selfManaged className="sm:max-w-lg">
        <DialogHeader className="px-5 pt-2 pb-3 shrink-0">
          <DialogTitle>{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update customer details." : "Register a new contact."}
          </DialogDescription>
        </DialogHeader>
        <CustomerForm
          key={`${editing?.id ?? "new"}-${open}`}
          editing={editing}
          existing={customers}
          onPickExisting={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
          onSaved={() => { onOpenChange(false); onSaved(); }}
        />
      </DialogContent>
    </Dialog>
  );
}

