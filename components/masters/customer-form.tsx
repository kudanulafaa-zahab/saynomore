"use client";

/**
 * CustomerForm — the single canonical customer form used everywhere.
 *
 * Both the Customers directory (create/edit) and the Sales wizard (new customer
 * mid-order) render this exact component, so the fields, order, and look are
 * identical and stay identical. Field order is Maldives-correct:
 *   Name → Phone → Island → Address → Company → Channel → Price Tier → Email → Notes
 * (Island sits above Address because it decides the boat/route.)
 *
 * The component owns its own field state. On save it calls createCustomer or
 * updateCustomer and hands the saved row back via onSaved so each caller can
 * react (the directory refreshes its list; the sales wizard selects the new
 * customer and seeds the order tier/channel).
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createCustomer, updateCustomer,
  type CustomerRow, type CustomerInput, type CustomerChannel, type PriceTier,
} from "@/lib/queries/masters";
import { withOfflineFallback } from "@/lib/offline-write";

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

const LABEL_CLS = "text-xs uppercase tracking-widest text-muted-foreground";

/**
 * Normalise a phone number for duplicate comparison.
 * Strips spaces, dashes, brackets and a leading +960 / 960 country code so
 * "+960 771-2345", "7712345" and "771 2345" all compare equal. Returns "" when
 * there are no digits (so blank phones never match each other).
 */
function normalisePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("960") && digits.length > 7) digits = digits.slice(3);
  return digits;
}

export interface CustomerFormProps {
  /** When set, the form edits this customer; otherwise it creates a new one. */
  editing?: CustomerRow | null;
  /**
   * The current customer list, used for live duplicate detection while typing
   * and for the on-save phone check. Optional — if omitted, no duplicate
   * checking happens (the form still works exactly as before).
   */
  existing?: CustomerRow[];
  /** Called when the user taps "Use this customer" on a duplicate suggestion. */
  onPickExisting?: (customer: CustomerRow) => void;
  /** Called after a successful create/update with the saved row. */
  onSaved: (customer: CustomerRow) => void;
  /** Called when the user taps Cancel. */
  onCancel: () => void;
  /** Optional override for the primary button label. */
  saveLabel?: string;
}

/**
 * Fields initialise once from `editing`. To reset/re-seed (e.g. when a dialog
 * reopens or switches between create and edit), give the element a changing
 * `key` so React remounts it fresh — cleaner than a setState-in-effect.
 */
export function CustomerForm({ editing, existing, onPickExisting, onSaved, onCancel, saveLabel }: CustomerFormProps) {
  const [name, setName]         = useState(editing?.name ?? "");
  const [phone, setPhone]       = useState(editing?.phone ?? "");
  const [island, setIsland]     = useState(editing?.island ?? "");
  const [address, setAddress]   = useState(editing?.address ?? "");
  const [company, setCompany]   = useState(editing?.company ?? "");
  const [channel, setChannel]   = useState<CustomerChannel>(editing?.channel ?? "whatsapp");
  const [priceTier, setPriceTier] = useState<PriceTier>(editing?.price_tier ?? "retail");
  const [email, setEmail]       = useState(editing?.email ?? "");
  const [notes, setNotes]       = useState(editing?.notes ?? "");
  const [saving, setSaving]     = useState(false);
  // Holds the existing customer found at save-time so we can ask the user to
  // confirm before creating what is likely a duplicate.
  const [phoneConflict, setPhoneConflict] = useState<CustomerRow | null>(null);

  // Live duplicate suggestions while typing (create mode only). Phone is the
  // strong signal (normalised match); name is a soft signal (substring). We
  // never auto-match on address — too inconsistent — but we DO show it so the
  // user can confirm with their eyes.
  const matches = useMemo(() => {
    if (editing || !existing?.length) return [];
    const nameTerm = name.trim().toLowerCase();
    const phoneTerm = normalisePhone(phone);
    if (nameTerm.length < 2 && phoneTerm.length < 4) return [];
    return existing
      .filter((c) => {
        const phoneHit = phoneTerm.length >= 4 && normalisePhone(c.phone) === phoneTerm;
        const nameHit = nameTerm.length >= 2 && (c.name ?? "").toLowerCase().includes(nameTerm);
        return phoneHit || nameHit;
      })
      .slice(0, 5);
  }, [editing, existing, name, phone]);

  async function doInsert() {
    const payload: CustomerInput = {
      name: name.trim(),
      phone: phone.trim() || null,
      island: island.trim() || null,
      address: address.trim() || null,
      company: company.trim() || null,
      channel: (channel || null) as CustomerChannel | null,
      price_tier: priceTier,
      email: email.trim() || null,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      const { result, queued } = await withOfflineFallback(
        () => editing ? updateCustomer(editing.id, payload) : createCustomer(payload),
        editing
          ? { table: "customers", action: "update", payload: payload as unknown as Record<string, unknown>, match: { id: editing.id } }
          : { table: "customers", action: "insert", payload: payload as unknown as Record<string, unknown> },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : editing ? "Saved" : "Customer created");
      if (!queued) onSaved(result as CustomerRow);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (!name.trim()) return;
    // On create, if the phone matches an existing customer, pause and confirm.
    if (!editing && existing?.length) {
      const phoneTerm = normalisePhone(phone);
      if (phoneTerm.length >= 4) {
        const clash = existing.find((c) => normalisePhone(c.phone) === phoneTerm);
        if (clash) { setPhoneConflict(clash); return; }
      }
    }
    void doInsert();
  }

  return (
    <>
      {/* Scrollable field body — fills available space; footer stays pinned */}
      <div
        className="flex-1 min-h-0 space-y-4 overflow-y-auto px-5 py-1"
        style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
      >
        {/* Name */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Full Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed" />
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+960…" inputMode="tel" />
        </div>

        {/* Live duplicate suggestions — only while creating */}
        {matches.length > 0 && onPickExisting && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid color-mix(in srgb, var(--snm-warning) 35%, transparent)" }}>
            <p className="text-[12px] uppercase tracking-widest px-3 pt-2 pb-1.5 font-bold flex items-center gap-1.5"
              style={{ background: "color-mix(in srgb, var(--snm-warning) 8%, transparent)", color: "var(--snm-warning)" }}>
              <AlertTriangle className="h-3 w-3" /> Possible existing customer — tap to use instead
            </p>
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPickExisting(c)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70"
                style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}
              >
                <div className="h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                  style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>
                  {(c.name ?? "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground truncate">{c.name}</p>
                  <p className="text-[12px] truncate" style={{ color: "var(--muted-foreground)" }}>
                    {[c.phone, c.island, c.address].filter(Boolean).join(" · ") || "No other details"}
                  </p>
                </div>
                <span className="text-[12px] font-bold px-2 py-1 rounded-lg shrink-0"
                  style={{ background: "color-mix(in srgb, var(--snm-warning) 14%, transparent)", color: "var(--snm-warning)" }}>
                  Use
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Island — above Address: decides the boat/route */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Island</Label>
          <Input value={island} onChange={(e) => setIsland(e.target.value)} placeholder="Malé…" />
        </div>

        {/* Address */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Address</Label>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} className="min-h-[50px]" placeholder="House / shop, road…" />
        </div>

        {/* Company / Shop */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Company / Shop</Label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" />
        </div>

        {/* Channel + Price Tier */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Channel</Label>
          <Select value={channel} onValueChange={(v) => v && setChannel(v as CustomerChannel)}>
            <SelectTrigger>
              <SelectValue>{CHANNEL_LABEL[channel] ?? "Pick"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className={LABEL_CLS}>Price Tier</Label>
          <div className="grid grid-cols-4 gap-2">
            {TIERS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setPriceTier(t.value)}
                className="py-2 rounded-xl text-xs font-bold transition active:scale-95"
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

        {/* Email */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="name@example.com" />
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[50px]" placeholder="Optional" />
        </div>
      </div>

      {/* Footer — full-width primary on top, cancel below (native iOS order) */}
      <div className="flex flex-col gap-2 px-5 pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0">
        <Button
          onClick={save}
          disabled={saving || !name.trim()}
          className="h-12 w-full font-semibold"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (saveLabel ?? (editing ? "Save" : "Create"))}
        </Button>
        <Button variant="ghost" className="h-12 w-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {/* Phone-duplicate confirmation — appears on save when the phone already exists */}
      {phoneConflict && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: "color-mix(in srgb, var(--background) 55%, transparent)", backdropFilter: "blur(2px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          onClick={() => setPhoneConflict(null)}>
          <div className="w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderTop: "0.5px solid var(--glass-border-lo)", borderRadius: "20px 20px 0 0", boxShadow: "var(--glass-shadow-lg)" }}>
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "var(--snm-warning)" }} />
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground">This phone already exists</p>
                <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  A customer with this number is already saved:
                </p>
              </div>
            </div>
            <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
              <p className="text-[13px] font-semibold text-foreground">{phoneConflict.name}</p>
              <p className="text-[12px] snm-num" style={{ color: "var(--muted-foreground)" }}>
                {[phoneConflict.phone, phoneConflict.island, phoneConflict.address].filter(Boolean).join(" · ")}
              </p>
            </div>
            {onPickExisting && (
              <Button
                className="h-12 w-full font-semibold"
                style={{ background: "var(--foreground)", color: "var(--background)" }}
                onClick={() => { const c = phoneConflict; setPhoneConflict(null); onPickExisting(c); }}
              >
                Use this customer
              </Button>
            )}
            <Button
              variant="ghost" className="h-12 w-full"
              style={{ color: "var(--snm-warning)" }}
              onClick={() => { setPhoneConflict(null); void doInsert(); }}
            >
              Save as a new customer anyway
            </Button>
            <Button variant="ghost" className="h-11 w-full" onClick={() => setPhoneConflict(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
