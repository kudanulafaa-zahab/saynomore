"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Search,
  Pencil,
  Trash2,
  Globe,
  Phone,
  Mail,
  Package,
  ShieldCheck,
  ChevronRight,
  X,
} from "lucide-react";
import {
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  type SupplierRow,
  type SupplierInput,
  type SupplierCurrency,
} from "@/lib/queries/masters";
import { withOfflineFallback } from "@/lib/offline-write";
import { Sheet } from "@/components/ui/sheet";
import { haptic } from "@/lib/haptics";
import { getCurrentUserRole } from "@/lib/queries/products";
import { SkeletonRows } from "@/components/layout/page-skeleton";

const CARD = {
  background: "linear-gradient(180deg, var(--glass-fill-top), var(--glass-fill-bottom))",
  backdropFilter: "blur(calc(14px * var(--frost-b))) saturate(var(--glass-saturate))",
  WebkitBackdropFilter: "blur(calc(14px * var(--frost-b))) saturate(var(--glass-saturate))",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.65))",
  boxShadow: "inset 0 1px 1px var(--glass-specular), var(--glass-shadow)",
} as const;

const CURRENCIES: SupplierCurrency[] = ["IDR", "USD", "MVR", "MYR", "THB", "CNY", "EUR"];
const COMMON_COUNTRIES = ["Indonesia", "Malaysia", "Thailand", "China", "Singapore", "India", "Maldives", "Other"];

function GlassInput({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <input
        {...props}
        className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none placeholder:text-muted-foreground transition"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
      />
    </div>
  );
}

function GlassSelect({ label, value, onChange, children }: { label?: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-xl px-4 ios-subhead text-foreground outline-none appearance-none"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
      >
        {children}
      </select>
    </div>
  );
}

function GlassTextarea({ label, ...props }: { label?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="space-y-1.5">
      {label && <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>{label}</p>}
      <textarea
        {...props}
        className="w-full rounded-xl px-4 py-3 ios-subhead text-foreground outline-none placeholder:text-muted-foreground resize-none transition"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
        rows={3}
      />
    </div>
  );
}

export function SuppliersManager() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; editing?: SupplierRow }>({ open: false });
  const [role, setRole] = useState<string | null>(null);
  const [featured, setFeatured] = useState<SupplierRow | null>(null);
  const [confirmSupplier, setConfirmSupplier] = useState<{ id: string; name: string } | null>(null);

  async function load() {
    try {
      const data = await listSuppliers();
      setRows(data);
      setFeatured(data[0] ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);
  const isAdmin = role === "admin";
  const canWrite = role !== "viewer" && role !== null;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.name, r.country, r.contact_name ?? "", r.contact_email ?? "", r.contact_phone ?? ""]
        .join(" ").toLowerCase().includes(term),
    );
  }, [rows, q]);

  if (loading) {
    return <SkeletonRows rows={6} />;
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>Global Supply</p>
          <h1 className="ios-page-title">Vendor Intelligence</h1>
        </div>
        {canWrite && (
          <button
            onClick={() => setDialog({ open: true })}
            className="flex items-center gap-2 h-11 px-5 rounded-full text-sm font-bold transition active:scale-95"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-4 w-4" />
            Add Vendor
          </button>
        )}
      </div>

      {/* ── Search ── */}
      <div
        className="flex items-center gap-3 rounded-2xl px-4 h-12"
        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search suppliers…"
          aria-label="Search suppliers"
          className="flex-1 bg-transparent ios-subhead text-foreground placeholder:text-muted-foreground outline-none"
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

      {/* ── Empty state ── */}
      {rows.length === 0 ? (
        <div className="rounded-3xl p-10 flex flex-col items-center text-center space-y-3" style={CARD}>
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
            <Package className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground">No vendors yet</h3>
          <p className="ios-subhead max-w-sm" style={{ color: "var(--muted-foreground)" }}>
            Add your Indonesian supplier (MamyPoko, Sosoft, etc.) here. You&rsquo;ll pick from this list when creating shipments.
          </p>
          {canWrite && (
            <button
              onClick={() => setDialog({ open: true })}
              className="mt-2 h-11 px-6 rounded-full ios-subhead font-bold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Create first vendor
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── Featured Vendor Bento ── */}
          {featured && !q && (
            <section className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Main identity card */}
                <div
                  className="md:col-span-2 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between"
                  style={{ ...CARD, minHeight: 200 }}
                >
                  <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
                    <ShieldCheck className="w-24 h-24 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-[22px] font-semibold text-foreground tracking-tight">{featured.name}</h3>
                    <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      {featured.invoice_currency} · {featured.country}
                    </p>
                  </div>
                  <div className="flex gap-3 mt-6">
                    {featured.contact_phone && (
                      <a
                        href={`https://wa.me/${featured.contact_phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 h-11 px-6 rounded-full text-sm font-bold transition active:scale-95"
                        style={{ background: "var(--foreground)", color: "var(--background)" }}
                      >
                        <Phone className="h-4 w-4" />
                        WhatsApp
                      </a>
                    )}
                    {featured.contact_email && (
                      <a
                        href={`mailto:${featured.contact_email}`}
                        className="flex items-center gap-2 h-11 px-6 rounded-full text-sm font-bold transition"
                        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
                      >
                        <Mail className="h-4 w-4" />
                        Email
                      </a>
                    )}
                    {canWrite && (
                      <button
                        onClick={() => setDialog({ open: true, editing: featured })}
                        className="flex items-center gap-2 h-11 px-4 rounded-full ios-subhead transition"
                        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--muted-foreground)" }}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Reliability score — not yet computed from real shipment
                    history (needs lead-time/on-time data per supplier), so
                    this shows the same honest "not enough data" placeholder
                    as the other stats rather than a fabricated number. */}
                <div
                  className="rounded-3xl p-6 flex flex-col justify-center items-center text-center"
                  style={CARD}
                >
                  <p className="label-caps text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>RELIABILITY SCORE</p>
                  <p className="text-[16px] font-medium text-foreground" style={{ color: "var(--muted-foreground)" }}>Not enough data yet</p>
                </div>
              </div>

              {/* Performance stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Avg Lead Time", value: "—" },
                  { label: "Total Volume", value: "—" },
                  { label: "Currency", value: featured.invoice_currency },
                  { label: "Active Shipments", value: "—" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-2xl p-5" style={CARD}>
                    <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>{stat.label}</p>
                    <p className="text-[18px] font-semibold text-foreground">{stat.value}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Supplier List ── */}
          <div>
            <p className="label-caps text-[12px] mb-3 px-1" style={{ color: "var(--muted-foreground)" }}>
              {q ? "Search Results" : "All Vendors"}
            </p>
            <div className="space-y-3">
              {filtered.map((s, i) => (
                <div
                  key={s.id}
                  className="rounded-3xl p-5 transition"
                  style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-[16px] font-semibold text-foreground">{s.name}</h4>
                        {i === 0 && !q && (
                          <span
                            className="ios-subhead font-bold px-2 py-0.5 rounded-full"
                            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
                          >
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                        <span className="flex items-center gap-1">
                          <Globe className="h-3 w-3" /> {s.country} · {s.invoice_currency}
                        </span>
                        {s.contact_phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {s.contact_phone}
                          </span>
                        )}
                        {s.contact_email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {s.contact_email}
                          </span>
                        )}
                      </div>
                      {s.contact_name && (
                        <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>Contact: {s.contact_name}</p>
                      )}
                      {s.notes && (
                        <p className="ios-subhead mt-1 italic" style={{ color: "var(--muted-foreground)" }}>{s.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canWrite && (
                        <button
                          onClick={() => { setFeatured(s); setDialog({ open: true, editing: s }); }}
                          aria-label={`Edit ${s.name}`}
                          className="snm-pressable h-11 w-11 rounded-xl flex items-center justify-center"
                          style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => setConfirmSupplier({ id: s.id, name: s.name })}
                          aria-label={`Delete ${s.name}`}
                          className="snm-pressable h-11 w-11 rounded-xl flex items-center justify-center"
                          style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)" }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setFeatured(s)}
                        aria-label={`Feature ${s.name}`}
                        className="snm-pressable h-11 w-11 rounded-xl flex items-center justify-center"
                        style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Vendor Dialog ── */}
      {dialog.open && (
        <SupplierModal
          editing={dialog.editing}
          onClose={() => setDialog({ open: false })}
          onSaved={() => { setDialog({ open: false }); load(); }}
        />
      )}

      <ConfirmSheet
        open={confirmSupplier !== null}
        onClose={() => setConfirmSupplier(null)}
        title="Delete supplier?"
        message={confirmSupplier ? `"${confirmSupplier.name}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmSupplier) return;
          try { await deleteSupplier(confirmSupplier.id); haptic("success"); toast.success("Deleted"); setConfirmSupplier(null); load(); }
          catch (e) { haptic("error"); toast.error((e as Error).message); }
        }}
      />
    </div>
  );
}

// ── Supplier Modal ────────────────────────────────────────────────────────────

function SupplierModal({
  editing, onClose, onSaved,
}: {
  editing?: SupplierRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [country, setCountry] = useState(editing?.country ?? "Indonesia");
  const [currency, setCurrency] = useState<SupplierCurrency>(editing?.invoice_currency ?? "IDR");
  const [contactName, setContactName] = useState(editing?.contact_name ?? "");
  const [phone, setPhone] = useState(editing?.contact_phone ?? "");
  const [email, setEmail] = useState(editing?.contact_email ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);

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
      const { queued } = await withOfflineFallback(
        () => editing ? updateSupplier(editing.id, payload) : createSupplier(payload),
        editing
          ? { table: "suppliers", action: "update", payload: payload as unknown as Record<string, unknown>, match: { id: editing.id } }
          : { table: "suppliers", action: "insert", payload: payload as unknown as Record<string, unknown> },
      );
      haptic("success");
      toast.success(queued ? "Saved offline — will sync when connected" : editing ? "Saved" : "Vendor created");
      if (!queued) onSaved();
    } catch (err) {
      haptic("error");
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose}>
        <p className="text-[16px] font-bold text-foreground">
          {editing ? "Edit Vendor" : "New Vendor"}
        </p>

        <GlassInput label="COMPANY NAME *" value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder="PT Unicharm Indonesia" />

        <div className="grid grid-cols-2 gap-3">
          <GlassSelect label="COUNTRY" value={country} onChange={setCountry}>
            {COMMON_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </GlassSelect>
          <GlassSelect label="INVOICE CURRENCY" value={currency} onChange={(v) => setCurrency(v as SupplierCurrency)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </GlassSelect>
        </div>

        <GlassInput label="CONTACT NAME" value={contactName} onChange={(e) => setContactName((e.target as HTMLInputElement).value)} placeholder="Optional" />

        <div className="grid grid-cols-2 gap-3">
          <GlassInput label="PHONE / WHATSAPP" value={phone} onChange={(e) => setPhone((e.target as HTMLInputElement).value)} placeholder="+62…" inputMode="tel" />
          <GlassInput label="EMAIL" type="email" value={email} onChange={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </div>

        <GlassTextarea label="NOTES" value={notes} onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)} placeholder="Optional" />

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl ios-subhead font-semibold" style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : editing ? "Save Changes" : "Create Vendor"}
          </button>
        </div>
    </Sheet>
  );
}
