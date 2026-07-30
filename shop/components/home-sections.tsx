// Homepage marketing sections — hero, brand story, trust strip, MamyPoko
// colour explainer, price comparison, delivery/trust, and the affordability
// pull-quote. Deliberately flat and spacious (full-width bands, plain
// dividers, no blur/glass) — the glass-card treatment stays reserved for
// the interactive shop/browse UI (VariantCard, cart), matching a reference
// e-commerce layout Ali approved: clean bands, big photography, simple
// icon+label trust rows, not frosted cards stacked in a column.
//
// Copy sourced from docs/STOREFRONT_COPY.md (hero C, why-cheaper C for the
// section + B as the pull-quote) and, for the four brand intros, a
// research pass citing Unicharm/Kao/Wings/The Body Shop's own product and
// press pages — see PR description / session notes for citations.

import Image from "next/image";
import { PackageCheck, Truck, ShieldCheck } from "lucide-react";

const HERO_IMAGE_URL =
  "https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/hero/mamypoko-beach.png";

export function Hero() {
  return (
    <div className="relative w-full" style={{ minHeight: "70vh" }}>
      <Image
        src={HERO_IMAGE_URL}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: "center 30%" }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(10,9,8,0.05) 0%, rgba(10,9,8,0.15) 55%, rgba(10,9,8,0.55) 100%)",
        }}
      />
      <div className="relative flex h-full min-h-[70vh] flex-col justify-end px-6 pb-12 sm:px-12 sm:pb-16">
        <h1
          className="max-w-xl font-bold text-white"
          style={{ fontSize: "clamp(2rem, 6vw, 3.25rem)", lineHeight: 1.08, letterSpacing: "-0.02em" }}
        >
          Real diapers. Real prices. Delivered.
        </h1>
        <p className="mt-4 max-w-md ios-body text-white/85">
          Genuine MamyPoko, Merries and Sosoft, imported direct — not from
          wherever they washed up. Free delivery across Malé, Hulhumalé and
          the boats between.
        </p>
      </div>
    </div>
  );
}

// Simple 3-up icon+label row — no cards, no blur. Matches the reference
// site's "Safe to use / Only the best materials / Smart design" pattern.
export function TrustStrip() {
  const items = [
    { icon: PackageCheck, label: "Genuine imports", sub: "Direct from the brand's own supply chain" },
    { icon: ShieldCheck, label: "Fair pricing", sub: "Checked against the market, every time" },
    { icon: Truck, label: "Free delivery", sub: "To your door or your boat, no minimum" },
  ];

  return (
    <section className="border-y" style={{ borderColor: "var(--outline-variant)" }}>
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 py-10 sm:grid-cols-3 sm:gap-6 sm:py-14">
        {items.map(({ icon: Icon, label, sub }) => (
          <div key={label} className="flex flex-col items-center text-center gap-2">
            <Icon className="h-7 w-7" strokeWidth={1.5} style={{ color: "var(--foreground)" }} />
            <p className="ios-headline font-semibold">{label}</p>
            <p className="ios-footnote max-w-[220px]" style={{ color: "var(--muted-foreground)" }}>
              {sub}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BrandStory() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 text-center sm:py-20">
      <h2 className="ios-title1 font-bold mb-4">Why Say No More</h2>
      <p className="ios-body" style={{ color: "var(--muted-foreground)" }}>
        We grew up doing the same end-of-month math you&rsquo;re doing right
        now — rent due, salary spent, groceries still needed. That&rsquo;s
        why Say No More exists. We don&rsquo;t chase fat margins; we chase
        being the store your family can actually afford. Fair pricing
        isn&rsquo;t a promo here. It&rsquo;s the whole point.
      </p>
    </section>
  );
}

// ── Category directory — one full-width alternating band per brand,
// each with a short researched "why choose this" intro and its own photo.
// Order matches the curated hierarchy: Mamypoko -> Merries -> Sosoft ->
// Seasonal (Body Shop).

interface CategoryBandProps {
  eyebrow: string;
  title: string;
  intro: string;
  imageUrl: string;
  imagePosition?: string;
  reverse?: boolean;
}

function CategoryBand({ eyebrow, title, intro, imageUrl, imagePosition, reverse }: CategoryBandProps) {
  return (
    <div
      className={`grid grid-cols-1 items-center gap-8 sm:grid-cols-2 sm:gap-12 ${reverse ? "sm:[&>*:first-child]:order-2" : ""}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl sm:aspect-square">
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 100vw, 50vw"
          className="object-cover"
          style={imagePosition ? { objectPosition: imagePosition } : undefined}
        />
      </div>
      <div className="px-1">
        <p className="ios-footnote font-semibold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
          {eyebrow}
        </p>
        <h3 className="ios-title2 font-bold mt-1 mb-3">{title}</h3>
        <p className="ios-body" style={{ color: "var(--muted-foreground)" }}>
          {intro}
        </p>
      </div>
    </div>
  );
}

export function CategoryDirectory() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      <h2 className="ios-title1 font-bold text-center mb-12 sm:mb-16">What we carry</h2>
      <div className="flex flex-col gap-16 sm:gap-24">
        <CategoryBand
          eyebrow="Diapers · Unicharm, Japan"
          title="Mamypoko"
          intro="Made by Unicharm — Asia's No. 1 diaper brand by sales across Indonesia, India, China, Vietnam and Thailand. X-tra Kering's CrissCross Absorbent Sheet spreads wetness evenly through the core, and a breathable outer sheet keeps skin cool, for a claimed 14 hours of dryness."
          imageUrl="https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/mamypoko/xtrakering-m.png"
        />
        <CategoryBand
          eyebrow="Diapers · Kao, Japan"
          title="Merries"
          intro="Merries' signature 3-Layer Air-Through construction — a wavy mesh top sheet, an absorbent core, and a breathable back sheet with over 5 billion micro-holes — lets heat and moisture escape, which Kao says improves breathability by 40% versus a standard sheet."
          imageUrl="https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/merries/goodskin-l.png"
          reverse
        />
        <CategoryBand
          eyebrow="Washing Detergent · Wings, Indonesia"
          title="Sosoft"
          intro="Indonesia's first plant-based detergent with a built-in aloe vera softener. The BotaniBlend formula is up to 90% plant-derived and free of chlorine, parabens and LABSA — dermatologically tested, in five scents you can mix into one carton."
          imageUrl="https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/sosoft/blue.png"
        />
      </div>
    </section>
  );
}

export function MamypokoColourExplainer() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-14 text-center">
      <h3 className="ios-title2 font-bold mb-3">
        Why does MamyPoko look different everywhere?
      </h3>
      <p className="ios-body" style={{ color: "var(--muted-foreground)" }}>
        MamyPoko&rsquo;s packaging changes by market. The dark blue pack
        you&rsquo;ve probably seen elsewhere is India&rsquo;s version. Ours
        is yellow — imported directly through the official Malaysia and
        Indonesia supply chain, formulated for our climate. No mystery
        batches, no diverted stock. Just the genuine product.
      </p>
      <div
        className="mt-5 inline-flex items-center gap-2 rounded-full border px-4 py-2"
        style={{ borderColor: "var(--outline-variant)" }}
      >
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: "#E8B923" }}
        />
        <span className="ios-footnote font-medium">
          Yellow pack — genuine Malaysia/Indonesia import
        </span>
      </div>
    </section>
  );
}

const PRICE_COMPARISON: { size: string; ours: number; market: number; savePct: number }[] = [
  { size: "S", ours: 3.55, market: 4.92, savePct: 28 },
  { size: "M", ours: 4.15, market: 5.76, savePct: 28 },
  { size: "L", ours: 4.74, market: 6.40, savePct: 26 },
  { size: "XL", ours: 5.45, market: 8.53, savePct: 36 },
  { size: "XXL", ours: 6.09, market: 10.00, savePct: 39 },
  { size: "XXXL", ours: 7.96, market: 15.45, savePct: 48 },
];

function mvr2dp(n: number): string {
  return `MVR ${n.toFixed(2)}`;
}

export function PriceComparison() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <h2 className="ios-title1 font-bold text-center">Same diaper. Real difference.</h2>
      <p className="ios-body mt-3 mb-8 text-center" style={{ color: "var(--muted-foreground)" }}>
        We checked MamyPoko Xtra Kering, size by size, across Malé. Priced
        fairly per piece, so a bigger pack can&rsquo;t hide a worse deal.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--outline-variant)" }}>
              <th className="ios-footnote font-semibold text-left py-3">Size</th>
              <th className="ios-footnote font-semibold text-right py-3">Our price / pc</th>
              <th className="ios-footnote font-semibold text-right py-3">Market price / pc</th>
              <th className="ios-footnote font-semibold text-right py-3">You save</th>
            </tr>
          </thead>
          <tbody>
            {PRICE_COMPARISON.map((row) => (
              <tr key={row.size} className="border-b" style={{ borderColor: "var(--outline-variant)" }}>
                <td className="ios-subhead font-semibold py-3">{row.size}</td>
                <td className="ios-subhead text-right py-3 snm-num">{mvr2dp(row.ours)}</td>
                <td
                  className="ios-subhead text-right py-3 snm-num"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {mvr2dp(row.market)}
                </td>
                <td
                  className="ios-subhead font-bold text-right py-3 snm-num"
                  style={{ color: "var(--snm-success)" }}
                >
                  {row.savePct}% less
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="ios-footnote mt-4 text-center" style={{ color: "var(--muted-foreground)" }}>
        Priced per piece, not per pack — pack counts differ between
        sellers, so per-piece is the honest comparison. Prices checked
        regularly.
      </p>
    </section>
  );
}

export function WhyCheaperPullquote() {
  return (
    <section className="mx-auto max-w-xl px-6 py-14">
      <blockquote
        className="ios-title2 font-semibold text-center"
        style={{ color: "var(--foreground)", lineHeight: 1.3 }}
      >
        &ldquo;We&rsquo;d rather earn less and keep you as a customer for
        years than earn more and lose you at the end of the month.&rdquo;
      </blockquote>
    </section>
  );
}

const HOW_IT_WORKS = [
  { step: "1", title: "Browse", body: "Pick your favourites without the guesswork." },
  { step: "2", title: "Order", body: "Fast checkout, zero minimums." },
  { step: "3", title: "We deliver", body: "Free, right to your door or boat." },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-14">
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
        {HOW_IT_WORKS.map(({ step, title, body }) => (
          <div key={step} className="text-center">
            <div
              className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full font-semibold"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {step}
            </div>
            <p className="ios-headline font-semibold">{title}</p>
            <p className="ios-footnote mt-1" style={{ color: "var(--muted-foreground)" }}>
              {body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DeliveryTrust() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-14 text-center">
      <h3 className="ios-title2 font-bold mb-3">Free delivery, every order.</h3>
      <p className="ios-body" style={{ color: "var(--muted-foreground)" }}>
        Fast, no minimum spend, no chasing you for extra charges at the
        door. Checkout in under a minute — no account needed. Pay via cash
        on delivery, or bank transfer with your slip sent straight to
        WhatsApp.
      </p>
    </section>
  );
}
