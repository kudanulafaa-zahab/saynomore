// Short brand blurbs shown under each brand's name in the browse view.
// Written from real published brand facts (Kao/Merries, Unicharm/MamyPoko,
// Wings/Sosoft) — not copied marketing copy — see docs/STOREFRONT_PLAN.md
// for the sourcing note. Keyed by brands.name exactly as stored in the DB.
export const BRAND_COPY: Record<string, string> = {
  Merries:
    "Japan's No.1 diaper brand. A 3-layer Air-Through System vents heat and moisture while locking liquid away, and the wavy inner sheet cuts skin contact in half. Dermatologically tested, fragrance-free.",
  Mamypoko:
    "X-tra Kering's X-shaped absorbent core pulls wetness away fast for up to 10 hours dry. The gel core expands 40x, with a colour-change wetness line so there's no guesswork on when to change.",
  Sosoft:
    "A 2-in-1 plant-based detergent and fabric softener — first in Indonesia to soften with real aloe vera. Five scents to mix and match into one carton.",
};

// Display-only fallback photos, shown for any size/variant that doesn't have
// its own photo yet (most sizes, at launch — only one photographed size
// exists per model today). Keyed per MODEL where more than one photographed
// model exists for a brand (Mamypoko: Xtra Kering/Xtra Care, Royal Soft*,
// Skin Comfort each get their own real pack photo, not a shared one), and
// per BRAND as a last resort for brands with only one photographed model
// (Merries). Real per-size photos should replace these over time.
export const MODEL_FALLBACK_IMAGE: Record<string, string> = {
  "Xtra Kering":
    "https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/mamypoko/xtrakering-m.png",
  "Royal Soft":
    "https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/mamypoko/royalsoft.png",
  "Royal Soft Boy":
    "https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/mamypoko/royalsoft.png",
  "Royal Soft Girl":
    "https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/mamypoko/royalsoft.png",
  "Skin Comfort":
    "https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/mamypoko/skincomfort.png",
};

export const BRAND_FALLBACK_IMAGE: Record<string, string> = {
  Merries:
    "https://smhdwkrmiytvpsgqezsl.supabase.co/storage/v1/object/public/product-images/merries/goodskin-l.png",
};

// Real image first, then the model-specific fallback, then the brand-wide
// fallback, then no photo (placeholder tile).
export function resolveImage(row: { image_url: string | null; model_name: string; brand_name: string }): string | null {
  return row.image_url ?? MODEL_FALLBACK_IMAGE[row.model_name] ?? BRAND_FALLBACK_IMAGE[row.brand_name] ?? null;
}
