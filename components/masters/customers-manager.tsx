"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search, Pencil, Trash2, Phone, Mail, MapPin, Filter } from "lucide-react";
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
  type CustomerRow, type CustomerInput, type CustomerChannel,
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

  async function load() {
    setLoading(true);
    try { setRows(await listCustomers()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);
  const isAdmin = role === "admin";

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
      <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: "#8e9192" }}>
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
          <h1 className="text-[28px] font-semibold tracking-tight text-white">Customer Directory</h1>
          <p className="text-sm mt-1" style={{ color: "#8e9192" }}>
            Manage and track your logistics partners and clients.
          </p>
        </div>
        <button
          onClick={() => setDialog({ open: true })}
          className="flex items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold transition active:scale-95"
          style={{ background: "#ffffff", color: "#2f3131" }}
        >
          <Plus className="h-4 w-4" />
          Add New Customer
        </button>
      </div>

      {/* Search */}
      <div
        className="flex items-center rounded-2xl px-4 gap-3"
        style={{ background: "rgba(18,19,23,0.70)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)", height: 52 }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "#8e9192" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, phone, island…"
          className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder:text-opacity-40"
          style={{ color: "#e5e2e1" }}
        />
        <Filter className="h-4 w-4 shrink-0" style={{ color: "#8e9192" }} />
      </div>

      {/* Stats bento */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "rgba(18,19,23,0.70)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)", minHeight: 140 }}
        >
          <p className="label-caps text-[10px]" style={{ color: "#8e9192" }}>Active Clients</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-white">{rows.length.toLocaleString()}</span>
          </div>
        </div>
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "rgba(18,19,23,0.70)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)", minHeight: 140 }}
        >
          <p className="label-caps text-[10px]" style={{ color: "#8e9192" }}>Avg. Lifetime Value</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-light tracking-tight text-white">—</span>
            <span className="text-sm" style={{ color: "#8e9192" }}>MVR</span>
          </div>
        </div>
        <div
          className="rounded-3xl p-5 flex flex-col justify-between"
          style={{ background: "rgba(18,19,23,0.70)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)", minHeight: 140 }}
        >
          <p className="label-caps text-[10px]" style={{ color: "#8e9192" }}>Top Channel</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-2xl">💬</span>
            <span className="text-lg font-semibold text-white">{topChannel}</span>
          </div>
        </div>
      </div>

      {/* Customer list */}
      {filtered.length === 0 ? (
        <div
          className="rounded-3xl p-12 text-center space-y-4"
          style={{ background: "rgba(18,19,23,0.70)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="text-base font-semibold text-white">
            {rows.length === 0 ? "No customers yet" : "No matches"}
          </p>
          <p className="text-sm" style={{ color: "#8e9192" }}>
            {rows.length === 0
              ? "Add your first customer to get started."
              : "Try a different search term."}
          </p>
          {rows.length === 0 && (
            <button
              onClick={() => setDialog({ open: true })}
              className="px-5 py-2.5 rounded-full text-sm font-semibold"
              style={{ background: "#ffffff", color: "#2f3131" }}
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
              style={{ background: "rgba(18,19,23,0.70)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className="flex items-center justify-between gap-4">
                {/* Avatar + name */}
                <div className="flex items-center gap-4 min-w-0">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-sm font-bold"
                    style={{ background: "rgba(255,255,255,0.10)", color: "#e5e2e1" }}
                  >
                    {getInitials(c.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-white">{c.name}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {c.channel && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "rgba(255,255,255,0.08)", color: "#c4c7c8" }}
                        >
                          {channelIcon(c.channel)} {CHANNEL_LABEL[c.channel] ?? c.channel}
                        </span>
                      )}
                      {c.phone && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "rgba(255,255,255,0.08)", color: "#c4c7c8" }}
                        >
                          <Phone className="h-2.5 w-2.5" /> {c.phone}
                        </span>
                      )}
                      {c.island && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: "rgba(255,255,255,0.08)", color: "#c4c7c8" }}
                        >
                          <MapPin className="h-2.5 w-2.5" /> {c.island}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setDialog({ open: true, editing: c })}
                    className="p-2 rounded-lg transition"
                    style={{ color: "#8e9192" }}
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {isAdmin && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete "${c.name}"?`)) return;
                        try { await deleteCustomer(c.id); toast.success("Deleted"); load(); }
                        catch (e) { toast.error((e as Error).message); }
                      }}
                      className="p-2 rounded-lg transition hover:text-red-400"
                      style={{ color: "#8e9192" }}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Extra row */}
              {(c.company || c.email) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  {c.company && (
                    <p className="text-xs" style={{ color: "#8e9192" }}>{c.company}</p>
                  )}
                  {c.email && (
                    <p className="text-xs flex items-center gap-1" style={{ color: "#8e9192" }}>
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
  const [channel, setChannel] = useState<CustomerChannel | "">("whatsapp");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setCompany(editing?.company ?? "");
      setPhone(editing?.phone ?? "");
      setEmail(editing?.email ?? "");
      setIsland(editing?.island ?? "");
      setAddress(editing?.address ?? "");
      setChannel(editing?.channel ?? "whatsapp");
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
      <DialogContent
        className="max-w-lg border-white/10"
        style={{ background: "rgba(18,19,23,0.95)", backdropFilter: "blur(40px)", color: "#e5e2e1" }}
      >
        <DialogHeader>
          <DialogTitle className="text-white">{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          <DialogDescription style={{ color: "#8e9192" }}>
            {editing ? "Update customer details." : "Register a new contact."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest" style={{ color: "#8e9192" }}>Full Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest" style={{ color: "#8e9192" }}>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+960…" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest" style={{ color: "#8e9192" }}>Channel</Label>
              <Select value={channel} onValueChange={(v) => v && setChannel(v as CustomerChannel)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue>{CHANNEL_LABEL[channel] ?? "Pick"}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-[#1c1b1b] border-white/10">
                  {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value} className="text-white focus:bg-white/10">{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest" style={{ color: "#8e9192" }}>Island</Label>
              <Input value={island} onChange={(e) => setIsland(e.target.value)} placeholder="Malé…" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest" style={{ color: "#8e9192" }}>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest" style={{ color: "#8e9192" }}>Company / Shop</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest" style={{ color: "#8e9192" }}>Address</Label>
            <Textarea value={address} onChange={(e) => setAddress(e.target.value)} className="bg-white/5 border-white/10 text-white min-h-[50px]" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest" style={{ color: "#8e9192" }}>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-white/5 border-white/10 text-white min-h-[50px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/60 hover:text-white hover:bg-white/10">
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !name.trim()}
            className="font-semibold"
            style={{ background: "#ffffff", color: "#2f3131" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
