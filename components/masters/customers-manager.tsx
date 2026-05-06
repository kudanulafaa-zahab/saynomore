"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Search,
  Pencil,
  Trash2,
  Users,
  Phone,
  Mail,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type CustomerRow,
  type CustomerInput,
  type CustomerChannel,
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
      [r.name, r.company ?? "", r.phone ?? "", r.email ?? "", r.island ?? "", r.address ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [rows, q]);

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Master Data</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Customers</h1>
        </div>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4 mr-2" />
          New
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, phone, island…"
          className="pl-9 h-11"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Users className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">
            {rows.length === 0 ? "No customers yet" : "No matches"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {rows.length === 0
              ? "Add your customers as they place orders. Recents will show first when creating sales."
              : "Try a different search."}
          </p>
          {rows.length === 0 && (
            <Button onClick={() => setDialog({ open: true })}>
              <Plus className="h-4 w-4 mr-2" />
              Create first customer
            </Button>
          )}
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {filtered.map((c) => (
            <div key={c.id} className="p-4 flex items-start justify-between gap-3 hover:bg-accent/30 transition">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-base font-medium text-foreground">{c.name}</p>
                  {c.company && <span className="text-xs text-muted-foreground">· {c.company}</span>}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {c.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {c.phone}
                    </span>
                  )}
                  {c.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {c.email}
                    </span>
                  )}
                  {c.island && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {c.island}
                    </span>
                  )}
                  {c.channel && (
                    <span className="inline-flex items-center gap-1">
                      {CHANNEL_LABEL[c.channel] ?? c.channel}
                    </span>
                  )}
                </div>
                {c.address && <p className="text-xs text-muted-foreground">{c.address}</p>}
                {c.notes && <p className="text-xs text-muted-foreground italic">{c.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setDialog({ open: true, editing: c })}
                  className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-secondary transition"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {isAdmin && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete customer "${c.name}"?`)) return;
                      try { await deleteCustomer(c.id); toast.success("Deleted"); load(); }
                      catch (e) { toast.error((e as Error).message); }
                    }}
                    className="p-2 rounded-lg text-muted-foreground/70 hover:text-red-500 hover:bg-red-500/10 transition"
                    title="Delete (admin)"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
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
      <DialogContent className="bg-popover border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          <DialogDescription>The person or shop you sell to.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+960…" />
            </div>
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => v && setChannel(v as CustomerChannel)}>
                <SelectTrigger><SelectValue>{CHANNEL_LABEL[channel] ?? "Pick"}</SelectValue></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Island</Label>
              <Input value={island} onChange={(e) => setIsland(e.target.value)} placeholder="Malé, Hulhumalé…" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Company / Shop</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Textarea value={address} onChange={(e) => setAddress(e.target.value)} className="min-h-[50px]" />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[50px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
