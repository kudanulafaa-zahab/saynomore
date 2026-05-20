"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import { Loader2, Plus, Search, Pencil, Trash2, Phone, Mail, MapPin, X, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  listCustomers, createCustomer, updateCustomer, deleteCustomer,
  type CustomerRow, type CustomerInput, type CustomerChannel, type PriceTier,
} from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";

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

const TIERS: { value: PriceTier; label: string; color: string }[] = [
  { value: "retail",    label: "Retail",    color: "var(--muted-foreground)" },
  { value: "wholesale", label: "Wholesale", color: "var(--snm-warning)" },
  { value: "vip",       label: "VIP",       color: "var(--snm-brand)" },
  { value: "promo",     label: "Promo",     color: "var(--snm-success)" },
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
    setLoading(true);
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
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Customer Directory</h1>
          <p className="text-sm mt-1 text-muted-foreground">
            Manage and track your logistics partners and clients.
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
        style={{ background: "var(--glass-bg-1)", backdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", height: 52 }}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, phone, island…"
          aria-label="Search customers"
          className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
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
          style={{ background: "var(--glass-bg-1)", backdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[11px] text-muted-foreground">Active Clients</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-foreground">{rows.length.toLocaleString()}</span>
          </div>
        </div>
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "var(--glass-bg-1)", backdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[11px] text-muted-foreground">Avg. Lifetime Value</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-light tracking-tight text-foreground">—</span>
            <span className="text-sm text-muted-foreground">MVR</span>
          </div>
        </div>
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "var(--glass-bg-1)", backdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)", minHeight: 140 }}
        >
          <p className="label-caps text-[11px] text-muted-foreground">Top Channel</p>
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
          style={{ background: "var(--glass-bg-1)", backdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
        >
          <p className="text-base font-semibold text-foreground">
            {rows.length === 0 ? "No customers yet" : "No matches"}
          </p>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Add your first customer to get started."
              : "Try a different search term."}
          </p>
          {rows.length === 0 && canWrite && (
            <button
              onClick={() => setDialog({ open: true })}
              className="px-5 py-2.5 rounded-full text-sm font-semibold"
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
              className="rounded-3xl p-5 transition cursor-pointer"
              style={{ background: "var(--glass-bg-1)", backdropFilter: "var(--glass-blur)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow), var(--glass-inner)" }}
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
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: `color-mix(in srgb, ${t.color} 15%, transparent)`, color: t.color }}
                          >
                            {t.label}
                          </span>
                        );
                      })()}
                      {c.channel && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          {channelIcon(c.channel)} {CHANNEL_LABEL[c.channel] ?? c.channel}
                        </span>
                      )}
                      {c.phone && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          <Phone className="h-2.5 w-2.5" /> {c.phone}
                        </span>
                      )}
                      {c.island && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
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
                      className="flex items-center justify-center rounded-xl active:opacity-60"
                      style={{ width: 44, height: 44, color: "var(--muted-foreground)" }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmCustomer({ id: c.id, name: c.name })}
                      aria-label={`Delete ${c.name}`}
                      className="flex items-center justify-center rounded-xl active:opacity-60"
                      style={{ width: 44, height: 44, color: "var(--snm-error)" }}
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
                    <p className="text-xs text-muted-foreground">{c.company}</p>
                  )}
                  {c.email && (
                    <p className="text-xs flex items-center gap-1 text-muted-foreground">
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
          try { await deleteCustomer(confirmCustomer.id); toast.success("Deleted"); setConfirmCustomer(null); load(); }
          catch (e) { toast.error((e as Error).message); }
        }}
      />
    </div>
  );
}

function CustomerDialog({
  open, editing, onOpenChange, onSaved,
}: {
  open: boolean;
  editing?: CustomerRow;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [island, setIsland] = useState("");
  const [address, setAddress] = useState("");
  const [channel, setChannel]   = useState<CustomerChannel | "">("whatsapp");
  const [priceTier, setPriceTier] = useState<PriceTier>("retail");
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setCompany(editing?.company ?? "");
      setPhone(editing?.phone ?? "");
      setEmail(editing?.email ?? "");
      setIsland(editing?.island ?? "");
      setAddress(editing?.address ?? "");
      setChannel(editing?.channel ?? "whatsapp");
      setPriceTier(editing?.price_tier ?? "retail");
      setNotes(editing?.notes ?? "");
    }
  }, [open, editing]);

  async function save() {
    if (!name.trim()) return;
    const payload: CustomerInput = {
      name: name.trim(),
      company: company.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      island: island.trim() || null,
      address: address.trim() || null,
      channel: (channel || null) as CustomerChannel | null,
      price_tier: priceTier,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      if (editing) await updateCustomer(editing.id, payload);
      else await createCustomer(payload);
      toast.success(editing ? "Saved" : "Customer created");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update customer details." : "Register a new contact."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Full Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+960…" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Channel</Label>
              <Select value={channel} onValueChange={(v) => v && setChannel(v as CustomerChannel)}>
                <SelectTrigger>
                  <SelectValue>{CHANNEL_LABEL[channel] ?? "Pick"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* Price tier selector */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Price Tier</Label>
            <div className="grid grid-cols-4 gap-2">
              {TIERS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPriceTier(t.value)}
                  className="py-2 rounded-xl text-xs font-bold transition"
                  style={{
                    background: priceTier === t.value
                      ? `color-mix(in srgb, ${t.color} 18%, transparent)`
                      : "var(--glass-bg-1)",
                    color: priceTier === t.value ? t.color : "var(--muted-foreground)",
                    border: priceTier === t.value
                      ? `1px solid color-mix(in srgb, ${t.color} 35%, transparent)`
                      : "0.5px solid var(--glass-border-lo)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Island</Label>
              <Input value={island} onChange={(e) => setIsland(e.target.value)} placeholder="Malé…" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Company / Shop</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Address</Label>
            <Textarea value={address} onChange={(e) => setAddress(e.target.value)} className="min-h-[50px]" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[50px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !name.trim()}
            className="font-semibold"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
