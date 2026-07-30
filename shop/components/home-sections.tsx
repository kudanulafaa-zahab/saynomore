// Homepage marketing sections — hero, brand story, MamyPoko colour
// explainer, price comparison, delivery/trust, and the affordability
// pull-quote. Copy sourced verbatim from docs/STOREFRONT_COPY.md (hero C,
// why-cheaper C for the section + B as the pull-quote, per Ali's
// instruction to use the doc's own recommendations). The price table is
// real data pulled from live competitor_prices vs our selling prices
// (competitor "VB", logged in Products/Market — never named publicly).

import Image from "next/image";

const HERO_IMAGE_URL =
  "https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/hero/mamypoko-beach.png";

export function Hero() {
  return (
    <div
      className="relative px-5 pt-8 pb-6 overflow-hidden"
      style={{ minHeight: "360px" }}
    >
      <Image
        src={HERO_IMAGE_URL}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: "center 25%" }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--background) 15%, transparent) 0%, color-mix(in srgb, var(--background) 55%, transparent) 55%, var(--background) 100%)",
        }}
      />
      <div className="relative">
        <h1 className="ios-large-title font-bold">Say no more to overpaying</h1>
        <p className="ios-large-title font-bold" style={{ color: "var(--muted-foreground)" }}>
          for the real thing.
        </p>
        <p className="ios-subhead mt-3" style={{ color: "var(--muted-foreground)" }}>
          Genuine MamyPoko, Merries and Sosoft, imported direct — not from
          wherever they happened to wash up. Free delivery across Malé.
        </p>
      </div>
    </div>
  );
}

export function BrandStory() {
  return (
    <section className="px-5 py-6">
      <h2 className="ios-title2 font-bold mb-3">Why Say No More</h2>
      <p className="ios-body" style={{ color: "var(--muted-foreground)" }}>
        Every box on this site came through our own supply chain — imported
        directly from MamyPoko and Sosoft&rsquo;s Malaysia and Indonesia
        distribution, the same source your favourite stores would use if
        they were being straight with you about it. No resellers, no
        &ldquo;somehow ended up here&rdquo; stock, no guessing where it&rsquo;s
        really been. Just the genuine product, at a genuine price, brought
        to your door.
      </p>
    </section>
  );
}

export function MamypokoColourExplainer() {
  return (
    <section className="px-5 py-2">
      <div className="snm-card p-5">
        <h3 className="ios-headline font-bold mb-2">
          Why does MamyPoko look different everywhere?
        </h3>
        <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
          MamyPoko&rsquo;s packaging isn&rsquo;t one-size-fits-all — it&rsquo;s
          printed differently for every market it&rsquo;s sold in. The dark
          blue pack you&rsquo;ve probably seen elsewhere is India&rsquo;s
          packaging, made for the Indian market. Ours is yellow — because we
          import the version made specifically for Malaysia and Indonesia,
          which is where our stock actually comes from.
        </p>
        <p className="ios-subhead mt-2" style={{ color: "var(--muted-foreground)" }}>
          Same trusted MamyPoko, formulated and packed for our part of the
          world — not diverted in from somewhere else and sold as if it were
          local stock.
        </p>
        <div
          className="mt-4 flex items-center gap-2 rounded-full px-3 py-2 w-fit"
          style={{ background: "var(--glass-1)", border: "0.5px solid var(--glass-border-lo)" }}
        >
          <span aria-hidden style={{ fontSize: "14px" }}>🟡</span>
          <span className="ios-footnote font-medium">
            Yellow pack = genuine Malaysia/Indonesia import
          </span>
        </div>
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
    <section className="px-5 py-6">
      <h2 className="ios-title2 font-bold">Same diaper. Real difference.</h2>
      <p className="ios-subhead mt-1 mb-4" style={{ color: "var(--muted-foreground)" }}>
        We checked. Here&rsquo;s what MamyPoko Xtra Kering actually costs
        elsewhere in Malé, size for size — priced fairly, per piece, so a
        bigger pack can&rsquo;t hide a worse deal.
      </p>

      <div className="snm-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "0.5px solid var(--glass-border-lo)" }}>
                <th className="ios-footnote font-semibold text-left p-3">Size</th>
                <th className="ios-footnote font-semibold text-right p-3">Our price / pc</th>
                <th className="ios-footnote font-semibold text-right p-3">Market price / pc</th>
                <th className="ios-footnote font-semibold text-right p-3">You save</th>
              </tr>
            </thead>
            <tbody>
              {PRICE_COMPARISON.map((row) => (
                <tr key={row.size} style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                  <td className="ios-subhead font-semibold p-3">{row.size}</td>
                  <td className="ios-subhead text-right p-3 snm-num">{mvr2dp(row.ours)}</td>
                  <td
                    className="ios-subhead text-right p-3 snm-num"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {mvr2dp(row.market)}
                  </td>
                  <td
                    className="ios-subhead font-bold text-right p-3 snm-num"
                    style={{ color: "var(--snm-success)" }}
                  >
                    {row.savePct}% less
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="ios-footnote mt-3" style={{ color: "var(--muted-foreground)" }}>
        Priced per piece, not per pack — pack counts differ between sellers,
        so per-piece is the honest comparison. Prices checked regularly.
      </p>
    </section>
  );
}

export function DeliveryTrust() {
  return (
    <section className="px-5 py-6">
      <div className="snm-card p-5">
        <h3 className="ios-headline font-bold mb-2">Free delivery, every order.</h3>
        <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
          Fast, no minimum spend, no chasing you for extra charges at the
          door. Order in under a minute — no account needed. Pay however
          suits you: cash on delivery, or bank transfer with your slip sent
          straight to us on WhatsApp.
        </p>
      </div>
    </section>
  );
}

export function WhyCheaper() {
  return (
    <section className="px-5 py-6">
      <div className="snm-card p-5">
        <p className="ios-body">
          We grew up doing the same end-of-month math you&rsquo;re doing
          right now — rent due, salary already spent, groceries still
          needed. That&rsquo;s exactly why Say No More exists. We don&rsquo;t
          chase the biggest margin on every box; we chase being the store
          your family can actually afford, month after month. Fair pricing
          isn&rsquo;t a promotion here — it&rsquo;s the whole point.
        </p>
      </div>
    </section>
  );
}

export function WhyCheaperPullquote() {
  return (
    <section className="px-5 py-6">
      <blockquote
        className="ios-title3 font-semibold text-center px-4"
        style={{ color: "var(--foreground)" }}
      >
        &ldquo;We&rsquo;d rather earn less and keep you as a customer for
        years than earn more and lose you at the end of the month.&rdquo;
      </blockquote>
    </section>
  );
}
