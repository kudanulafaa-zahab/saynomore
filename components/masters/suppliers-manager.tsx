"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Search,
  Pencil,
  Trash2,
  Package,
  Globe,
  Phone,
  Mail,
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
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  type SupplierRow,
  type SupplierInput,
  type SupplierCurrency,
} from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";

const CURRENCIES: SupplierCurrency[] = ["IDR", "USD", "MVR", "MYR", "THB", "CNY", "EUR"];
const COMMON_COUNTRIES = ["Indonesia", "Malaysia", "Thailand", "China", "Singapore", "India", "Maldives", "Other"];

export function SuppliersManager() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; editing?: SupplierRow }>({ open: false });
  const [role, setRole] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setRows(await listSuppliers()); }
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
      [r.name, r.country, r.contact_name ?? "", r.contact_email ?? "", r.contact_phone ?? ""]
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
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Suppliers</h1>
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
          placeholder="Search suppliers…"
          className="pl-9 h-11"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Package className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">
            {rows.length === 0 ? "No suppliers yet" : "No matches"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {rows.length === 0
              ? "Add your Indonesian supplier (the one selling MamyPoko, Sosoft, etc.) here. You'll pick from this list when creating shipments."
              : "Try a different search."}
          </p>
          {rows.length === 0 && (
            <Button onClick={() => setDialog({ open: true })}>
              <Plus className="h-4 w-4 mr-2" />
              Create first supplier
            </Button>
          )}
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {filtered.map((s) => (
            <div key={s.id} className="p-4 flex items-start justify-between gap-3 hover:bg-accent/30 transition">
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-base font-medium text-foreground">{s.name}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Globe className="h-3 w-3" /> {s.country}
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono">
                    {s.invoice_currency}
                  </span>
                  {s.contact_phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {s.contact_phone}
                    </span>
                  )}
                  {s.contact_email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {s.contact_email}
                    </span>
                  )}
                </div>
                {s.contact_name && (
                  <p className="text-xs text-muted-foreground">Contact: {s.contact_name}</p>
                )}
                {s.notes && <p className="text-xs text-muted-foreground italic">{s.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setDialog({ open: true, editing: s })}
                  className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-secondary transition"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {isAdmin && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete supplier "${s.name}"?`)) return;
                      try { await deleteSupplier(s.id); toast.success("Deleted"); load(); }
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

      <SupplierDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(o) => setDialog({ open: o })}
        onSaved={load}
      />
    </div>
  );
}

function SupplierDialog({
  open, editing, onOpenChange, onSaved,
}: {
  open: boolean;
  editing?: SupplierRow;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("Indonesia");
  const [currency, setCurrency] = useState<SupplierCurrency>("IDR");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setCountry(editing?.country ?? "Indonesia");
      setCurrency(editing?.invoice_currency ?? "IDR");
      setContactName(editing?.contact_name ?? "");
      setPhone(editing?.contact_phone ?? "");
      setEmail(editing?.contact_email ?? "");
      setNotes(editing?.notes ?? "");
    }
  }, [open, editing]);

  async function save() {
    if (!name.trim()) return;
    const payload: SupplierInput = {
      name: name.trim(),
      country: country.trim(),
      invoice_currency: currency,
      contact_name: contactName.trim() || null,
      contact_phone: phone.trim() || null,
      contact_email: email.trim() || null,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      if (editing) await updateSupplier(editing.id, payload);
      else await createSupplier(payload);
      toast.success(editing ? "Saved" : "Supplier created");
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
          <DialogTitle>{editing ? "Edit Supplier" : "New Supplier"}</DialogTitle>
          <DialogDescription>The factory or vendor you import from.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="PT Indo FMCG" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Country *</Label>
              <Select value={country} onValueChange={(v) => v && setCountry(v)}>
                <SelectTrigger><SelectValue>{country}</SelectValue></SelectTrigger>
                <SelectContent>
                  {COMMON_COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Invoice Currency *</Label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v as SupplierCurrency)}>
                <SelectTrigger><SelectValue>{currency}</SelectValue></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Currency on supplier invoices.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Contact Name</Label>
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62…" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" />
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
