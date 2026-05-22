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

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

export interface CustomerFormProps {
  /** When set, the form edits this customer; otherwise it creates a new one. */
  editing?: CustomerRow | null;
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
export function CustomerForm({ editing, onSaved, onCancel, saveLabel }: CustomerFormProps) {
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

  async function save() {
    if (!name.trim()) return;
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
      const saved = editing
        ? await updateCustomer(editing.id, payload)
        : await createCustomer(payload);
      toast.success(editing ? "Saved" : "Customer created");
      onSaved(saved as CustomerRow);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
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
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed" />
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <Label className={LABEL_CLS}>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+960…" inputMode="tel" />
        </div>

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
      <div className="flex flex-col gap-2 px-5 pt-3 pb-2 shrink-0">
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
    </>
  );
}
