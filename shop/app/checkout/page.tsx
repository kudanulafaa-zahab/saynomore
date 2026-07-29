"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useCart } from "@/components/cart/cart-provider";
import { useCatalogue } from "@/components/catalogue-provider";
import { placeOrder, type PaymentMethod } from "@/lib/queries/checkout";
import { formatMvr } from "@/lib/format";

export default function CheckoutPage() {
  const router = useRouter();
  const { lines, clear } = useCart();
  const { bySkuId } = useCatalogue();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [island, setIsland] = useState("");
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cod");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState(""); // real shoppers never see or fill this
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = lines.reduce((sum, l) => {
    const row = bySkuId.get(l.sku_id);
    if (!row) return sum;
    const price =
      l.uom === "carton" ? row.selling_price_per_carton_mvr
      : l.uom === "pack" ? row.selling_price_per_pack_mvr
      : row.selling_price_per_piece_mvr;
    return sum + (price ?? 0) * l.qty;
  }, 0);

  const canSubmit = name.trim() && phone.trim() && island.trim() && address.trim() && lines.length > 0 && !submitting;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await placeOrder({
        name, phone, island, address, paymentMethod,
        notes: notes.trim() || undefined,
        honeypot,
        lines,
      });
      clear();
      router.push(`/order/${result.order_number}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh pb-40">
      <div className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3" style={{
        background: "color-mix(in srgb, var(--background) 85%, transparent)",
        backdropFilter: "blur(20px)",
      }}>
        <button onClick={() => router.back()} className="snm-pressable h-9 w-9 flex items-center justify-center rounded-full" style={{ background: "var(--glass-1)" }}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="ios-headline font-semibold">Checkout</h1>
      </div>

      <div className="px-5 pt-4 space-y-5">
        <section className="space-y-3">
          <h2 className="ios-footnote font-semibold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
            Your details
          </h2>
          <input
            className="glass-input w-full px-3"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="glass-input w-full px-3"
            placeholder="Phone number"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <input
            className="glass-input w-full px-3"
            placeholder="Island"
            value={island}
            onChange={(e) => setIsland(e.target.value)}
          />
          <input
            className="glass-input w-full px-3"
            placeholder="Delivery address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <textarea
            className="glass-input w-full px-3 py-2"
            placeholder="Notes for delivery (optional)"
            style={{ height: "72px" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </section>

        {/* Honeypot — invisible to real shoppers, off-screen not display:none
            so it still exists in the DOM for simple bots to find and fill. */}
        <input
          type="text"
          name="company"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />

        <section className="space-y-3">
          <h2 className="ios-footnote font-semibold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
            Payment
          </h2>
          <div className="flex gap-2">
            {(["cod", "bank_transfer"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className="snm-pressable flex-1 ios-subhead font-semibold py-3 rounded-xl"
                style={{
                  background: paymentMethod === m ? "var(--foreground)" : "var(--glass-1)",
                  color: paymentMethod === m ? "var(--background)" : "var(--foreground)",
                }}
              >
                {m === "cod" ? "Cash on Delivery" : "Bank Transfer"}
              </button>
            ))}
          </div>
          {paymentMethod === "bank_transfer" && (
            <p className="ios-footnote rounded-xl p-3" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
              After placing your order, send your payment slip and order number to us on WhatsApp —
              we&apos;ll confirm as soon as it&apos;s received.
            </p>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between ios-headline font-semibold">
            <span>Subtotal</span>
            <span className="snm-num">{formatMvr(subtotal)}</span>
          </div>
        </section>

        {error && (
          <p className="ios-subhead font-medium" style={{ color: "var(--snm-error)" }}>
            {error}
          </p>
        )}
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 p-4"
        style={{
          paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
          background: "color-mix(in srgb, var(--background) 90%, transparent)",
          backdropFilter: "blur(20px)",
          borderTop: "0.5px solid var(--glass-border-lo)",
        }}
      >
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="snm-pressable w-full rounded-xl font-semibold"
          style={{
            background: "var(--foreground)",
            color: "var(--background)",
            opacity: canSubmit ? 1 : 0.4,
            height: "52px",
          }}
        >
          {submitting ? "Placing order…" : "Place order"}
        </button>
      </div>
    </main>
  );
}
