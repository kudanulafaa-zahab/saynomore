"use client";

// New Sale — the three-step order wizard.
//
// Moved out of sales-list.tsx on 2026-08-10, whole and unchanged. It is still
// large, and that is the honest state of it: breaking a 2,400-line component
// apart means moving state that guards money (the below-cost confirm, whole
// mixed cartons, the stock cap, the cross-godown pick), and that is its own
// change with its own verification. A file MOVE can be proven correct; a state
// restructure cannot, not in the same breath.
//
// What this move does buy immediately: the cart, its arithmetic, the carton
// picker and the order list no longer share one scope with it, so a change to
// one can no longer quietly reach the others.

import { SearchField } from "@/components/ui/search-field";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, Plus, ShoppingCart, UserPlus, ChevronRight, Banknote, Smartphone, ArrowRight, ArrowLeft, ChevronDown, ScanLine, X, RotateCcw, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";

const BarcodeScanner = dynamic(
  () => import("@/components/ui/barcode-scanner").then((m) => m.BarcodeScanner),
  { ssr: false },
);

import { createAndPostSale, peekNextOrderNumber, getTierPricesForSkus, getLastOrderForCustomer, toPieces, describePriceSource, type OrderChannel, type SaleUom, type TierPrice, type LastOrderSummary } from "@/lib/queries/sales";
import { type CustomerRow, type GodownRow, type PriceTier } from "@/lib/queries/masters";
import { CustomerForm } from "@/components/masters/customer-form";
import { updateSku, type SkuFullRow } from "@/lib/queries/products";
import { SkuIdentity, PriceSourceTag } from "@/components/ui/sku-identity";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { type StockLevel } from "@/lib/queries/inventory";
import { withOfflineFallback } from "@/lib/offline-write";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { formatQtyInTradeUnits, formatMixedCartonQty, priceForMargin, sellableTiers, sellUnitLabel, costPerTradeUnit, containerLabel, type UnitUom } from "@/lib/trade-units";
import { StockInSheet } from "@/components/sales/stock-in-sheet";
import { CARD_L2 } from "@/lib/surfaces";
import { mvtInstant } from "@/lib/mvt-date";
const CHANNELS: { value: OrderChannel; label: string }[] = [
  { value: "whatsapp",  label: "WhatsApp"  },
  { value: "viber",     label: "Viber"     },
  { value: "messenger", label: "Messenger" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok",    label: "TikTok"    },
  { value: "facebook",  label: "Facebook"  },
  { value: "phone",     label: "Phone"     },
  { value: "walkin",    label: "Walk-in"   },
  { value: "other",     label: "Other"     },
];
import { getCrossSellSuggestion, type CrossSellSuggestion } from "@/lib/queries/sales";
import { CartLines } from "./cart/cart-lines";
import { type DraftLine, packLabel, defaultUom, tradeCfg, cartShortfalls, cartMixConflicts, nextCartLineKey } from "./cart/cart-math";
import { GlassSelect, WarehouseSelect } from "./warehouse-select";
import { MixedCartonSheet } from "./mixed-carton-sheet";
import { mvr, mvrUpTo } from "@/lib/money";

type PaymentMethod = "bank_transfer" | "cod";

type Step = 1 | 2 | 3;

export function NewSaleSheet({
  customers, skus, godowns, stockLevels, onClose, onCreated, onCustomerCreated,
  onStockChanged,
}: {
  customers: CustomerRow[]; skus: SkuFullRow[]; godowns: GodownRow[];
  stockLevels: StockLevel[];
  onClose: () => void; onCreated: (id: string) => void;
  onCustomerCreated: (c: CustomerRow) => void;
  /** Stock was received from inside the sale — the parent owns the levels, so
   *  it has to reload them or the product stays "out of stock" on screen while
   *  being in stock in the database. */
  onStockChanged?: () => Promise<void> | void;
}) {
  // This full-screen sheet uses the calmer wallpaper variant (see
  // .glass-wallpaper--calm) since it's a dense list of thin rows rather
  // than a few large cards — same bokeh, muted, so rows stay legible. On
  // top of that muted backdrop the denser CARD_L2 fill reads as glass the
  // same way Dashboard's cards do; shadows the outer CARD constant for
  // every ...CARD spread in this function.
  const CARD = CARD_L2;

  // Portal target — mounted flag set in an effect (not a bare `typeof
  // document !== "undefined"` inline check), because that inline check
  // still evaluates during React's render pass and can race with
  // hydration: createPortal was thrown with "Target container is not a
  // DOM element" and crashed this entire component, silently falling back
  // to a broken render that LOOKED like the old, unfixed sheet — which is
  // exactly why the previous fix appeared to do nothing. Gating on a
  // state flag flipped inside useEffect guarantees this only ever runs
  // client-side, after mount, when document.body is unquestionably real.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  const [step, setStep] = useState<Step>(1);
  // Preview only — assign_sales_order_number assigns the real one atomically
  // on insert. Read from the live counter rather than guessed from whichever
  // orders happened to be downloaded (the list is paged now, so guessing from
  // memory would show a number already in use). Blank until it arrives, and
  // stays blank offline rather than showing a confident wrong number.
  const [orderNumber, setOrderNumber] = useState("");
  // Offline queue key. Independent of the preview above: offline is exactly
  // when the preview can't be read, and two orders keyed "offline-" would
  // collide in the queue.
  const [offlineKey] = useState(() => `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  useEffect(() => {
    let cancelled = false;
    peekNextOrderNumber()
      .then((n) => { if (!cancelled) setOrderNumber(n); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [channel, setChannel] = useState<OrderChannel>("whatsapp");

  // Step 1 — customer
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  // Order-level tier override — defaults to customer's tier, can be changed per order
  const [orderTier, setOrderTier] = useState<PriceTier>("retail");

  // Step 2 — products
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [lineUom, setLineUom] = useState<SaleUom>("pack");
  const [lineQty, setLineQty] = useState("");
  const [linePrice, setLinePrice] = useState("");
  const [mixedCarton, setMixedCarton] = useState(false);
  // Deliberately NOT pre-filled with the default warehouse. Ali asked to be
  // reminded on every order which godown ships it, and the reason he was
  // "forgetting to choose" is that it was already chosen for him — so he was
  // really forgetting to CHANGE it on the ~7% of orders that ship from the
  // other warehouse, and a wrong pick only surfaced later at a stock count.
  // Starting empty makes it one deliberate tap every time. That is the
  // reminder: unmissable, and impossible to swipe away.
  const [godownId, setGodownId] = useState("");
  // One thing worth offering alongside this order. Everything about WHICH
  // thing is decided in Postgres (0183); this holds the answer and whether
  // he waved it away for this order.
  const [crossSell, setCrossSell] = useState<CrossSellSuggestion | null>(null);
  const [crossSellOff, setCrossSellOff] = useState(false);

  // Step 3 — payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [orderNotes, setOrderNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Tier pricing — fetched once when customer is confirmed and we move to step 2
  const [tierPrices, setTierPrices] = useState<Map<string, TierPrice>>(new Map());

  // "Repeat last order" — the customer's previous basket, fetched when a real
  // customer is picked. Shops mostly reorder the same basket; one tap rebuilds
  // it at TODAY's tier prices (never the old prices — fixed-price rule).
  const [lastOrder, setLastOrder] = useState<LastOrderSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLastOrder(null);
    if (!customerId || customerId === "walkin") return;
    getLastOrderForCustomer(customerId)
      .then((lo) => { if (!cancelled) setLastOrder(lo); })
      .catch(() => { /* non-fatal — banner simply doesn't show */ });
    return () => { cancelled = true; };
  }, [customerId]);

  const customer = customers.find((c) => c.id === customerId);
  // Local price fixes made from the "why is this the price?" sheet (see
  // showPriceExplain below) — applied on top of the parent's `skus` list so
  // a correction is reflected immediately without leaving New Sale or
  // waiting for the parent to reload. The parent's own data refreshes
  // normally next time this screen loads.
  const [priceOverrides, setPriceOverrides] = useState<Record<string, Partial<SkuFullRow>>>({});
  const selectedSku = useMemo(() => {
    const base = skus.find((s) => s.id === selectedSkuId);
    if (!base) return base;
    const ov = priceOverrides[base.id];
    return ov ? { ...base, ...ov } : base;
  }, [skus, selectedSkuId, priceOverrides]);

  // ── Recent customers from localStorage (IDEO: Recents first) ──
  // Store the last 3 used customer IDs so repeat orders need zero search.
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("snm_recent_customers") ?? "[]"); }
    catch { return []; }
  });
  function touchRecentCustomer(id: string) {
    const next = [id, ...recentIds.filter((x) => x !== id)].slice(0, 3);
    setRecentIds(next);
    try { localStorage.setItem("snm_recent_customers", JSON.stringify(next)); } catch { /* ignore */ }
  }
  const recentCustomers = useMemo(() => {
    const pinned = recentIds.map((id) => customers.find((c) => c.id === id)).filter(Boolean) as CustomerRow[];
    // Fill remaining slots from the head of the list so there's always something to show
    const rest = customers.filter((c) => !recentIds.includes(c.id)).slice(0, Math.max(0, 5 - pinned.length));
    return [...pinned, ...rest].slice(0, 5);
  }, [customers, recentIds]);
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return [];
    // Phone is the primary identity for repeat customers. Normalise both sides
    // (strip +960 / spaces / dashes) so typing "7712345" matches a stored
    // "+960 771 2345". Text still matches name/island as before.
    const digits = term.replace(/\D/g, "").replace(/^960/, "");
    const normPhone = (p: string | null) => (p ?? "").replace(/\D/g, "").replace(/^960/, "");
    return customers.filter((c) => {
      const textHit = [c.name, c.phone ?? "", c.island ?? ""].join(" ").toLowerCase().includes(term);
      const phoneHit = digits.length >= 3 && normPhone(c.phone).includes(digits);
      return textHit || phoneHit;
    }).slice(0, 10);
  }, [customers, customerSearch]);

  const filteredSkus = useMemo(() => {
    const term = skuSearch.trim().toLowerCase();
    const active = skus.filter((s) => s.is_active);
    const matched = term
      ? active.filter((s) => [s.brand_name, s.model_name, s.variant_display, s.internal_code ?? ""].join(" ").toLowerCase().includes(term))
      : active;
    // Stock in the CHOSEN godown vs across ALL godowns. Two different questions:
    // "where does it ship from" (chosen) vs "do we own it at all" (total).
    const stockFor = (s: SkuFullRow) =>
      godownId ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0 : 1;
    const totalStockFor = (s: SkuFullRow) =>
      stockLevels.filter((l) => l.sku_id === s.id).reduce((sum, l) => sum + l.qty_pieces, 0);
    // NEVER hide a product we own. Show every SKU with stock in ANY godown, so a
    // product sitting in another warehouse can't be mistaken for out-of-stock and
    // lose a sale (the card will say "None here · N in <other>"). Only SKUs with
    // zero stock EVERYWHERE drop to the bottom (dimmed). When searching by name we
    // show all matches so a typed product never vanishes.
    const pool = term ? matched : matched.filter((s) => totalStockFor(s) > 0);
    // Rank: in the chosen godown first, then owned-elsewhere, then zero-everywhere.
    const rank = (s: SkuFullRow) => (stockFor(s) > 0 ? 2 : totalStockFor(s) > 0 ? 1 : 0);
    const ranked = [...pool].sort((a, b) => rank(b) - rank(a));
    // Cap raised from the old flat-list limit — SKUs are now grouped by
    // brand/model (see normalSkus below), so this only needs to bound a
    // pathological catalogue size, not the visible row count.
    return ranked.slice(0, 400);
  }, [skus, skuSearch, godownId, stockLevels]);

  const stockHere = selectedSku && godownId
    ? stockLevels.find((l) => l.sku_id === selectedSku.id && l.godown_id === godownId)?.qty_pieces ?? 0
    : null;

  // ── Mixed-carton brands (e.g. Sosoft: 5 scents, sold as a carton the
  // customer fills with any mix) collapse to ONE card in the grid instead of
  // one per SKU — opening MixedCartonSheet instead of the single-SKU editor.
  // brands.mixed_carton_pieces is the data-driven flag (migration 0065):
  // any brand can opt in, nothing here is hardcoded to "Sosoft".
  const { normalSkus, mixedCartonGroups } = useMemo(() => {
    const groups = new Map<string, SkuFullRow[]>();
    const normal: SkuFullRow[] = [];
    for (const s of filteredSkus) {
      if (s.mixed_carton_pieces != null) {
        const arr = groups.get(s.brand_id) ?? [];
        arr.push(s);
        groups.set(s.brand_id, arr);
      } else {
        normal.push(s);
      }
    }
    return { normalSkus: normal, mixedCartonGroups: groups };
  }, [filteredSkus]);

  const [mixedCartonBrandId, setMixedCartonBrandId] = useState<string | null>(null);
  /** The catalogue block, so the cart's "Add more" pill can bring it back into
   *  view — on step 2 the products are already on screen, just scrolled past. */
  const productSearchRef = useRef<HTMLDivElement | null>(null);

  // ── Brand → Model grouping for the normal product grid ──
  // Mamypoko alone spans 5 model lines (Royal Soft, Royal Soft Boy/Girl,
  // Skin Comfort, Xtra Kering) — flattened by SKU this became a long scroll
  // of near-identical cards. Brand stays a fixed section label (never
  // collapses, always visible); each model underneath is independently
  // collapsible, same chevron-row control Products already uses for its
  // brand divider, one level deeper. Collapsed by default — New Sale's job
  // is scanning many brands fast, the opposite default from the Products
  // catalogue (which stays expanded since that screen IS the catalogue).
  const brandModelGroups = useMemo(() => {
    const brands = new Map<string, { brandId: string; brandName: string; models: Map<string, { modelId: string; modelName: string; skus: SkuFullRow[] }> }>();
    for (const s of normalSkus) {
      let brand = brands.get(s.brand_id);
      if (!brand) {
        brand = { brandId: s.brand_id, brandName: s.brand_name, models: new Map() };
        brands.set(s.brand_id, brand);
      }
      let model = brand.models.get(s.model_id);
      if (!model) {
        model = { modelId: s.model_id, modelName: s.model_name, skus: [] };
        brand.models.set(s.model_id, model);
      }
      model.skus.push(s);
    }
    return [...brands.values()].map((b) => ({ ...b, models: [...b.models.values()] }));
  }, [normalSkus]);

  // Empty = every model collapsed (the default). A model is expanded once
  // its id is in this set — inverted vs. Products' collapsedBrands because
  // that screen defaults to EXPANDED (nothing pre-hidden); this one defaults
  // to COLLAPSED, so tracking "expanded" avoids having to pre-seed every id.
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  function toggleModel(modelId: string) {
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId); else next.add(modelId);
      return next;
    });
  }

  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [showPriceExplain, setShowPriceExplain] = useState(false);
  // Quick-add on a below-cost SKU pauses for a deliberate choice — losing
  // money must never be a single accidental tap. Holds the pending add.
  const [belowCostAdd, setBelowCostAdd] = useState<{ sku: SkuFullRow; uom: ReturnType<typeof defaultUom>; price: number } | null>(null);
  // A product with no stock anywhere, tapped from the picker. Receiving it in
  // place is what lets the sale continue without abandoning the order.
  const [stockInSku, setStockInSku] = useState<SkuFullRow | null>(null);

  // One-tap rebuild of the customer's previous basket at TODAY's prices.
  // Every line passes the same doors a manual add would: active SKU, enough
  // stock somewhere, a resolvable price, and never below cost — lines that
  // fail any guard are skipped and counted, not silently altered.
  function repeatLastOrder() {
    if (!lastOrder) return;
    const added: DraftLine[] = [];
    let skipped = 0;
    for (const line of lastOrder.lines) {
      const sku = skus.find((s) => s.id === line.sku_id && s.is_active);
      if (!sku) { skipped++; continue; }
      // Don't re-add something already on the order — one line per product.
      if (draftLines.some((l) => l.sku.id === sku.id)) { skipped++; continue; }
      const totalStock = stockLevels
        .filter((l) => l.sku_id === sku.id)
        .reduce((a, l) => a + l.qty_pieces, 0);
      if (totalStock < line.qty_pieces) { skipped++; continue; }
      let uom: SaleUom = line.uom === "carton" || line.uom === "pack" || line.uom === "piece" ? line.uom : "piece";
      const perUnit = toPieces(uom, 1, sku.pcs_per_pack, sku.packs_per_carton);
      let qty = perUnit > 0 ? line.qty_pieces / perUnit : NaN;
      if (!Number.isInteger(qty) || qty <= 0) { uom = "piece"; qty = line.qty_pieces; }
      const ap = autoPrice(sku, uom, false);
      const price = parseFloat(ap.price);
      if (!ap.price || !Number.isFinite(price) || price <= 0) { skipped++; continue; }
      const perPiece = price / toPieces(uom, 1, sku.pcs_per_pack, sku.packs_per_carton);
      if (sku.landed_per_piece_mvr != null && perPiece < Number(sku.landed_per_piece_mvr)) { skipped++; continue; }
      added.push({
        key: nextCartLineKey(sku.id),
        sku, uom, qty,
        qty_pieces: line.qty_pieces,
        unit_price_mvr: price,
        line_total_mvr: price * qty,
        is_mixed_carton_fill: false,
      });
    }
    if (added.length === 0) {
      toast.error("Couldn't repeat — those items are out of stock or unpriced today");
      return;
    }
    setDraftLines((prev) => [...prev, ...added]);
    toast.success(
      `${added.length} item${added.length !== 1 ? "s" : ""} added from last order` +
      (skipped > 0 ? ` — ${skipped} skipped (stock or price)` : ""),
    );
  }

  function pushQuickLine(s: SkuFullRow, uom: ReturnType<typeof defaultUom>, price: number) {
    // Same one-line-per-product rule as handleAddLine — quick-add must not be
    // the back door that builds an order the database will reject on save.
    if (draftLines.some((l) => l.sku.id === s.id)) {
      toast.error(`${s.brand_name} ${s.variant_display} is already in this order`);
      return;
    }
    const pcs = toPieces(uom, 1, s.pcs_per_pack, s.packs_per_carton);
    setDraftLines((prev) => [...prev, {
      key: `${s.id}-${Date.now()}`,
      sku: s, uom, qty: 1,
      qty_pieces: pcs,
      unit_price_mvr: price,
      line_total_mvr: price,
      is_mixed_carton_fill: false,
    }]);
    toast.success(`${s.brand_name} ${s.variant_display} added`);
  }
  const [editingPrice, setEditingPrice] = useState(false);
  // Margin-simulator state for the inline price fix — mirrors the Pricing
  // screen's Margin Simulator exactly (slider drives a live price from
  // landed cost, always saved per-pack internally regardless of display
  // unit) so fixing a price here is never a disconnected typed number.
  const [simPackPrice, setSimPackPrice] = useState(0);
  const [simTyped, setSimTyped] = useState("");
  const [simEditingTyped, setSimEditingTyped] = useState(false);
  const [savingFixedPrice, setSavingFixedPrice] = useState<"margin" | "fixed" | null>(null);
  const [autoPriceSource, setAutoPriceSource] = useState<"price_list" | "sku_default" | "margin" | null>(null);

  // Lock the background page while this full-screen sheet is mounted (shared hook).
  useBodyScrollLock(true);

  function autoPrice(
    sku: typeof selectedSku,
    uom: SaleUom,
    isMixed: boolean,
  ): { price: string; source: "price_list" | "sku_default" | "margin" | null } {
    if (!sku) return { price: "", source: null };
    const tp = tierPrices.get(sku.id);
    // Mixed carton: charge the per-piece equivalent of the carton price
    if (isMixed && uom === "piece") {
      const pcsPerCarton = sku.pcs_per_pack * sku.packs_per_carton;
      if (pcsPerCarton > 0) {
        if (tp) {
          return { price: (tp.price_per_carton_mvr / pcsPerCarton).toFixed(4), source: tp.source };
        }
        const cartonPrice = sku.selling_price_per_carton_mvr;
        if (cartonPrice != null) {
          return { price: (cartonPrice / pcsPerCarton).toFixed(4), source: "sku_default" };
        }
      }
    }
    if (tp) {
      const p = uom === "piece" ? tp.price_per_piece_mvr
        : uom === "pack" ? tp.price_per_pack_mvr
        : tp.price_per_carton_mvr;
      return { price: p.toFixed(0), source: tp.source };
    }
    const p = uom === "piece" ? sku.selling_price_per_piece_mvr
      : uom === "pack" ? sku.selling_price_per_pack_mvr
      : sku.selling_price_per_carton_mvr;
    return { price: p != null ? p.toFixed(0) : "", source: p != null ? "sku_default" : null };
  }

  // When a new SKU is selected: set smart default UOM, then auto-fill price
  useEffect(() => {
    if (!selectedSku) return;
    const smartUom = defaultUom(selectedSku);
    setMixedCarton(false);
    const ap = autoPrice(selectedSku, smartUom, false);
    setLineUom(smartUom);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkuId, tierPrices]);

  // When UOM changes (user picks a different one): re-fill price, reset mixed carton
  useEffect(() => {
    if (!selectedSku) return;
    // Mixed carton only makes sense on piece UOM — auto-clear on UOM switch
    const nextMixed = lineUom === "piece" ? mixedCarton : false;
    if (lineUom !== "piece" && mixedCarton) setMixedCarton(false);
    const ap = autoPrice(selectedSku, lineUom, nextMixed);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineUom, tierPrices]);

  // When mixed carton toggle changes: re-fill price
  useEffect(() => {
    if (!selectedSku || lineUom !== "piece") return;
    const ap = autoPrice(selectedSku, lineUom, mixedCarton);
    setLinePrice(ap.price);
    setAutoPriceSource(ap.source);
    setPriceManuallyEdited(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixedCarton]);

  function handlePriceChange(raw: string) {
    // Allow empty string while typing — don't restore auto price mid-keystroke
    setLinePrice(raw);
    if (raw === "") {
      setPriceManuallyEdited(false);
      // source stays — restored on blur if still empty
    } else {
      const ap = autoPrice(selectedSku, lineUom, mixedCarton);
      setPriceManuallyEdited(raw !== ap.price);
      if (raw !== ap.price) setAutoPriceSource(null);
      else setAutoPriceSource(ap.source);
    }
  }

  function handlePriceBlur() {
    // Only restore auto price on blur if field is empty
    if (linePrice === "") {
      const ap = autoPrice(selectedSku, lineUom, mixedCarton);
      setLinePrice(ap.price);
      setAutoPriceSource(ap.source);
      setPriceManuallyEdited(false);
    }
  }

  const lineQtyPieces = useMemo(() => {
    if (!selectedSku || !lineQty) return 0;
    const n = parseFloat(lineQty);
    if (isNaN(n) || n <= 0) return 0;
    return toPieces(lineUom, n, selectedSku.pcs_per_pack, selectedSku.packs_per_carton);
  }, [selectedSku, lineQty, lineUom]);

  // Guardrail on the manual price override — warns, never blocks (the rep
  // may genuinely intend a special price). Red: below what the goods cost
  // you. Amber: wildly different from the usual auto price, the classic
  // "typed the pack price on a carton line" mistake.
  const priceWarning = useMemo(() => {
    if (!selectedSku || linePrice === "") return null;
    const p = parseFloat(linePrice);
    if (isNaN(p) || p <= 0) return null;
    const perUom = lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton
      : lineUom === "pack" ? selectedSku.pcs_per_pack : 1;
    const landed = selectedSku.landed_per_piece_mvr;
    if (landed != null && landed > 0 && p / perUom < landed) {
      return { color: "var(--snm-error)", text: `Below cost — this ${lineUom} cost you ~MVR ${(landed * perUom).toFixed(0)}` };
    }
    const ap = autoPrice(selectedSku, lineUom, mixedCarton);
    const auto = ap.price ? parseFloat(ap.price) : NaN;
    if (!isNaN(auto) && auto > 0 && Math.abs(p - auto) / auto > 0.4) {
      return { color: "var(--snm-warning)", text: `Usual price is MVR ${auto.toFixed(0)} — double-check` };
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSku, linePrice, lineUom, mixedCarton]);

  const lineTotal = useMemo(() => {
    const q = parseFloat(lineQty); const p = parseFloat(linePrice);
    if (isNaN(q) || isNaN(p)) return 0;
    return q * p;
  }, [lineQty, linePrice]);

  const insufficient = stockHere !== null && lineQtyPieces > stockHere;
  const grandTotal = useMemo(() => draftLines.reduce((s, l) => s + l.line_total_mvr, 0), [draftLines]);

  // Ask again whenever the basket, the customer or the warehouse changes — the
  // answer depends on all three. A walk-in has no history to reason from, so
  // there is nothing honest to suggest and it is not asked for.
  useEffect(() => {
    if (!godownId || !customerId || customerId === "walkin" || draftLines.length === 0) {
      setCrossSell(null);
      return;
    }
    let cancelled = false;
    getCrossSellSuggestion(customerId, godownId, draftLines.map((l) => l.sku.id))
      .then((s) => { if (!cancelled) setCrossSell(s); })
      .catch(() => { if (!cancelled) setCrossSell(null); });
    return () => { cancelled = true; };
  }, [customerId, godownId, draftLines]);

  /** Bottles/pieces on the shelf for a SKU in the chosen warehouse. The cart's
   *  + button stops here, so an order can never be built past what exists. */
  const maxPiecesFor = useCallback((line: DraftLine) => {
    // A line sourced from another warehouse is capped by THAT warehouse.
    const gid = line.source_godown_id ?? godownId;
    const onShelf = gid
      ? stockLevels.find((l) => l.sku_id === line.sku.id && l.godown_id === gid)?.qty_pieces ?? 0
      : stockLevels.filter((l) => l.sku_id === line.sku.id).reduce((a, l) => a + l.qty_pieces, 0);
    // A product can now sit in the cart TWICE — a full carton and bottles in a
    // mixed carton. Each entry may only claim what the other has not, or the
    // two together would oversell a shelf that holds one of them.
    const heldElsewhere = draftLines
      .filter((l) => l.sku.id === line.sku.id && l.key !== line.key)
      .reduce((a, l) => a + l.qty_pieces, 0);
    return Math.max(0, onShelf - heldElsewhere);
  }, [godownId, stockLevels, draftLines]);

  /** One step of whatever unit this line is sold in — a carton for a carton
   *  line, a pack for a pack line, a bottle for a mixed-carton fill. Every
   *  product behaves the same way; only the unit differs, and it comes from
   *  the line rather than from anything hardcoded.
   *
   *  qty_pieces and line_total are kept in step because the cart displays them,
   *  but Postgres re-derives both on save from uom and qty (rule 1) — these are
   *  never the numbers that get stored. */
  const changeLineQty = useCallback((key: string, delta: number) => {
    setDraftLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      const mixed = !!l.sku.mixed_carton_pieces && l.is_mixed_carton_fill;
      const per = mixed ? 1
        : l.uom === "carton" ? l.sku.pcs_per_pack * l.sku.packs_per_carton
        : l.uom === "pack" ? l.sku.pcs_per_pack : 1;
      const nextQty = Math.max(1, l.qty + delta);
      const nextPieces = Math.round(nextQty * per);
      // Never step past the shelf.
      if (delta > 0 && nextPieces > maxPiecesFor(l)) return l;
      return {
        ...l,
        qty: nextQty,
        qty_pieces: nextPieces,
        line_total_mvr: nextQty * l.unit_price_mvr,
      };
    }));
  }, [maxPiecesFor]);

  const removeLine = useCallback((key: string) => {
    setDraftLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  /** Mixed-carton brands that do not yet add up to whole cartons. Place Order
   *  is blocked on this, so the shortfall is caught in the cart instead of
   *  coming back as a database error after the final tap (migration 0163). */
  const shortfalls = useMemo(() => cartShortfalls(draftLines), [draftLines]);
  // A product cannot be BOTH part of a mixed carton and a loose single in one
  // order — see cartMixConflicts. Blocked beside the shortfall, for the same
  // reason and in the same place.
  const mixConflicts = useMemo(() => cartMixConflicts(draftLines), [draftLines]);

  /**
   * Is the chosen warehouse actually the right one for this basket?
   *
   * 93% of orders ship from the default, so a "did you pick a warehouse?"
   * prompt on every order would be dismissed reflexively within a week — and
   * then ignored on the 7% that matter. So this stays silent unless the
   * basket itself says the choice is wrong: a line the chosen warehouse
   * cannot cover, where the other one can.
   */
  const godownCheck = useMemo(() => {
    if (!godownId || draftLines.length === 0) return null;
    const need = new Map<string, number>();
    for (const l of draftLines) need.set(l.sku.id, (need.get(l.sku.id) ?? 0) + l.qty_pieces);

    const qtyIn = (skuId: string, gid: string) =>
      stockLevels.find((s) => s.sku_id === skuId && s.godown_id === gid)?.qty_pieces ?? 0;

    const short = [...need.entries()].filter(([skuId, pieces]) => qtyIn(skuId, godownId) < pieces);
    if (short.length === 0) return null;

    // Would another warehouse cover the WHOLE basket? Only then is a
    // one-tap switch honest advice rather than a different problem.
    const better = godowns.find((g) =>
      g.id !== godownId && [...need.entries()].every(([skuId, pieces]) => qtyIn(skuId, g.id) >= pieces));

    const names = short
      .map(([skuId]) => draftLines.find((l) => l.sku.id === skuId)?.sku)
      .filter(Boolean)
      .map((s) => `${s!.model_name} ${s!.variant_display ?? ""}`.trim());

    return { shortCount: short.length, names, better: better ?? null };
  }, [godownId, draftLines, stockLevels, godowns]);


  function handleScanResult(code: string) {
    setShowScanner(false);
    const match = skus.find(
      (s) => s.internal_code === code || s.supplier_barcode === code,
    );
    if (match) {
      setSelectedSkuId(match.id);
      setSkuSearch("");
      toast.success(`Found: ${match.brand_name} ${match.variant_display}`);
    } else {
      setSkuSearch(code);
      toast.warning(`No SKU matched "${code}" — showing search results`);
    }
  }

  // The actual add — reached directly for healthy prices, or via the
  // below-cost confirm sheet. Both entry doors share one guard.
  function doAddLine() {
    if (!selectedSku || !lineQty || !linePrice || lineQtyPieces <= 0) return;
    const incomingMixed = lineUom === "piece" && mixedCarton;
    const joinTo = incomingMixed
      ? undefined
      : draftLines.find((l) => l.sku.id === selectedSku.id && !l.is_mixed_carton_fill);

    if (joinTo) {
      // ADDING THE SAME PRODUCT AGAIN JOINS THE LINE. IT DOES NOT REFUSE.
      //
      // Ali, 2026-08-16: *"I try to sell 1 carton and 2 packs of Royal soft
      // boys… I have to add one carton, set the price manually since I'm giving
      // a discount and again press add to order and add 2 packs."* That second
      // add was refused outright, so the sale could not be entered at all.
      //
      // He had already asked for this on 2026-08-09 — the quote is at the top
      // of cart-math.ts — and it was built for DIFFERENT products. The same
      // product in two units stayed blocked by a UNIQUE (order_id, sku_id)
      // added back in migration 0060, whose own header calls it a "known
      // limitation (accepted)". Its real reason is that stock_movements records
      // (order, sku) and not which LINE, so two lines of one product would make
      // returns and line edits reverse the wrong stock. That constraint is
      // worth keeping; refusing him was not.
      //
      // So the two adds become one line: the pieces add up, the money adds up,
      // and the unit becomes the finer of the two (a carton is a whole number
      // of packs, so the arithmetic always lands on a whole quantity — which is
      // what the ledger's qty_pieces trigger demands).
      const rank = { carton: 3, pack: 2, piece: 1 } as const;
      const uom = rank[lineUom] < rank[joinTo.uom] ? lineUom : joinTo.uom;
      const per = uom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton
                : uom === "pack"   ? selectedSku.pcs_per_pack
                : 1;
      const pieces = joinTo.qty_pieces + lineQtyPieces;
      const total  = joinTo.line_total_mvr + lineTotal;
      const qty    = pieces / per;

      setDraftLines((prev) => prev.map((l) => l.key !== joinTo.key ? l : {
        ...l,
        uom, qty, qty_pieces: pieces,
        // One blended rate, because a line carries one price. The TOTAL is
        // exact to the rufiyaa — it is the two figures he typed, added.
        unit_price_mvr: total / qty,
        line_total_mvr: total,
        merged_units: l.merged_units || l.uom !== lineUom,
      }));
      // Says what it did, in trade units. A silent join on a screen that used
      // to show a red error would read as the same refusal.
      toast.success(
        `Added to ${selectedSku.brand_name} ${selectedSku.model_name} — now `
        + `${formatQtyInTradeUnits(pieces, tradeCfg(selectedSku))}, `
        + `MVR ${mvr(total)}`,
      );
    } else {
      // Same confirmation as the carton sheet — every add says so, whatever the
      // product. The editor closes on add, so silence is indistinguishable from
      // a tap that did not register.
      toast.success(
        `Added ${parseFloat(lineQty)} ${sellUnitLabel(lineUom, tradeCfg(selectedSku))} of ${selectedSku.brand_name} ${selectedSku.model_name}`,
      );
      setDraftLines((prev) => [...prev, {
        key: `${selectedSku.id}-${Date.now()}`,
        sku: selectedSku, uom: lineUom, qty: parseFloat(lineQty),
        qty_pieces: lineQtyPieces, unit_price_mvr: parseFloat(linePrice), line_total_mvr: lineTotal,
        is_mixed_carton_fill: incomingMixed,
      }]);
    }
    setSelectedSkuId(""); setSkuSearch(""); setLineQty(""); setLinePrice(""); setLineUom("pack");
    setMixedCarton(false); setPriceManuallyEdited(false); setAutoPriceSource(null);
  }

  const [editorBelowCostConfirm, setEditorBelowCostConfirm] = useState(false);

  function handleAddLine() {
    if (!selectedSku || !lineQty || !linePrice || lineQtyPieces <= 0) return;
    // One line per product per order — sales_order_lines has a UNIQUE
    // (order_id, sku_id), and edit_sales_order_line depends on that to scope
    // its FIFO stock reversal safely. That rule stays; what changed is the
    // ANSWER to it. Adding the same product again now JOINS the existing line
    // (see doAddLine) instead of refusing, so one line per product is kept by
    // arithmetic rather than by a red message.
    //
    // EITHER WE JOIN, OR WE REFUSE — never a second line. Written as one test
    // rather than two on purpose: a first draft refused only the mixed-carton
    // CLASH, which quietly let two mixed-carton fills of one product through to
    // a UNIQUE violation at the final tap. The audit's own mutation output
    // showed the cart holding two lines, which is exactly the failure the old
    // blanket refusal existed to prevent.
    //
    // Mixed cartons are the case that cannot join: a mixed carton and an
    // ordinary line are two different purchases with their own carton
    // arithmetic — the cart lists them under separate headings — and folding
    // them together would break the whole-carton assertion that stops a part
    // carton reaching checkout.
    const incomingMixed = lineUom === "piece" && mixedCarton;
    const canJoin = !incomingMixed
      && draftLines.some((l) => l.sku.id === selectedSku.id && !l.is_mixed_carton_fill);
    if (!canJoin && draftLines.some((l) => l.sku.id === selectedSku.id)) {
      toast.error(`${selectedSku.brand_name} ${selectedSku.variant_display} is already in this order as a mixed carton — finish that one first`);
      return;
    }
    const landed = selectedSku.landed_per_piece_mvr;
    const mult = lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton
               : lineUom === "pack" ? selectedSku.pcs_per_pack : 1;
    const pricePerPiece = parseFloat(linePrice) / mult;
    if (landed != null && pricePerPiece < landed) {
      setEditorBelowCostConfirm(true);
      return;
    }
    doAddLine();
  }

  // Create order + lines + immediately confirm (post_sale) in one shot
  async function handleSubmit() {
    if (draftLines.length === 0) return;
    setSaving(true);
    try {
      const cust = customers.find((c) => c.id === customerId);
      const orderPayload = {
        order_number: orderNumber,
        customer_id: customerId && customerId !== "walkin" ? customerId : null,
        channel: cust?.channel ?? channel,
        status: "draft" as const,
        source_godown_id: godownId || null,
        payment_method: paymentMethod,
        payment_status: "pending" as const,
        notes: orderNotes.trim() || null,
      };
      // qty_pieces and line_total_mvr are deliberately NOT sent — Postgres
      // derives both from the SKU's own pack/carton configuration, so the
      // stored numbers can't drift from the price and quantity actually
      // agreed (hard rule 1: money math lives in Postgres).
      // The CART may hold a product twice — a full carton and bottles inside
      // a mixed carton are different purchases and are shown apart. The
      // DATABASE allows one row per product per order
      // (sales_order_lines_order_sku_uniq), so they are combined here, at the
      // last possible moment.
      //
      // Combining is lossless for everything that counts: both sides are
      // priced off the same carton rate, so the money is identical, and the
      // stock is the same pieces off the same shelf. Only the presentation
      // differs, and the presentation has already done its job by then.
      // ── ONE ROW PER PRODUCT, AND THE MONEY MUST SURVIVE IT ────────────
      //
      // `sales_order_lines_order_sku_uniq` allows one row per product per
      // order, so a cart holding a whole carton AND loose bottles of the same
      // colour has to be merged. How it merges decides two things that can
      // both go wrong silently.
      //
      // THE MONEY. The old merge recomputed the price from the CARTON rate.
      // That was safe while the only two kinds were a carton and a mixed fill,
      // because both are billed at the carton rate — and it breaks the moment a
      // third rate exists. Today the gap is small, because four of the five
      // Sosoft quote MVR 37 a bottle and that IS the carton rate divided by six
      // (220 + 74 = MVR 294 against 8 x 36.67 = MVR 293.33). It stops being
      // small the day Ali sets a real single-bottle premium, which is exactly
      // what register item D5 is waiting on: at MVR 40 a bottle the same basket
      // is MVR 300 and the old merge would have billed MVR 293.33.
      // So the merged price is now the BLEND that preserves the total, and
      // Postgres stores line_total as round(qty x unit_price, 2) — exactly what
      // this produces.
      //
      // THE UNIT. `assert_whole_mixed_cartons` sums every line marked
      // `is_mixed_carton_fill` per brand and refuses a total that is not a
      // whole number of cartons. Merging loose singles into a fill row would
      // therefore refuse a perfectly legitimate purchase — "4 short of a full
      // carton" for a carton plus two bottles. A merge with no fill in it is
      // written as a PACK line instead, which that rule never looks at.
      const bySku = new Map<string, DraftLine[]>();
      for (const l of draftLines) {
        const g = bySku.get(l.sku.id);
        if (g) g.push(l); else bySku.set(l.sku.id, [l]);
      }
      const linePayloads = [...bySku.values()].map((group) => {
        const first = group[0];
        if (group.length === 1) {
          return {
            sku_id: first.sku.id, uom: first.uom, qty: first.qty,
            unit_price_mvr: first.unit_price_mvr,
            is_mixed_carton_fill: first.is_mixed_carton_fill,
            source_godown_id: first.source_godown_id ?? null,
          };
        }
        const pieces = group.reduce((a, l) => a + l.qty_pieces, 0);
        const total  = group.reduce((a, l) => a + l.line_total_mvr, 0);
        const anyMixed = group.some((l) => l.is_mixed_carton_fill);
        // A merge never silently moves stock to a different warehouse.
        const godown = group.find((l) => l.source_godown_id)?.source_godown_id ?? null;

        if (anyMixed) {
          // Unchanged behaviour: a mixed fill plus whole cartons of the same
          // colour. The cartons' pieces are a multiple of the carton size, so
          // adding them leaves the whole-carton check exactly where it was.
          return {
            sku_id: first.sku.id, uom: "piece" as SaleUom, qty: pieces,
            unit_price_mvr: total / pieces,
            is_mixed_carton_fill: true,
            source_godown_id: godown,
          };
        }
        const perPack = first.sku.pcs_per_pack || 1;
        return {
          sku_id: first.sku.id, uom: "pack" as SaleUom, qty: pieces / perPack,
          unit_price_mvr: total / (pieces / perPack),
          is_mixed_carton_fill: false,
          source_godown_id: godown,
        };
      });

      // One RPC = one transaction: the order, its lines and the FIFO stock
      // deduction all commit together or not at all. The old three-step
      // client sequence could leave the order and lines saved with stock
      // never deducted if the connection dropped in between — that is
      // exactly how SO-2026-076 ended up delivered with no stock movement.
      // offlineKey makes a retry idempotent rather than a duplicate sale.
      const { queued } = await withOfflineFallback(
        () => createAndPostSale(orderPayload, linePayloads, offlineKey),
        {
          table: "sales_orders",
          action: "rpc",
          rpcName: "create_and_post_sale",
          payload: {
            p_order: orderPayload,
            p_lines: linePayloads,
            p_offline_key: offlineKey,
          },
          tempId: offlineKey,
        },
      );

      if (queued) {
        toast.warning(
          "You're offline — this sale is saved on this phone and will be sent when you reconnect. Stock is not deducted yet.",
          { duration: 6000 },
        );
        onClose();
      } else {
        toast.success("Order placed — stock deducted");
        // result is the created order but onCreated needs the ID;
        // reload the list to pick up the new order
        onCreated("reload");
      }
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  const stepLabels: Record<Step, string> = { 1: "Customer", 2: "Products", 3: "Confirm" };

  // Portalled to document.body: this is a full-screen `position: fixed`
  // takeover, and the app shell's content wrapper carries its own
  // `z-[1]` stacking context (needed so it paints above the wallpaper's
  // ::before pseudo-element). Any fixed layer nested inside that wrapper
  // is capped at that context's ceiling and can never out-rank the
  // shell's own always-on-top Topbar/BottomNav (z-40), no matter its own
  // z-index — same reasoning as the price-explain sheet's portal below.
  if (!portalReady) return null;
  return createPortal(
    // ── Three layouts, one component ─────────────────────────────────────────
    // Ali, 2026-08-09: "this is a Retina display mobile view first app but it
    // must be different for tablet and desktop completely with proper design."
    //
    // PHONE  (<768) full-screen takeover, three steps. Unchanged — it is what
    //        he uses every day and it is right for one thumb.
    // TABLET (md, 768-1023) the same three steps, but as a centred window with
    //        the app visible behind it, instead of one phone screen stretched
    //        to fill an iPad. A modal that eats a large screen for a creation
    //        task is an iPhone pattern, not an iPadOS/macOS one.
    // DESKTOP (lg, 1024+) the window widens and the ORDER moves into a rail on
    //        the right that is visible during all three steps — the standard
    //        desktop checkout shape. The cart stops being something you scroll
    //        to and becomes something you watch while you price.
    //
    // Deliberately ONE component with responsive classes, not a desktop fork.
    // Every guard that protects money — the below-cost confirm, whole mixed
    // cartons, the stock cap, the cross-godown pick — hangs off these same
    // handlers and this same footer button. A second component would be a
    // second door, and the standing rule here is one guard, every door.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New sale"
      className="fixed inset-0 z-50 flex flex-col md:items-center md:justify-center md:p-6 lg:p-8"
      style={{ touchAction: "none" }}
      onTouchMove={(e) => e.stopPropagation()}
    >
      {/* Scrim — tablet and desktop only. On a phone the sheet IS the screen,
          so there is nothing to dim. */}
      <div className="hidden md:block absolute inset-0 snm-scrim-in"
        style={{ background: "color-mix(in srgb, var(--background) 55%, transparent)", backdropFilter: "blur(8px)" }}
        onClick={onClose} aria-hidden />

      <div
        // 100dvh = dynamic viewport height — shrinks when the keyboard opens on
        // iOS 15.4+. CSS-native, no JS measurement. Never 100vh (standing rule:
        // it ignores the iOS dynamic toolbar).
        className="relative flex flex-col w-full glass-wallpaper glass-wallpaper--calm
                   h-[100dvh] md:h-[92dvh] md:max-h-[920px]
                   md:rounded-3xl md:overflow-hidden md:max-w-3xl lg:max-w-6xl md:shadow-2xl"
        style={{ border: "0.5px solid var(--glass-border-lo)" }}
      >

      {/* Header — safe-area aware, clears Dynamic Island / notch */}
      <header className="glass-panel--strong px-5 shrink-0 relative z-[1]" style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none", borderBottom: "0.5px solid var(--glass-border-lo)" }}>
        {/* Visible row sits BELOW the safe area inset */}
        <div className="flex items-center justify-between py-3.5" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="flex items-center gap-3">
            {/* 60% measured 4.19:1 — under the 4.5 floor. 72% clears it, and
                it is the close control on a money screen, so it should not be
                the faintest thing on it. Helps every palette, not just Soft. */}
            {/* A BARE GLYPH IS NOT A TARGET. This measured 17x28 — the ✕ itself,
                with nothing around it — on the sheet where every sale starts.
                min-w/min-h-11 with the glyph centred keeps it looking identical
                and makes the box what the browser routes the tap to. */}
            <button onClick={onClose} aria-label="Close new sale"
              className="text-foreground opacity-[0.72] active:opacity-100 text-xl min-h-11 min-w-11 -ml-2 flex items-center justify-center">✕</button>
            <span className="text-[18px] font-bold text-foreground tracking-tight">New Sale</span>
          </div>
          <span className="snm-num ios-subhead font-mono" style={{ color: "var(--muted-foreground)" }}>
            {orderNumber || "Assigned on save"}
          </span>
        </div>

        {/* Step indicator — moved OUT of the scrolling body and into the fixed
            header, and a finished step is now tappable.

            Two things fall out of that. It is always on screen, so you can
            always see where you are; and it becomes the way BACK, which frees
            the footer to hold two buttons instead of three. At 393pt three
            buttons wrapped "Add product" and "Review & Confirm" onto two lines
            each — that was the "unorganized" look, measured in a browser at
            Ali's device size rather than guessed at.

            Backwards only. Going forward still has to pass the checks in the
            footer buttons (a customer chosen, a cart with whole cartons in
            it); a breadcrumb must never be a way around them. */}
        <div className="flex items-center gap-2 pb-3">
          {([1, 2, 3] as Step[]).map((s) => {
            const done = step > s;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => setStep(s)}
                  aria-label={done ? `Back to ${stepLabels[s]}` : undefined}
                  className="flex items-center gap-2 min-w-0 min-h-11 disabled:cursor-default"
                >
                  <span className="h-6 w-6 rounded-full flex items-center justify-center ios-subhead font-bold shrink-0 transition-all"
                    style={step === s ? { background: "var(--glass-accent)", color: "var(--snm-brand-on)" }
                      : done ? { background: "color-mix(in srgb, var(--snm-success) 20%, transparent)", color: "var(--snm-success)" }
                      : { background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                    {done ? "✓" : s}
                  </span>
                  <span className="ios-subhead truncate"
                    style={{ color: step === s || done ? "var(--foreground)" : "var(--muted-foreground)" }}>
                    {stepLabels[s]}
                  </span>
                </button>
                {s < 3 && <div className="flex-1 h-px bg-border" />}
              </div>
            );
          })}
        </div>
      </header>

      {/* Content — takes all remaining space; touch-action auto re-enables scrolling inside.
          overscroll-behavior is CONTAIN, never none. Both stop the scroll
          chaining to the page underneath this full-screen sheet, but `none`
          also kills the rubber-band bounce, which is the iOS signature and a
          standing rule here (see globals.css) — with it set, this sheet felt
          dead against every other screen in the app. `contain` keeps the
          bounce and still traps the scroll. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden px-5 lg:px-8 pb-6 lg:pb-0"
        style={{
          touchAction: "pan-y",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        } as React.CSSProperties}
      >
      {/* Scroll ownership.
          PHONE/TABLET: one scroller — this element — and the columns just flow.
          DESKTOP: a split pane, where each column owns its own scroll. That is
          the one exception the standing rule allows, and it is needed here: a
          sticky rail inside a single scroller gets clipped the moment the order
          is taller than the window, and the first thing to disappear is the
          TOTAL. An order total you cannot reach is not a layout preference. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8 lg:h-full lg:min-h-0">
        <div className="space-y-5 min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-8 lg:pr-1"
          style={{ overscrollBehavior: "contain" }}>

        {/* ── Step 1: Customer ── */}
        {step === 1 && (
          <div className="space-y-4">
            {!customerId && !showNewCustomer && (
              <>
                <div className="flex gap-2">
                  <SearchField autoFocus value={customerSearch} onChange={setCustomerSearch}
                    label="Search customers" placeholder="Search name, phone…" className="flex-1" />
                  <button onClick={() => setShowNewCustomer(true)}
                    className="flex items-center gap-1.5 h-12 px-4 rounded-xl text-sm font-semibold transition"
                    style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>
                    <UserPlus className="h-4 w-4" /> New
                  </button>
                </div>

                <div>
                  {/* Pinned recent chips — 1-tap reselect for repeat orders */}
                  {!customerSearch.trim() && recentIds.length > 0 && (
                    <div className="flex gap-2 mb-3 flex-wrap">
                      {recentIds.map((id) => {
                        const rc = customers.find((c) => c.id === id);
                        if (!rc) return null;
                        return (
                          <button
                            key={id}
                            onClick={() => { const rc2 = customers.find((c) => c.id === id); setCustomerId(id); setOrderTier(rc2?.price_tier ?? "retail"); setChannel((rc2?.channel as OrderChannel) ?? "whatsapp"); touchRecentCustomer(id); }}
                            className="flex items-center gap-2 px-3 min-h-11 rounded-full ios-subhead font-semibold transition active:scale-95"
                            style={{
                              background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--snm-brand) 25%, transparent)",
                              color: "var(--snm-brand-text)",
                            }}
                          >
                            ★ {rc.name.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[12px] uppercase tracking-widest mb-3 font-medium" style={{ color: "var(--muted-foreground)" }}>
                    {customerSearch.trim() ? "Results" : "All Customers"}
                  </p>
                  <div className="space-y-1.5">
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).map((c) => {
                      const initials = c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                      return (
                        <button key={c.id}
                          onClick={() => { setCustomerId(c.id); setOrderTier(c.price_tier ?? "retail"); setChannel((c.channel as OrderChannel) ?? "whatsapp"); touchRecentCustomer(c.id); }}
                          className="w-full flex items-center gap-3 px-4 h-14 rounded-xl text-left transition active:scale-[0.99]"
                          style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                          <div className="h-9 w-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}>
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold text-foreground truncate">{c.name}</p>
                            <p className="ios-subhead truncate" style={{ color: "var(--muted-foreground)" }}>{[c.island, c.channel].filter(Boolean).join(" · ")}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                        </button>
                      );
                    })}
                    {(customerSearch.trim() ? filteredCustomers : recentCustomers).length === 0 && (
                      <p className="ios-subhead py-4 text-center" style={{ color: "var(--muted-foreground)" }}>
                        {customerSearch.trim() ? "No matches." : "No customers yet."}
                      </p>
                    )}
                  </div>
                </div>

                <button onClick={() => setCustomerId("walkin")}
                  className="w-full h-12 rounded-xl text-sm font-semibold transition"
                  style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--muted-foreground)" }}>
                  Walk-in / No account
                </button>
              </>
            )}

            {showNewCustomer && !customerId && (
              <div className="rounded-xl py-4 flex flex-col" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", maxHeight: "70dvh" }}>
                <p className="ios-subhead font-bold text-foreground flex items-center gap-2 px-5 pb-2 shrink-0">
                  <UserPlus className="h-4 w-4" /> New Customer
                </p>
                {/* Same canonical form used on the Customers page — identical fields */}
                <CustomerForm
                  saveLabel="Create & Select"
                  existing={customers}
                  onPickExisting={(c) => {
                    setCustomerId(c.id);
                    setOrderTier(c.price_tier ?? "retail");
                    setChannel((c.channel as OrderChannel) ?? "whatsapp");
                    touchRecentCustomer(c.id);
                    setShowNewCustomer(false);
                  }}
                  onCancel={() => setShowNewCustomer(false)}
                  onSaved={(created) => {
                    onCustomerCreated(created);
                    setCustomerId(created.id);
                    setOrderTier(created.price_tier ?? "retail");
                    setChannel((created.channel as OrderChannel) ?? "whatsapp");
                    touchRecentCustomer(created.id);
                    setShowNewCustomer(false);
                  }}
                />
              </div>
            )}

            {customerId && customerId !== "walkin" && customer && (
              <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
                {/* Customer identity row */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">{customer.name}</p>
                    <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>{[customer.phone, customer.island, customer.channel].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button onClick={() => { setCustomerId(""); setCustomerSearch(""); setOrderTier("retail"); }}
                    className="ios-subhead font-semibold px-3 min-h-11 rounded-lg transition active:scale-95"
                    style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                    Change
                  </button>
                </div>

                {/* Order-level pricing tier — defaults to customer's tier, overrideable per order */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] uppercase tracking-widest font-semibold" style={{ color: "var(--muted-foreground)" }}>
                      Pricing tier for this order
                    </p>
                    {orderTier !== customer.price_tier && (
                      <button onClick={() => setOrderTier(customer.price_tier)}
                        className="ios-subhead font-semibold"
                        style={{ color: "var(--snm-brand-text)" }}>
                        Reset to default ({customer.price_tier})
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(["retail", "wholesale", "vip", "promo"] as PriceTier[]).map((t) => {
                      const isDefault = t === customer.price_tier;
                      const isActive = t === orderTier;
                      return (
                        <button key={t} type="button" onClick={() => setOrderTier(t)}
                          className="py-2 rounded-xl ios-subhead font-semibold capitalize transition active:scale-95 relative"
                          style={isActive
                            ? { background: "var(--glass-accent)", color: "var(--snm-brand-on)" }
                            : { background: "color-mix(in srgb, var(--foreground) 7%, transparent)", color: "var(--muted-foreground)" }}>
                          {t}
                          {isDefault && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ background: "var(--glass-accent)" }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                    {orderTier !== customer.price_tier
                      ? `⚠ Override active — customer's default is ${customer.price_tier}`
                      : `Default tier for ${customer.name.split(" ")[0]}`}
                  </p>
                </div>
              </div>
            )}
            {customerId === "walkin" && (
              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
                <div>
                  <p className="text-[14px] font-semibold text-foreground">Walk-in customer</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>No account</p>
                </div>
                <button onClick={() => setCustomerId("")} className="ios-subhead text-foreground opacity-60 active:opacity-100">Change</button>
              </div>
            )}

            {customerId && (
              <GlassSelect label="Order received via" value={channel} onChange={(v) => setChannel(v as OrderChannel)}>
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </GlassSelect>
            )}
          </div>
        )}

        {/* ── Step 2: Products ── */}
        {step === 2 && (
          <div className="space-y-4">
            <WarehouseSelect value={godownId} onChange={setGodownId} godowns={godowns} />

            {/* Everything below needs the warehouse settled first: it decides
                which stock is checked, which stock gets deducted, and whether
                a product reads as in stock at all. Gating here rather than
                nagging later means the choice is made once, before any of
                those answers can be computed from the wrong place. */}
            {!godownId ? (
              <p className="ios-subhead px-1" style={{ color: "var(--muted-foreground)" }}>
                Pick the warehouse this order ships from — stock and availability are
                counted from there.
              </p>
            ) : (
            <>
            {/* Repeat last order — the fastest possible order entry for a
                repeat customer. Shown only while the cart is still empty so
                it never competes with an in-progress basket. */}
            {!selectedSkuId && draftLines.length === 0 && lastOrder && (
              <button
                onClick={repeatLastOrder}
                className="w-full flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 transition active:scale-[0.98]"
                style={{
                  background: "color-mix(in srgb, var(--snm-brand) 10%, var(--glass-1))",
                  border: "1px solid var(--snm-brand-border)",
                  boxShadow: "var(--glass-shadow), var(--glass-inner)",
                }}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <RotateCcw className="h-4 w-4 shrink-0" style={{ color: "var(--snm-brand)" }} />
                  <span className="text-left min-w-0">
                    <span className="block text-[14px] font-semibold text-foreground">Repeat last order</span>
                    <span className="block ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                      {lastOrder.lines.length} item{lastOrder.lines.length !== 1 ? "s" : ""} · {mvtInstant(lastOrder.createdAt)} · today&rsquo;s prices
                    </span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
              </button>
            )}

            {/* Product picker */}
            {!selectedSkuId ? (
              <div className="space-y-3" ref={productSearchRef}>
                <div className="flex items-center gap-2">
                  <SearchField value={skuSearch} onChange={setSkuSearch}
                    label="Search products" placeholder="Search brand, product, variant…" className="flex-1" />
                  {/* Scan button */}
                  <button
                    onClick={() => setShowScanner(true)}
                    style={{
                      width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                      background: "var(--snm-brand)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: "none", cursor: "pointer",
                      boxShadow: "0 4px 16px color-mix(in srgb, var(--snm-brand) 40%, transparent)",
                    }}
                    aria-label="Scan barcode"
                  >
                    <ScanLine size={20} color="var(--snm-brand-on)" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[...mixedCartonGroups.entries()].map(([brandId, groupSkus]) => {
                    const first = groupSkus[0];
                    const piecesNeeded = first.mixed_carton_pieces!;
                    const totalStock = groupSkus.reduce((sum, s) => {
                      const pcsPerCarton = s.pcs_per_pack * s.packs_per_carton || 1;
                      const stock = godownId
                        ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0
                        : stockLevels.filter((l) => l.sku_id === s.id).reduce((a, l) => a + l.qty_pieces, 0);
                      return sum + Math.floor(stock / pcsPerCarton);
                    }, 0);
                    const cartonPrice = first.selling_price_per_carton_mvr;
                    const outOfStock = totalStock <= 0;
                    // Every line for this brand counts, not just mixed fills —
                    // a single-colour carton is an ordinary carton line now.
                    // Kept in PIECES and formatted at the end: dividing here
                    // produced the raw "1.6666666666666667 cartons in cart".
                    const inCartPieces = draftLines
                      .filter((l) => groupSkus.some((s) => s.id === l.sku.id))
                      .reduce((a, l) => a + l.qty_pieces, 0);
                    return (
                      <button key={brandId} onClick={() => !outOfStock && setMixedCartonBrandId(brandId)}
                        disabled={outOfStock}
                        className="w-full rounded-2xl p-4 text-left transition active:scale-[0.98]"
                        style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", cursor: outOfStock ? "default" : "pointer" }}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="ios-headline font-semibold" style={{ color: outOfStock ? "var(--muted-foreground)" : "var(--foreground)" }}>
                            {first.brand_name}
                          </p>
                          <span className="ios-footnote font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "color-mix(in srgb, var(--snm-brand) 12%, transparent)", color: "var(--snm-brand-text)" }}>
                            Add cartons
                          </span>
                        </div>
                        <p className="ios-footnote mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                          {groupSkus.length} colours · one colour or mixed, any quantity
                        </p>
                        <div className="flex items-end justify-between gap-2 mt-3" style={{ opacity: outOfStock ? 0.55 : 1 }}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-semibold" style={{ fontSize: 22, letterSpacing: "-0.02em", color: cartonPrice != null ? "var(--foreground)" : "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
                              {cartonPrice != null ? mvr(cartonPrice) : "No GRN"}
                            </span>
                            {cartonPrice != null && <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>MVR / carton</span>}
                          </div>
                          <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                            {outOfStock ? "Out of stock" : `${totalStock} ctn in stock`}
                          </p>
                        </div>
                        {inCartPieces > 0 && (
                          <span className="ios-footnote font-semibold shrink-0 px-2 py-0.5 rounded-full inline-block mt-2"
                            style={{ color: "var(--snm-brand-text)", background: "var(--snm-brand-muted)" }}>
                            {formatMixedCartonQty(inCartPieces, piecesNeeded, first.unit_uom as UnitUom | null)} in cart
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {brandModelGroups.map(({ brandId, brandName, models }) => (
                    <div key={brandId} className="col-span-1 sm:col-span-2">
                      {/* Brand — fixed section label, never collapses, always visible */}
                      <p className="label-caps text-[12px] px-1 pt-2 pb-1.5" style={{ color: "var(--muted-foreground)" }}>
                        {brandName}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {models.map(({ modelId, modelName, skus: modelSkus }) => {
                          // Every model behaves identically: collapsed by
                          // default, tap to expand. Search still force-
                          // expands so a typed match is never hidden.
                          const expanded = skuSearch.trim() !== "" || expandedModels.has(modelId);
                          return (
                            <div key={modelId} className="col-span-1 sm:col-span-2">
                              <button
                                onClick={() => toggleModel(modelId)}
                                aria-expanded={expanded}
                                className="w-full flex items-center gap-1.5 px-3 min-h-11 rounded-xl transition active:scale-[0.99]"
                                style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
                              >
                                <ChevronDown
                                  className="h-3.5 w-3.5 shrink-0 transition-transform"
                                  style={{ color: "var(--muted-foreground)", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
                                />
                                <p className="ios-subhead font-semibold text-left flex-1" style={{ color: "var(--foreground)" }}>
                                  {modelName}
                                </p>
                                <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                                  {modelSkus.length} SKU{modelSkus.length !== 1 ? "s" : ""}
                                </p>
                              </button>
                              {expanded && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                                  {modelSkus.map((s) => {
                    const stock = godownId ? stockLevels.find((l) => l.sku_id === s.id && l.godown_id === godownId)?.qty_pieces ?? 0 : null;
                    // Stock in OTHER godowns — so a product held in another warehouse
                    // is never mistaken for out-of-stock (would lose a real sale).
                    const otherGodownStock = stockLevels
                      .filter((l) => l.sku_id === s.id && l.godown_id !== godownId && l.qty_pieces > 0)
                      .map((l) => ({ name: godowns.find((g) => g.id === l.godown_id)?.name ?? "another godown", qty: l.qty_pieces }))
                      .sort((a, b) => b.qty - a.qty);
                    const elsewhereTotal = otherGodownStock.reduce((sum, g) => sum + g.qty, 0);
                    const pl = packLabel(s);
                    // Show price per default UOM on the card — tier price takes priority
                    const cardUom = defaultUom(s);
                    const tp = tierPrices.get(s.id);
                    const cardPrice = tp
                      ? (cardUom === "carton" ? tp.price_per_carton_mvr : tp.price_per_pack_mvr)
                      : (cardUom === "carton" ? s.selling_price_per_carton_mvr : s.selling_price_per_pack_mvr);
                    const cardUomLabel = cardUom === "carton" ? "carton" : pl.toLowerCase();
                    const hasPrice = cardPrice != null;

                    // Where did this price come from? Classify against the same
                    // source the RPC resolved + the SKU's cost/target so the
                    // salesperson never sells on a mystery number. Normalise the
                    // shown price to per-piece so margin math is unit-agnostic.
                    const cardPricePerPiece = cardPrice == null ? null
                      : cardUom === "carton" ? cardPrice / (s.pcs_per_pack * s.packs_per_carton)
                      : cardPrice / s.pcs_per_pack;
                    // A fixed price can come from any of three columns (per-piece
                    // default, or a per-pack/per-carton volume-break override —
                    // v_skus.selling_price_per_pack/carton_mvr prefers the tier
                    // override first). Checking only fixed_selling_price_mvr here
                    // missed that case entirely, leaving the card with NO source
                    // tag and no below-cost warning even though cardPrice itself
                    // was correctly reading the override.
                    const hasFixedOverride = s.fixed_selling_price_mvr != null
                      || (cardUom === "carton" ? s.fixed_price_per_carton_mvr != null : s.fixed_price_per_pack_mvr != null);
                    const cardProvenance = describePriceSource({
                      source: tp ? tp.source : (hasFixedOverride ? "sku_default" : (s.target_margin_pct ? "margin" : null)),
                      priceListName: tp?.price_list_name,
                      priceListDate: tp?.price_list_date,
                      pricePerPiece: cardPricePerPiece,
                      landedPerPiece: s.landed_per_piece_mvr,
                      targetMarginPct: s.target_margin_pct,
                    });
                    const inCart = draftLines.filter((l) => l.sku.id === s.id).reduce((a, l) => a + l.qty, 0);

                    // Work & Co: quick-add adds 1 unit of the default UOM directly to cart.
                    // Tapping the card body still opens the detail editor for custom qty/price.
                    function handleQuickAdd(e: React.MouseEvent) {
                      e.stopPropagation();
                      // Allow adding when stock exists in ANY godown; block only when
                      // out everywhere. Products in another warehouse are sellable.
                      if (!hasPrice || outOfStock) return;
                      // Below cost: pause for a deliberate choice instead of a
                      // silent one-tap loss (Ali, 12 Jul, with screenshot).
                      if (cardProvenance.belowCost) {
                        setBelowCostAdd({ sku: s, uom: cardUom, price: cardPrice! });
                        return;
                      }
                      pushQuickLine(s, cardUom, cardPrice!);
                    }

                    const hereQty = stock ?? 0;
                    const noneHere = godownId != null && godownId !== "" && hereQty <= 0;
                    // Genuinely unavailable ONLY when zero in every godown. A product
                    // in another warehouse stays sellable (ships from there).
                    const outOfStock = noneHere && elsewhereTotal <= 0;
                    // Convert a piece count into the card's default unit label.
                    const qtyLabel = (pcs: number) => {
                      const dUom = defaultUom(s);
                      if (dUom === "carton" && s.pcs_per_pack > 0 && s.packs_per_carton > 0) {
                        const c = Math.floor(pcs / (s.pcs_per_pack * s.packs_per_carton));
                        return c > 0 ? `${c} ctn` : "< 1 ctn";
                      }
                      if (s.pcs_per_pack > 0) {
                        const p = Math.floor(pcs / s.pcs_per_pack);
                        const pll = packLabel(s).toLowerCase();
                        return p > 0 ? `${p} ${pll}s` : `< 1 ${pll}`;
                      }
                      // No pack config to convert with — still never a bare
                      // piece count on screen; the shared helper decides.
                      return formatQtyInTradeUnits(pcs, tradeCfg(s));
                    };
                    // Availability line: in-stock here / none here but elsewhere / out everywhere.
                    const stockLabel = stock == null ? null
                      : hereQty > 0 ? `${qtyLabel(hereQty)} in stock`
                      : elsewhereTotal > 0 ? `None here · ${qtyLabel(elsewhereTotal)} in ${otherGodownStock[0].name}`
                      : "No stock — tap to add";
                    const inOtherGodown = noneHere && elsewhereTotal > 0;

                    return (
                      <div key={s.id} className="relative">
                        {/* An out-of-stock product is a ROUTE IN, not a dead end.
                            It used to be a disabled card, so a product he owns
                            but has never received — a body butter carried home
                            in a suitcase — could be found and then not acted on,
                            with the only way forward being to abandon the order.
                            Tapping it now opens StockInSheet: quantity, the cost
                            he paid, a selling price, and the sale carries on.
                            The stock rule is untouched; only the friction moved. */}
                        {/* AN ACCESSIBLE NAME, because this card has never had
                            one. VoiceOver read it as its contents — a price, a
                            provenance tag and a stock line — with the product
                            itself buried in the middle. It also gives the touch
                            audit a stable way to open the product step; three CI
                            rounds were spent guessing at a selector for exactly
                            this card, which is what left that step unmeasured
                            while a 36px button sat on it.

                            THE SEPARATOR IS LOAD-BEARING. An aria-label REPLACES
                            the visible text when anything matches this button by
                            its accessible name, so writing the three names with
                            plain spaces silently renamed the card — and the
                            carton-and-packs audit, which finds this row by
                            "Mamypoko · Xtra Kering · L", clicked nothing for
                            thirty seconds. It mirrors what SkuIdentity renders,
                            separator included, so the name a screen reader hears
                            is the name the screen shows. */}
                        <button onClick={() => outOfStock ? setStockInSku(s) : setSelectedSkuId(s.id)}
                          aria-label={`${s.brand_name} · ${s.model_name} · ${s.variant_display}`}
                          className="w-full rounded-2xl p-4 text-left transition active:scale-[0.98]"
                          style={{
                            ...CARD,
                            border: "0.5px solid var(--glass-border-lo)",
                            cursor: "pointer",
                          }}>
                          {/* Identity — same block as every other picker in the app */}
                          <div className="pr-11">
                            <SkuIdentity
                              brandName={s.brand_name} modelName={s.model_name} variantDisplay={s.variant_display}
                              pcsPerPack={s.pcs_per_pack} packsPerCarton={s.packs_per_carton}
                              separator="·"
                              dimmed={outOfStock}
                            />
                          </div>

                          {/* Price + availability — one neutral row, one accent only.
                              Right-padded when the quick-add "+" button is present
                              (absolutely positioned over this same bottom-right corner)
                              so the "in cart" badge wraps clear of it instead of
                              rendering underneath it. */}
                          <div className="flex items-end justify-between gap-2 mt-3" style={{ opacity: outOfStock ? 0.55 : 1, paddingRight: hasPrice && !outOfStock ? 50 : 0 }}>
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="font-semibold" style={{ fontSize: 22, letterSpacing: "-0.02em", color: hasPrice ? "var(--foreground)" : "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
                                  {hasPrice ? mvr(cardPrice!) : "No GRN"}
                                </span>
                                {hasPrice && <span className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>MVR / {cardUomLabel}</span>}
                                {hasPrice && cardProvenance.source && (
                                  <span className="ml-0.5" style={{ position: "relative", top: 1 }}>
                                    <PriceSourceTag provenance={cardProvenance} />
                                  </span>
                                )}
                              </div>
                              <p className="ios-footnote mt-0.5" style={{ color: inOtherGodown ? "var(--snm-info)" : "var(--muted-foreground)", fontWeight: inOtherGodown ? 600 : 400 }}>
                                {stockLabel ?? " "}
                              </p>
                            </div>
                            {inCart > 0 && (
                              <span className="ios-footnote font-semibold shrink-0 px-2 py-0.5 rounded-full"
                                style={{ color: "var(--snm-brand-text)", background: "var(--snm-brand-muted)" }}>
                                {inCart} in cart
                              </span>
                            )}
                          </div>
                        </button>
                        {/* Quick-add — the single brand accent, present only when sellable */}
                        {hasPrice && !outOfStock && (
                          <button
                            onClick={handleQuickAdd}
                            className="absolute bottom-3 right-3 h-11 w-11 rounded-full flex items-center justify-center transition active:scale-90"
                            style={{
                              background: "var(--snm-brand)",
                              color: "var(--snm-brand-on)",
                              fontSize: 20,
                              fontWeight: 600,
                              lineHeight: 1,
                              boxShadow: "0 2px 10px color-mix(in srgb, var(--snm-brand) 35%, transparent)",
                            }}
                            aria-label={`Quick add ${s.brand_name} ${s.variant_display}`}
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {normalSkus.length === 0 && mixedCartonGroups.size === 0 && (
                    <p className="ios-subhead col-span-2 py-4 text-center" style={{ color: "var(--muted-foreground)" }}>
                      {skuSearch.trim()
                        ? "No products match your search."
                        : godownId
                          ? `No stock in ${godowns.find((g) => g.id === godownId)?.name ?? "this warehouse"}. Choose another warehouse or receive stock first.`
                          : "No products found."}
                    </p>
                  )}
                </div>
              </div>
            ) : selectedSku ? (() => {
              // ── Expert UX (Frog/IDEO/NNG): Display mode by default, edit on tap ──
              // No autoFocus. Qty uses +/− steppers — keyboard never opens automatically.
              // Price shows read-only; tap the pencil to edit it inline.
              // Keyboard only appears when user explicitly taps a field.
              const pl = packLabel(selectedSku);
              const uomWordHere = sellUnitLabel(lineUom, tradeCfg(selectedSku));
              const uomLabel = lineUom === "carton" ? "Carton" : lineUom === "pack" ? pl
                : uomWordHere.charAt(0).toUpperCase() + uomWordHere.slice(1);
              const qtyNum = parseFloat(lineQty) || 0;
              const hasNoPrice = !linePrice && selectedSku.landed_per_piece_mvr != null;

              // Cost + margin context
              const landed = selectedSku.landed_per_piece_mvr;
              const costForUom = landed == null ? null
                : lineUom === "piece" ? landed
                : lineUom === "pack"  ? landed * selectedSku.pcs_per_pack
                : landed * selectedSku.pcs_per_pack * selectedSku.packs_per_carton;
              const priceVal = parseFloat(linePrice);
              const margin = (costForUom != null && !isNaN(priceVal) && priceVal > 0)
                ? ((priceVal - costForUom) / priceVal) * 100 : null;

              // Price provenance — SAME classifier as the grid, so the tag the
              // salesperson saw while scanning matches what they see in the editor.
              // When the user has manually overridden the price, that's its own
              // state ("Edited") — provenance no longer describes an auto source.
              const tp = tierPrices.get(selectedSku.id);
              const editorPricePerPiece = !isNaN(priceVal) && priceVal > 0
                ? priceVal / (lineUom === "carton" ? selectedSku.pcs_per_pack * selectedSku.packs_per_carton : lineUom === "pack" ? selectedSku.pcs_per_pack : 1)
                : null;
              const editorProvenance = describePriceSource({
                source: priceManuallyEdited ? null : autoPriceSource,
                priceListName: tp?.price_list_name,
                priceListDate: tp?.price_list_date,
                pricePerPiece: editorPricePerPiece,
                landedPerPiece: selectedSku.landed_per_piece_mvr,
                targetMarginPct: selectedSku.target_margin_pct,
              });

              return (
                <div className="space-y-3">
                  {/* ── Product identity card — always visible, never obscured ── */}
                  <div className="rounded-2xl p-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                    <div className="flex items-start justify-between mb-3 gap-3">
                      <SkuIdentity
                        brandName={selectedSku.brand_name} modelName={selectedSku.model_name} variantDisplay={selectedSku.variant_display}
                        pcsPerPack={selectedSku.pcs_per_pack} packsPerCarton={selectedSku.packs_per_carton}
                        separator="·"
                        size="card"
                      />
                      <button
                        onClick={() => { setSelectedSkuId(""); setLineQty(""); setLinePrice(""); setPriceManuallyEdited(false); }}
                        className="shrink-0 ios-subhead font-semibold px-3 min-h-11 rounded-lg transition active:scale-95"
                        style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                        Change
                      </button>
                    </div>

                    {/* Stock + cost + margin in one clean row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {stockHere !== null && (
                        <span className="ios-subhead font-semibold px-2.5 py-1 rounded-full"
                          style={{ background: stockHere === 0 ? "color-mix(in srgb, var(--snm-error) 12%, transparent)" : "color-mix(in srgb, var(--snm-success) 12%, transparent)", color: stockHere === 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
                          {stockHere === 0 ? "Out of stock" : (() => {
                            const dUom = defaultUom(selectedSku);
                            if (dUom === "carton" && selectedSku.pcs_per_pack > 0 && selectedSku.packs_per_carton > 0) {
                              const ctns = Math.floor(stockHere / (selectedSku.pcs_per_pack * selectedSku.packs_per_carton));
                              return ctns > 0 ? `${ctns} ctn in stock` : "< 1 ctn";
                            }
                            return `${formatQtyInTradeUnits(stockHere, {
                              pcsPerPack: selectedSku.pcs_per_pack,
                              packsPerCarton: selectedSku.packs_per_carton,
                              unitUom: selectedSku.unit_uom,
                              sellableUnits: selectedSku.sellable_units,
                            })} in stock`;
                          })()}
                        </span>
                      )}
                      {costForUom != null && (
                        <span className="ios-subhead px-2.5 py-1 rounded-full" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)", color: "var(--muted-foreground)" }}>
                          Cost {costForUom.toFixed(lineUom === "piece" ? 4 : 2)} MVR/{uomLabel.toLowerCase()}
                        </span>
                      )}
                      {margin !== null && costForUom != null && (() => {
                        // Plain money, not accountant-speak: "Makes MVR 25/pack",
                        // never "-5.8% margin". Profit in rufiyaa is what the owner
                        // actually thinks in; percentages live in Financials.
                        const profit = priceVal - costForUom;
                        const amt = Math.abs(profit) >= 10 ? Math.abs(profit).toFixed(0) : Math.abs(profit).toFixed(2);
                        const u = uomLabel.toLowerCase();
                        return (
                          <span className="ios-subhead font-bold px-2.5 py-1 rounded-full"
                            style={{ background: profit >= 0 ? "color-mix(in srgb, var(--snm-success) 12%, transparent)" : "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: profit >= 0 ? "var(--snm-success)" : "var(--snm-error)" }}>
                            {profit >= 0 ? `Makes MVR ${amt}/${u} · ${Math.round((profit / priceVal) * 100)}%` : `Loses MVR ${amt}/${u}`}
                          </span>
                        );
                      })()}
                    </div>

                    {/* No GRN warning */}
                    {selectedSku.landed_per_piece_mvr == null && (
                      <p className="ios-subhead mt-2 font-medium" style={{ color: "var(--snm-warning)" }}>
                        ⚠ No confirmed shipment — confirm a GRN first
                      </p>
                    )}

                    {/* Below-target-margin warning — suggestion only, never blocks the sale.
                        Distinct from the red "below 0%" badge above: this fires even on a
                        still-profitable sale if it undercuts the owner's own target margin. */}
                    {margin !== null && margin >= 0 && selectedSku.target_margin_pct != null && margin < selectedSku.target_margin_pct && (
                      <p className="ios-subhead mt-2 font-medium" style={{ color: "var(--snm-warning)" }}>
                        ⚠ Less profit than you usually aim for ({selectedSku.target_margin_pct}%)
                      </p>
                    )}
                  </div>

                  {/* ── UOM segmented control — exactly the tiers this SKU sells
                      in, no more. `sellable_units` is the only input: it used
                      to also synthesise a "Piece" button for any pack-selling
                      SKU, which put "sell one loose diaper" in front of Ali on
                      every product. Nobody in this trade sells diapers loose,
                      and no SKU lists `piece`. See lib/trade-units. ── */}
                  <div className="rounded-2xl p-1 flex gap-1" style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
                    {sellableTiers(selectedSku.sellable_units).map((u) => {
                      const one = sellUnitLabel(u, tradeCfg(selectedSku));
                      const label = u === "carton" ? `Carton (${selectedSku.packs_per_carton} ${pl}s)`
                        : u === "pack" ? pl
                        : one.charAt(0).toUpperCase() + one.slice(1);
                      return (
                        <button key={u} onClick={() => setLineUom(u)}
                          // min-h-11: this pill is 36px on py-2.5, and it is
                          // the control that decides whether a line is packs or
                          // cartons — money, chosen with a thumb.
                          className="flex-1 min-h-11 rounded-xl ios-subhead font-semibold transition active:scale-95"
                          style={lineUom === u
                            ? { background: "var(--glass-accent)", color: "var(--snm-brand-on)" }
                            : { color: "var(--muted-foreground)" }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Mixed carton toggle — only visible when selling by piece ── */}
                  {lineUom === "piece" && (
                    <button
                      type="button"
                      onClick={() => setMixedCarton((v) => !v)}
                      className="w-full flex items-center justify-between px-4 h-12 rounded-xl transition active:scale-[0.99]"
                      style={{
                        background: mixedCarton
                          ? "color-mix(in srgb, var(--snm-brand) 10%, var(--glass-1))"
                          : "var(--glass-1)",
                        border: mixedCarton
                          ? "1px solid color-mix(in srgb, var(--snm-brand) 30%, transparent)"
                          : "0.5px solid var(--glass-border-lo)",
                      }}
                    >
                      <div className="text-left">
                        <p className="ios-subhead font-semibold" style={{ color: mixedCarton ? "var(--snm-brand)" : "var(--foreground)" }}>
                          Mixed carton fill
                        </p>
                        <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                          {mixedCarton
                            ? `Charging carton rate ÷ ${selectedSku.pcs_per_pack * selectedSku.packs_per_carton} ${sellUnitLabel("piece", tradeCfg(selectedSku))}s`
                            : "Customer assembles their own mixed carton"}
                        </p>
                      </div>
                      <div
                        className="w-10 h-6 rounded-full flex items-center transition-all shrink-0 ml-3"
                        style={{
                          background: mixedCarton ? "var(--snm-brand)" : "color-mix(in srgb, var(--foreground) 15%, transparent)",
                          padding: "2px",
                          justifyContent: mixedCarton ? "flex-end" : "flex-start",
                        }}
                      >
                        <div className="w-5 h-5 rounded-full" style={{ background: "var(--background)" }} />
                      </div>
                    </button>
                  )}

                  {/* ── Qty stepper + Price display — the key UX insight ──
                      Qty: large +/− stepper, no keyboard.
                      Price: shown read-only. Tap pencil → inline input appears.
                      Keyboard only fires when the user deliberately asks for it. ── */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Qty stepper */}
                    <div className="rounded-2xl p-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                      <p className="text-[12px] uppercase tracking-widest mb-3 font-semibold" style={{ color: "var(--muted-foreground)" }}>
                        QTY · {uomLabel}S
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => { const n = Math.max(0, qtyNum - 1); setLineQty(n > 0 ? String(n) : ""); }}
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition active:scale-90"
                          style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--foreground)" }}>
                          −
                        </button>
                        {/* Tapping the number opens the keyboard for direct entry */}
                        <input
                          type="number" inputMode="numeric" min="1"
                          value={lineQty}
                          onChange={(e) => setLineQty((e.target as HTMLInputElement).value)}
                          onFocus={(e) => e.target.select()}
                          placeholder="0"
                          className="flex-1 h-11 text-center text-[28px] font-bold bg-transparent text-foreground outline-none"
                          style={{ minWidth: 44 }}
                        />
                        <button
                          onClick={() => setLineQty(String(qtyNum + 1))}
                          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-bold transition active:scale-90"
                          style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                          +
                        </button>
                      </div>
                    </div>

                    {/* Price — display until tapped */}
                    <div className="rounded-2xl p-4" style={{ ...CARD, border: hasNoPrice ? "1px solid color-mix(in srgb, var(--snm-warning) 40%, transparent)" : "0.5px solid var(--glass-border-lo)" }}>
                      <p className="text-[12px] uppercase tracking-widest mb-3 font-semibold flex items-center gap-1.5" style={{ color: "var(--muted-foreground)" }}>
                        MVR / {uomLabel}
                        {priceManuallyEdited && linePrice ? (
                          <span className="ios-subhead px-1.5 py-0.5 rounded font-semibold" style={{ background: "var(--snm-brand-muted)", color: "var(--snm-brand-text)" }}>
                            Edited
                          </span>
                        ) : editorProvenance.source ? (
                          <PriceSourceTag provenance={editorProvenance} size="md" onClick={() => setShowPriceExplain(true)} />
                        ) : null}
                      </p>
                      {/* Single input — no autoFocus, displays cleanly, editable on tap */}
                      <input
                        type="number" inputMode="decimal" step="0.01" min="0"
                        value={linePrice}
                        onChange={(e) => handlePriceChange((e.target as HTMLInputElement).value)}
                        onFocus={(e) => e.target.select()}
                        onBlur={handlePriceBlur}
                        placeholder={hasNoPrice ? "Tap to set" : "0.00"}
                        className="w-full h-11 text-[28px] font-bold bg-transparent text-foreground outline-none text-center"
                        style={{ minWidth: 0 }}
                      />
                      {costForUom != null && !isNaN(priceVal) && priceVal > 0 && priceVal - costForUom >= 0 && (() => {
                        const profit = priceVal - costForUom;
                        const amt = profit >= 10 ? profit.toFixed(0) : profit.toFixed(2);
                        return (
                          <p className="w-full ios-subhead text-center mt-1 font-semibold leading-tight" style={{ color: "var(--snm-success)" }}>
                            Makes MVR {amt}/{uomLabel.toLowerCase()} · {Math.round((profit / priceVal) * 100)}%
                          </p>
                        );
                      })()}
                      {!priceManuallyEdited && editorProvenance.source && editorProvenance.detail && (
                        <button
                          type="button"
                          onClick={() => setShowPriceExplain(true)}
                          className="w-full min-h-11 flex items-center justify-center ios-subhead text-center mt-1 leading-tight underline"
                          style={{ color: "var(--muted-foreground)", textUnderlineOffset: 2 }}
                        >
                          {editorProvenance.detail}
                        </button>
                      )}
                      {priceWarning && (
                        <button
                          type="button"
                          onClick={() => setShowPriceExplain(true)}
                          className="w-full min-h-11 flex items-center justify-center ios-subhead text-center mt-1 font-semibold leading-tight underline"
                          style={{ color: priceWarning.color, textUnderlineOffset: 2 }}
                        >
                          ⚠ {priceWarning.text}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Line total — only shown once qty > 0 ── */}
                  {lineQtyPieces > 0 && (
                    <div className="flex items-center justify-between px-1">
                      <span className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                        {/* Packs and cartons, never a piece total — nobody
                            orders diapers by the piece. */}
                        = {formatQtyInTradeUnits(lineQtyPieces, {
                            pcsPerPack: selectedSku.pcs_per_pack,
                            packsPerCarton: selectedSku.packs_per_carton,
                            unitUom: selectedSku.unit_uom,
                            sellableUnits: selectedSku.sellable_units,
                          })} in total
                      </span>
                      <span className="text-[18px] font-bold text-foreground">MVR {mvrUpTo(lineTotal, 2)}</span>
                    </div>
                  )}
                  {insufficient && (
                    <p className="ios-subhead font-semibold px-1" style={{ color: "var(--snm-error)" }}>
                      ⚠ Only {formatQtyInTradeUnits(stockHere, {
                          pcsPerPack: selectedSku.pcs_per_pack,
                          packsPerCarton: selectedSku.packs_per_carton,
                          unitUom: selectedSku.unit_uom,
                          sellableUnits: selectedSku.sellable_units,
                        })} available in this warehouse
                    </p>
                  )}

                  {/* ── "Where did this price come from?" — answers exactly
                      what's driving the number on screen, plain language,
                      with a direct tap-through to go fix it. Never leaves
                      Ali staring at a number with no explanation. ── */}
                  {showPriceExplain && portalReady && createPortal(
                    // Portalled to document.body — NOT rendered inside
                    // NewSaleSheet's own `fixed inset-x-0 top-0` container.
                    // A `position: fixed` element nested inside ANOTHER fixed
                    // element is a known iOS Safari compositing trap: the
                    // inner fixed layer can fail to promote above the
                    // outer's later-painted children (here, the outer
                    // sheet's own pinned footer), so the footer visibly
                    // showed through UNDER this sheet's buttons on a real
                    // phone despite a higher z-index — z-index only
                    // resolves stacking within the SAME containing block, and
                    // nesting fixed-in-fixed silently creates a new one.
                    // Portalling to <body> guarantees this sheet is a true
                    // sibling of the page, not a descendant of any other
                    // fixed element, so it always paints on top of
                    // everything with no ambiguity.
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="How this price was worked out"
                      className="fixed inset-0 z-[80] flex items-end snm-scrim-in"
                      style={{ background: "var(--scrim-bg)", touchAction: "none" }}
                      onClick={() => { setShowPriceExplain(false); setEditingPrice(false); setSimEditingTyped(false); }}
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
                        style={{
                          background: "var(--background)",
                          borderTop: "0.5px solid var(--glass-border-lo)",
                          boxShadow: "var(--glass-shadow-lg)",
                          // Reaches the TRUE bottom of the screen — never a
                          // percentage guess. A 70dvh sheet left the real
                          // bottom 30% of the viewport exposed to the page
                          // underneath, which is exactly what showed through
                          // as "the old footer bleeding in below the sheet"
                          // on a real phone. maxHeight caps it so short
                          // content doesn't force the sheet absurdly tall.
                          maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
                        }}
                      >
                        {/* Fixed header — grabber + title stay pinned */}
                        <div className="shrink-0 px-5 pt-3">
                          <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />
                          <h2 className="text-lg font-semibold text-foreground text-center">Where this price comes from</h2>
                        </div>

                        {/* Scrollable body — the ONLY scroll region */}
                        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pt-4" style={{ touchAction: "pan-y" }}>
                          <div className="rounded-2xl p-4 space-y-2" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                            {editorProvenance.source === "sku_default" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This is the <strong>fixed selling price</strong> saved on this product — not calculated from a formula, someone typed it in directly when the product was set up.
                              </p>
                            )}
                            {editorProvenance.source === "margin" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This price is <strong>calculated automatically</strong>: landed cost{landed != null && selectedSku ? (() => {
                                  const c = costPerTradeUnit(landed, tradeCfg(selectedSku));
                                  return ` (MVR ${c.value.toFixed(2)}/${c.unitLabel === "ctn" ? "carton" : c.unitLabel})`;
                                })() : ""} plus a target margin of <strong>{selectedSku?.target_margin_pct ?? Math.round(editorProvenance.marginPct ?? 0)}%</strong>.
                              </p>
                            )}
                            {editorProvenance.source === "price_list" && (
                              <p className="ios-subhead" style={{ color: "var(--foreground)" }}>
                                This price comes from a <strong>customer price list</strong>{editorProvenance.detail ? ` — ${editorProvenance.detail}` : ""}.
                              </p>
                            )}
                            {landed != null && selectedSku && (() => {
                              // Landed cost is stored per piece because that is
                              // what the stock ledger and the GRN divide down
                              // to. It is never SHOWN per piece: quote it in
                              // the unit Ali actually buys and sells.
                              const c = costPerTradeUnit(landed, tradeCfg(selectedSku));
                              return (
                                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                                  What this product costs you landed: <strong style={{ color: "var(--foreground)" }}>MVR {c.value.toFixed(2)} / {c.unitLabel === "ctn" ? "carton" : c.unitLabel}</strong>.
                                </p>
                              );
                            })()}
                            {margin != null && (
                              <p className="ios-subhead" style={{ color: margin < 0 ? "var(--snm-error)" : "var(--foreground)" }}>
                                At the price shown, you&apos;re making <strong>{margin.toFixed(1)}% margin</strong>{margin < 0 ? " — you are losing money on this sale." : "."}
                              </p>
                            )}
                          </div>

                          {/* Inline price fix — the same Margin Simulator used
                              on the Pricing screen (slider + typed-override,
                              saved as either an auto-recalculating target
                              margin or a locked fixed price), not a bare
                              number box. Never leaves New Sale. Editing a
                              customer's price list is a bigger, separate job
                              (multiple tiers/SKUs) so that case still
                              deep-links out. */}
                          {editingPrice && (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku && landed != null && (() => {
                            const pcsPerPack = selectedSku.pcs_per_pack || 1;
                            const packsPerCarton = selectedSku.packs_per_carton || 1;
                            const landedPerPack = landed * pcsPerPack;
                            const landedPerCarton = landedPerPack * packsPerCarton;
                            const simPiecePrice  = simPackPrice / pcsPerPack;
                            const simCartonPrice = simPackPrice * packsPerCarton;
                            const simDisplayPrice = lineUom === "piece" ? simPiecePrice : lineUom === "carton" ? simCartonPrice : simPackPrice;
                            const simLandedForUom = lineUom === "piece" ? landed : lineUom === "carton" ? landedPerCarton : landedPerPack;
                            const currentMarginPct = simPackPrice > 0 ? Math.round(((simPackPrice - landedPerPack) / simPackPrice) * 100) : 0;
                            const sliderVal = Math.max(1, Math.min(99, currentMarginPct));
                            const fillPct = ((sliderVal - 1) / 98) * 100;

                            function setDisplayPrice(v: number) {
                              const asPack = lineUom === "piece" ? v * pcsPerPack : lineUom === "carton" ? v / packsPerCarton : v;
                              setSimPackPrice(asPack);
                            }

                            return (
                              <div className="rounded-2xl p-4 mt-3 space-y-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                                {/* Live price display — pencil to type an exact override */}
                                <div className="rounded-2xl px-5 pt-5 pb-4 text-center relative"
                                  style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
                                  {!simEditingTyped && (
                                    <button
                                      onClick={() => { setSimTyped(String(Math.round(simDisplayPrice))); setSimEditingTyped(true); }}
                                      className="absolute top-3 right-3 h-7 w-7 rounded-lg flex items-center justify-center transition active:scale-90"
                                      style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
                                      aria-label="Type exact price"
                                    >
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted-foreground)" }}>
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                      </svg>
                                    </button>
                                  )}
                                  {simEditingTyped ? (
                                    <input
                                      type="number" inputMode="decimal" autoFocus
                                      value={simTyped}
                                      onChange={(e) => setSimTyped(e.target.value)}
                                      onFocus={(e) => e.target.select()}
                                      onBlur={() => { const v = parseFloat(simTyped); if (!isNaN(v) && v > 0) setDisplayPrice(v); setSimEditingTyped(false); }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") { const v = parseFloat(simTyped); if (!isNaN(v) && v > 0) setDisplayPrice(v); setSimEditingTyped(false); }
                                        if (e.key === "Escape") setSimEditingTyped(false);
                                      }}
                                      className="text-[44px] font-light tracking-tight text-foreground text-center bg-transparent outline-none border-none w-full"
                                    />
                                  ) : (
                                    <p className="text-[44px] font-light tracking-tight text-foreground leading-none">{Math.round(simDisplayPrice)}</p>
                                  )}
                                  <p className="ios-subhead mt-1 font-medium" style={{ color: "var(--muted-foreground)" }}>MVR / {uomLabel.toLowerCase()}</p>
                                </div>

                                {/* Margin slider — always computed per-pack to avoid tiny-number drift */}
                                <div className="rounded-2xl px-5 py-4" style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)", border: "0.5px solid var(--glass-border-lo)" }}>
                                  <style>{`
                                    .snm-slider2 { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 9999px; outline: none; cursor: pointer; background: transparent; }
                                    .snm-slider2::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 32px; height: 32px; border-radius: 50%; background: var(--snm-brand); box-shadow: 0 2px 16px var(--snm-brand-muted); cursor: grab; border: 3px solid rgba(255,255,255,0.75); margin-top: -13px; }
                                    .snm-slider2::-moz-range-thumb { width: 32px; height: 32px; border-radius: 50%; background: var(--snm-brand); box-shadow: 0 2px 16px var(--snm-brand-muted); cursor: grab; border: 3px solid rgba(255,255,255,0.75); }
                                    .snm-slider2::-webkit-slider-runnable-track { height: 6px; border-radius: 9999px; }
                                    .snm-slider2::-moz-range-track { height: 6px; border-radius: 9999px; background: rgba(128,128,128,0.2); }
                                  `}</style>
                                  <div className="flex items-center justify-between mb-4">
                                    <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Margin</p>
                                    <div className="flex items-baseline gap-0.5">
                                      <p className="text-[28px] font-bold leading-none" style={{ color: "var(--snm-brand-text)" }}>{sliderVal}</p>
                                      <p className="text-[16px] font-semibold leading-none" style={{ color: "var(--muted-foreground)" }}>%</p>
                                    </div>
                                  </div>
                                  <div className="relative">
                                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full overflow-hidden pointer-events-none"
                                      style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)" }}>
                                      <div className="h-full rounded-full" style={{ width: `${fillPct}%`, background: "var(--snm-brand)" }} />
                                    </div>
                                    <input
                                      type="range" min={1} max={99} step={1} value={sliderVal}
                                      onChange={(e) => {
                                        const pct = parseInt(e.target.value);
                                        const p = priceForMargin(landedPerPack, pct);
                                        if (p != null) setSimPackPrice(Math.round(p));
                                      }}
                                      className="snm-slider2 relative"
                                      style={{ touchAction: "none" }}
                                    />
                                  </div>
                                  <div className="flex justify-between mt-1">
                                    <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>1%</p>
                                    <p className="ios-subhead font-medium" style={{ color: "var(--muted-foreground)" }}>99%</p>
                                  </div>
                                </div>

                                <p className="ios-subhead text-center" style={{ color: simDisplayPrice <= simLandedForUom ? "var(--snm-error)" : "var(--muted-foreground)" }}>
                                  Costs you {simLandedForUom.toFixed(2)} — {simDisplayPrice <= simLandedForUom ? "still below cost" : "you're above cost"}
                                </p>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Fixed footer — always visible, never scrolled past */}
                        <div className="shrink-0 flex flex-col gap-2 px-5 pt-3" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingBottom: "max(1rem, env(safe-area-inset-bottom), var(--kb-inset))" }}>
                          {editingPrice && (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku && landed != null ? (() => {
                            const pcsPerPack = selectedSku.pcs_per_pack || 1;
                            const packsPerCarton = selectedSku.packs_per_carton || 1;
                            const landedPerPack = landed * pcsPerPack;
                            const piecePrice = simPackPrice / pcsPerPack;
                            const impliedMarginPct = landedPerPack > 0 && simPackPrice > landedPerPack
                              ? Math.round(((simPackPrice - landedPerPack) / simPackPrice) * 1000) / 10
                              : 0;
                            const displayNewPrice = lineUom === "piece" ? piecePrice : lineUom === "carton" ? simPackPrice * packsPerCarton : simPackPrice;
                            const canSave = simPackPrice > landedPerPack;

                            async function save(mode: "margin" | "fixed") {
                              if (!selectedSku || !canSave) return;
                              setSavingFixedPrice(mode);
                              try {
                                // v_skus resolves price per tier independently — a
                                // leftover fixed_price_per_pack/carton_mvr from an
                                // old volume-break override beats BOTH
                                // fixed_selling_price_mvr and target_margin_pct at
                                // that tier, silently reviving the stale price the
                                // next time this SKU loads. Whichever mode is
                                // chosen here must win at every tier, so always
                                // clear all three fixed-price columns first.
                                const cleared = { fixed_selling_price_mvr: null, fixed_price_per_pack_mvr: null, fixed_price_per_carton_mvr: null, target_margin_pct: null };
                                if (mode === "fixed") {
                                  await updateSku(selectedSku.id, { ...cleared, fixed_selling_price_mvr: piecePrice });
                                  setPriceOverrides((prev) => ({ ...prev, [selectedSku.id]: { ...prev[selectedSku.id], ...cleared, fixed_selling_price_mvr: piecePrice } }));
                                } else {
                                  await updateSku(selectedSku.id, { ...cleared, target_margin_pct: impliedMarginPct });
                                  setPriceOverrides((prev) => ({ ...prev, [selectedSku.id]: { ...prev[selectedSku.id], ...cleared, target_margin_pct: impliedMarginPct } }));
                                }
                                setLinePrice(String(Math.round(displayNewPrice)));
                                setPriceManuallyEdited(false);
                                setAutoPriceSource(mode === "fixed" ? "sku_default" : "margin");
                                // Stored per piece (that is the column), but
                                // confirmed back in the unit it will be sold in.
                                const shown = costPerTradeUnit(piecePrice, tradeCfg(selectedSku));
                                toast.success(mode === "fixed"
                                  ? `Fixed price saved — MVR ${shown.value.toFixed(2)}/${shown.unitLabel === "ctn" ? "carton" : shown.unitLabel}`
                                  : `${impliedMarginPct}% margin saved`);
                                setEditingPrice(false);
                                setShowPriceExplain(false);
                              } catch (e) {
                                toast.error((e as Error).message);
                              } finally {
                                setSavingFixedPrice(null);
                              }
                            }

                            return (
                              <>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setEditingPrice(false)}
                                    className="flex-1 h-12 rounded-xl font-semibold"
                                    style={{ background: "var(--secondary)", color: "var(--foreground)" }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    disabled={!!savingFixedPrice || !canSave}
                                    onClick={() => save("margin")}
                                    className="flex-[2] h-12 rounded-xl font-semibold transition disabled:opacity-40 flex items-center justify-center gap-2"
                                    style={{ background: "var(--snm-brand)", color: "var(--snm-brand-on)" }}
                                  >
                                    {savingFixedPrice === "margin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><TrendingUp className="h-4 w-4" /> Save at {impliedMarginPct}% margin</>}
                                  </button>
                                </div>
                                <button
                                  disabled={!!savingFixedPrice || !canSave}
                                  onClick={() => save("fixed")}
                                  className="h-11 w-full rounded-xl ios-subhead font-semibold transition disabled:opacity-40 flex items-center justify-center gap-1.5"
                                  style={{ background: "var(--secondary)", color: "var(--foreground)" }}
                                >
                                  {savingFixedPrice === "fixed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Or lock as fixed price · MVR ${Math.round(displayNewPrice)}`}
                                </button>
                              </>
                            );
                          })() : (editorProvenance.source === "sku_default" || editorProvenance.source === "margin") && selectedSku ? (
                            <button
                              onClick={() => {
                                // Seed the simulator from the current price so
                                // the slider/thumb starts exactly where the
                                // shown price already is, not from zero.
                                const pcsPerPack = selectedSku.pcs_per_pack || 1;
                                const cur = parseFloat(linePrice) || 0;
                                const asPack = lineUom === "piece" ? cur * pcsPerPack : lineUom === "carton" ? cur / (selectedSku.packs_per_carton || 1) : cur;
                                setSimPackPrice(asPack > 0 ? asPack : (selectedSku.landed_per_piece_mvr ?? 0) * pcsPerPack * 1.3);
                                setEditingPrice(true);
                              }}
                              className="h-12 w-full rounded-xl font-semibold"
                              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}
                            >
                              Fix this product&apos;s price
                            </button>
                          ) : null}
                          {editorProvenance.source === "price_list" && (
                            <button
                              onClick={() => { window.location.href = "/pricelists"; }}
                              className="h-12 w-full rounded-xl font-semibold"
                              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}
                            >
                              Manage price lists →
                            </button>
                          )}
                          {!editingPrice && (
                            <button onClick={() => setShowPriceExplain(false)} className="h-12 w-full rounded-xl font-semibold" style={{ background: "var(--secondary)", color: "var(--foreground)" }}>
                              Close
                            </button>
                          )}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
              );
            })() : null}

            {/* Draft lines — the same cart as step 3, same component. It is a
                list and a total; the way to add another product is the footer
                button, which is on screen no matter how far this has scrolled.
                Hidden at lg, where the rail on the right already shows it. */}
            <div className="lg:hidden">
              <CartLines
                lines={draftLines}
                grandTotal={grandTotal}
                editable
                onChangeQty={changeLineQty}
                onRemove={removeLine}
                maxPiecesFor={maxPiecesFor}
              />
            </div>

            {/* ONE suggestion, in the scrolling body — never in the pinned
                footer, which must keep holding the action (reach.mjs enforces
                that). 55 customers buy nappies, 19 buy detergent and NOT ONE
                buys both, so the cheapest sale available is a bottle added to a
                box already going out.

                Everything about which product is decided in Postgres: a
                category they have never bought, in stock in THIS warehouse,
                not a discontinued range, and sold above cost. If none of that
                holds, nothing renders — a suggestion the app cannot stand
                behind is worse than silence at the till. */}
            {crossSell && !crossSellOff && (
              <div className="rounded-2xl p-4" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                      Going out anyway
                    </p>
                    <p className="ios-subhead font-semibold mt-0.5 truncate" style={{ color: "var(--foreground)" }}>
                      {crossSell.label}
                    </p>
                    {/* --foreground, not muted: this is the reason to tap. */}
                    <p className="ios-footnote mt-0.5" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                      MVR {mvrUpTo(crossSell.price_mvr, 3)} a {crossSell.sell_unit}
                      {crossSell.buyers > 0 ? ` · ${crossSell.buyers} other customers buy it` : ""}
                      {` · ${crossSell.packs_on_hand} packs here`}
                    </p>
                  </div>
                  <button
                    onClick={() => setCrossSellOff(true)}
                    aria-label="Not this time"
                    className="shrink-0 h-11 w-11 rounded-full flex items-center justify-center snm-pressable"
                    style={{ background: "var(--glass-bg-1)", color: "var(--muted-foreground)" }}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <button
                  onClick={() => {
                    const s2 = skus.find((x) => x.id === crossSell.sku_id);
                    if (!s2) return;
                    // The same add path as every other product — never a second
                    // way into the cart, so the one-line-per-product rule and
                    // the below-cost guard both still apply.
                    pushQuickLine(s2, defaultUom(s2), crossSell.price_mvr);
                    setCrossSell(null);
                  }}
                  className="mt-3 w-full h-11 rounded-xl ios-subhead font-semibold snm-pressable"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}>
                  Add to this order
                </button>
              </div>
            )}

            </>
            )}
          </div>
        )}

        {/* ── Step 3: Confirm + Payment ── */}
        {step === 3 && (
          <div className="space-y-4">

            {/* Order total hero */}
            <div className="rounded-2xl p-5" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
              <p className="text-[12px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Order Total</p>
              <p className="text-[36px] font-bold tracking-tight text-foreground leading-none mb-1 tabular-nums">
                {mvr(grandTotal)}
                <span className="text-[16px] ml-1.5" style={{ color: "var(--muted-foreground)" }}>MVR</span>
              </p>
              <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
                {draftLines.length} item{draftLines.length !== 1 ? "s" : ""} · {customerId === "walkin" ? "Walk-in" : (customer?.name ?? "—")} · via {CHANNELS.find((c) => c.value === channel)?.label}
              </p>
            </div>

            {/* Line items — the SAME cart component as step 2, with the
                quantity steppers, the bin and a way back for more. It used to
                be a read-only list: nothing could be changed on the last
                screen before the order was placed. Hidden at lg — the rail. */}
            <div className="lg:hidden">
              <CartLines
                lines={draftLines}
                grandTotal={grandTotal}
                editable
                onChangeQty={changeLineQty}
                onRemove={removeLine}
                maxPiecesFor={maxPiecesFor}
              />
            </div>

            {/* ── Ship from ──
                The warehouse decides which stock gets deducted, and it was
                chosen back on step 2 and never shown again — so a wrong pick
                sailed through to Place Order unseen, and only surfaced at a
                stock count. Restating a consequential choice on the review
                step is the cheapest catch there is: no extra taps if it's
                right, one tap to fix if it isn't. */}
            <div className="space-y-2">
              <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Ship from</p>
              <WarehouseSelect value={godownId} onChange={setGodownId} godowns={godowns} />

              {godownCheck && (
                <div className="rounded-xl p-3.5"
                  style={{
                    background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--snm-warning) 30%, transparent)",
                  }}>
                  <p className="ios-subhead font-semibold" style={{ color: "var(--snm-warning)" }}>
                    {godownCheck.shortCount === 1 ? "1 item isn't" : `${godownCheck.shortCount} items aren't`} in{" "}
                    {godowns.find((g) => g.id === godownId)?.name ?? "this warehouse"}
                  </p>
                  <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>
                    {godownCheck.names.slice(0, 3).join(", ")}
                    {godownCheck.names.length > 3 ? ` +${godownCheck.names.length - 3} more` : ""}
                  </p>
                  {godownCheck.better && (
                    <button
                      onClick={() => setGodownId(godownCheck.better!.id)}
                      className="mt-2.5 h-11 px-4 rounded-xl ios-subhead font-semibold w-full active:scale-[0.99]"
                      style={{ background: "var(--foreground)", color: "var(--background)" }}
                    >
                      Ship from {godownCheck.better.name} instead
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Payment method */}
            <div className="space-y-2">
              <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>How will the customer pay?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod("bank_transfer")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "bank_transfer" ? "2px solid var(--foreground)" : "0.5px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Smartphone className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="ios-subhead font-semibold text-foreground">Bank Transfer</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>They send payment slip via WhatsApp / Viber</p>
                </button>
                <button
                  onClick={() => setPaymentMethod("cod")}
                  className="rounded-xl p-4 text-left transition active:scale-95 space-y-2"
                  style={{ ...CARD, border: paymentMethod === "cod" ? "2px solid var(--foreground)" : "0.5px solid var(--glass-border-lo)" }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--glass-bg-2)" }}>
                    <Banknote className="h-4 w-4 text-foreground" />
                  </div>
                  <p className="ios-subhead font-semibold text-foreground">Cash on Delivery</p>
                  <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>Driver collects cash, hands it to you</p>
                </button>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <p className="text-[12px] uppercase tracking-widest font-medium" style={{ color: "var(--muted-foreground)" }}>Delivery notes (optional)</p>
              <textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="e.g. Leave at the gate, call before arriving…"
                rows={2}
                className="w-full px-4 py-3 rounded-xl ios-subhead text-foreground outline-none resize-none"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }} />
            </div>

            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              Placing this order will immediately deduct stock from the warehouse.
            </p>
          </div>
        )}
        </div>

        {/* ── Desktop order rail (lg and up) ──────────────────────────────────
            The order, visible during all three steps. On a phone the cart is
            something you scroll to; on a wide screen there is room to simply
            keep it on screen, which is what every desktop checkout does and
            what makes the "Add product" footer button unnecessary here.

            It uses the SAME CartLines component and the SAME handlers as the
            phone, so the steppers, the bin, the stock cap and the whole-carton
            arithmetic behave identically. Nothing about money is re-implemented
            for a wide screen. There is also no action button in this rail: the
            single primary action stays in the footer, so there is exactly one
            door through the below-cost and shortfall guards. */}
        <aside aria-label="Order summary"
          className="hidden lg:block lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-8 space-y-3"
          style={{ overscrollBehavior: "contain" }}>
          <div className="rounded-2xl p-4 space-y-1"
            style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)" }}>
            <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>This order</p>
            <p className="ios-subhead font-semibold text-foreground truncate">
              {customerId === "walkin" ? "Walk-in customer" : (customer?.name ?? "No customer yet")}
            </p>
            <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
              {[
                customerId && customerId !== "walkin" ? `${orderTier} price` : null,
                godowns.find((g) => g.id === godownId)?.name ?? "No warehouse yet",
                CHANNELS.find((c) => c.value === channel)?.label,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>

          {draftLines.length === 0 ? (
            <div className="rounded-2xl p-5 text-center"
              style={{ background: "var(--glass-bg-1)", border: "0.5px dashed var(--glass-border-lo)" }}>
              <ShoppingCart className="h-5 w-5 mx-auto mb-2" style={{ color: "var(--foreground)", opacity: 0.5 }} />
              <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                Nothing added yet. Pick a product on the left and it appears here.
              </p>
            </div>
          ) : (
            <CartLines
              lines={draftLines}
              grandTotal={grandTotal}
              editable
              onChangeQty={changeLineQty}
              onRemove={removeLine}
              maxPiecesFor={maxPiecesFor}
            />
          )}

          {mixConflicts.length > 0 && (
            <p className="ios-footnote mb-2 text-center" style={{ color: "var(--snm-warning)" }}>
              {mixConflicts[0].label} is in a mixed carton AND as loose {mixConflicts[0].noun}s —
              one order can only hold it one way. Remove one of them.
            </p>
          )}
          {shortfalls.length > 0 && (
            <p className="ios-footnote font-semibold px-1" style={{ color: "var(--snm-error)" }}>
              {shortfalls[0].short} more {shortfalls[0].noun} needed to fill the carton
            </p>
          )}
        </aside>
      </div>
      </div>

      {/* Fixed bottom actions */}
      {/* Action bar. On a phone the buttons split the full width — a thumb
          needs the target. On desktop that same rule produced a 1110px-wide
          "Review & Confirm", which is a phone button stretched, not a desktop
          one: at lg they take their natural width and sit to the right, where
          a primary action belongs in a window. */}
      <footer className="glass-panel--strong shrink-0 px-5 lg:px-8 gap-3 flex items-center lg:justify-end relative z-[1]" style={{ paddingTop: "12px", paddingBottom: "max(calc(12px + env(safe-area-inset-bottom, 0px)), var(--kb-inset))", minHeight: 72, borderRadius: 0, borderLeft: "none", borderRight: "none", borderBottom: "none", borderTop: "0.5px solid var(--glass-border-lo)" }}>
        {step === 1 && (
          <>
            <button onClick={onClose} className="flex-1 lg:flex-none lg:px-10 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>Cancel</button>
            <button disabled={!customerId} onClick={async () => {
                try {
                  const skuIds = skus.map((s) => s.id);
                  const map = await getTierPricesForSkus(skuIds, orderTier);
                  setTierPrices(map);
                } catch {
                  // Non-fatal: fall back to SKU defaults
                  setTierPrices(new Map());
                }
                setStep(2);
              }}
              className="flex-[2] lg:flex-none lg:px-14 h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
              Add Products <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
        {step === 2 && (
          selectedSkuId ? (
            // A product is actively being configured — this docked bar IS
            // the primary action (was a second, in-flow button before,
            // which left a dead gap between it and this same bar). One
            // action, always in the same place, native-form style.
            <>
              <button onClick={() => setSelectedSkuId("")} className="flex-1 lg:flex-none lg:px-10 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
              <button onClick={handleAddLine} disabled={!lineQty || !linePrice || lineQtyPieces <= 0 || insufficient}
                className="flex-[2] lg:flex-none lg:px-14 h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                <Plus className="h-4 w-4" /> Add to Order
              </button>
            </>
          ) : (
            <>
              {/* Ali, 2026-08-09: "What's this big + sign? The actual '+add
                  more' is scrolling."
                  Two mistakes, one fix. The pill lived in the cart, and the
                  cart scrolls, so it left the screen — and the answer I reached
                  for was a SECOND control in the footer rather than moving the
                  first, which left a bare "+" whose meaning nobody can guess.
                  Now there is exactly one, it says what it does, and it is in
                  the footer, which never moves.

                  "← Back" goes icon-only once the cart has something in it, so
                  three controls still fit a 390pt phone without the primary
                  action wrapping. A left chevron is a universal affordance in
                  a way a bare plus is not.

                  Only TWO buttons here. A third made both of these wrap onto
                  two lines at 393pt — "Back" now lives in the step indicator
                  at the top, which is always on screen. */}
              <button
                onClick={() => draftLines.length > 0
                  ? productSearchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                  : setStep(1)}
                className="snm-pressable h-14 flex-1 rounded-xl px-3 flex items-center justify-center gap-1.5 ios-subhead font-semibold whitespace-nowrap lg:hidden"
                style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: draftLines.length > 0 ? "var(--snm-brand-text)" : "var(--foreground)" }}>
                {draftLines.length > 0
                  ? <><Plus className="h-4 w-4 shrink-0" /> Add product</>
                  : <><ArrowLeft className="h-4 w-4 shrink-0" /> Back</>}
              </button>
              <button disabled={draftLines.length === 0 || shortfalls.length > 0 || mixConflicts.length > 0} onClick={() => setStep(3)}
                className="flex-[2] lg:flex-none lg:px-14 h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2 whitespace-nowrap"
                style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
                {draftLines.length === 0 ? "Add at least 1 item"
                  : mixConflicts.length > 0 ? "Remove the mix or the singles"
                  : shortfalls.length > 0 ? `Add ${shortfalls[0].short} more ${shortfalls[0].noun}`
                  : <>Review & Confirm <ArrowRight className="h-4 w-4" /></>}
              </button>
            </>
          )
        )}
        {step === 3 && (
          <>
            <button onClick={() => setStep(2)} className="flex-1 lg:flex-none lg:px-10 h-14 rounded-xl ios-subhead font-semibold" style={{ ...CARD, border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}>← Back</button>
            {/* A part-carton is refused by the database (0163). Catching it
                here means the reason is on screen next to the fix, instead of
                arriving as an error after the last tap. */}
            <button disabled={saving || shortfalls.length > 0} onClick={handleSubmit}
              className="flex-[2] lg:flex-none lg:px-14 h-14 rounded-xl ios-subhead font-bold transition disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: "var(--glass-accent)", color: "var(--snm-brand-on)" }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" />
                : shortfalls.length > 0
                  ? `Add ${shortfalls[0].short} more ${shortfalls[0].noun}`
                  : <>Place Order <ArrowRight className="h-4 w-4" /></>}
            </button>
          </>
        )}
      </footer>

      {showScanner && (
        <BarcodeScanner
          hint="Scan product barcode"
          onResult={handleScanResult}
          onClose={() => setShowScanner(false)}
        />
      )}

      {stockInSku && (
        <StockInSheet
          sku={stockInSku}
          godownId={godownId}
          godownName={godowns.find((g) => g.id === godownId)?.name ?? "this warehouse"}
          onClose={() => setStockInSku(null)}
          onReceived={async () => { await onStockChanged?.(); }}
        />
      )}

      {belowCostAdd && portalReady && createPortal(
        (() => {
          const s = belowCostAdd.sku;
          const mult = belowCostAdd.uom === "carton" ? s.pcs_per_pack * s.packs_per_carton
                     : belowCostAdd.uom === "pack" ? s.pcs_per_pack : 1;
          const cost = (s.landed_per_piece_mvr ?? 0) * mult;
          const loss = cost - belowCostAdd.price;
          const u = sellUnitLabel(belowCostAdd.uom, tradeCfg(s));
          return (
            <ConfirmSheet
              open
              title="This sells below cost"
              message={`${s.brand_name} ${s.variant_display} costs you MVR ${cost.toFixed(0)}/${u} right now — at MVR ${belowCostAdd.price.toFixed(0)} you lose about MVR ${loss.toFixed(loss >= 10 ? 0 : 2)} per ${u}. Cancel and tap the product card to adjust the price, or add it anyway.`}
              confirmLabel="Add at a loss"
              onConfirm={() => {
                pushQuickLine(s, belowCostAdd.uom, belowCostAdd.price);
                setBelowCostAdd(null);
              }}
              onClose={() => setBelowCostAdd(null)}
            />
          );
        })(),
        document.body,
      )}

      {editorBelowCostConfirm && selectedSku && portalReady && createPortal(
        (() => {
          const s = selectedSku;
          const mult = lineUom === "carton" ? s.pcs_per_pack * s.packs_per_carton
                     : lineUom === "pack" ? s.pcs_per_pack : 1;
          const cost = (s.landed_per_piece_mvr ?? 0) * mult;
          const price = parseFloat(linePrice) || 0;
          const qty = parseFloat(lineQty) || 0;
          const lossEach = cost - price;
          const lossTotal = lossEach * qty;
          const u = sellUnitLabel(lineUom, tradeCfg(s));
          return (
            <ConfirmSheet
              open
              title="This sells below cost"
              message={`${s.brand_name} ${s.variant_display} costs you MVR ${cost.toFixed(0)}/${u} right now — at MVR ${price.toFixed(0)} you lose about MVR ${lossEach.toFixed(lossEach >= 10 ? 0 : 2)} per ${u}${qty > 1 ? ` (MVR ${lossTotal.toFixed(0)} on this line)` : ""}. Go back to adjust the price, or add it anyway.`}
              confirmLabel="Add at a loss"
              onConfirm={() => { setEditorBelowCostConfirm(false); doAddLine(); }}
              onClose={() => setEditorBelowCostConfirm(false)}
            />
          );
        })(),
        document.body,
      )}

      {mixedCartonBrandId && portalReady && createPortal(
        // Portalled to document.body for the same reason as the price-explain
        // sheet above — this is a `position: fixed` layer that must never be a
        // descendant of NewSaleSheet's own `fixed inset-x-0 top-0` container.
        <MixedCartonSheet
          skus={mixedCartonGroups.get(mixedCartonBrandId) ?? []}
          godownId={godownId}
          godowns={godowns}
          stockLevels={stockLevels}
          tierPrices={tierPrices}
          draftLines={draftLines}
          onClose={() => setMixedCartonBrandId(null)}
          onAdd={(adds) => {
            // ADD to whatever the colour already has — never replace it.
            // Replacing is what silently deleted bottles and left the cart
            // holding 1.67 cartons: build 2 Purple + 4 Red, then 6 Purple, and
            // Purple's 2 was overwritten by 6 instead of becoming 8.
            //
            // One line per product per order is a database rule
            // (sales_order_lines_order_sku_uniq), so the merge is mandatory,
            // not a convenience.
            setDraftLines((prev) => {
              const next = [...prev];
              for (const a of adds) {
                // Carton size for a LINE is the SKU's own pack config, because
                // that is what Postgres uses to derive qty_pieces from a
                // carton qty. mixed_carton_pieces is the brand-level "a carton
                // is this many individually-chosen bottles" figure and drives
                // the mix target and the per-bottle rate.
                const perLine = a.sku.pcs_per_pack * a.sku.packs_per_carton || 1;
                const perMix = a.sku.mixed_carton_pieces || perLine;
                const tp = tierPrices.get(a.sku.id);
                const cartonPrice = (tp ? tp.price_per_carton_mvr : a.sku.selling_price_per_carton_mvr) ?? 0;

                // A full carton of one colour and bottles inside a mixed
                // carton are DIFFERENT purchases and stay apart in the cart.
                // Ali, 2026-08-09: "You cannot say for example 7 bottles blue
                // because I chose a mix carton with 1 bottle blue and the
                // other 6 bottles merged with this."
                //
                // They are merged only at SAVE, because sales_order_lines
                // allows one row per product per order. The money and the
                // stored order are identical either way — both sides are
                // priced off the same carton rate — so this is presentation,
                // not a change to anything that counts.
                // THREE KINDS, THREE CART LINES. They stay apart for the same
                // reason a full carton and a mixed fill always have — Ali,
                // 2026-08-09: "You cannot say for example 7 bottles blue
                // because I chose a mix carton with 1 bottle blue and the other
                // 6 bottles merged with this." A loose single is a third such
                // purchase, at its own price.
                const key = `${a.sku.id}-${a.kind}`;
                const i = next.findIndex((l) => l.key === key);
                const pieces = (i === -1 ? 0 : next[i].qty_pieces) + a.pieces;
                // A LOOSE SINGLE IS NEVER COERCED INTO A MIX. The old rule was
                // `mixed = a.mixed || pieces % perLine !== 0`, which turned any
                // non-whole-carton quantity into a mixed-carton fill — and that
                // is precisely why loose bottles could not exist.
                const mixed = a.kind === "mix" || (a.kind === "carton" && pieces % perLine !== 0);

                // Keep whichever godown is already on the line; a merge never
                // silently moves stock to a different warehouse.
                const gId = (i === -1 ? undefined : next[i].source_godown_id) ?? a.godownId;
                const gName = (i === -1 ? undefined : next[i].source_godown_name) ?? a.godownName;
                // A loose single is billed at the BOTTLE price, which is not
                // the carton rate divided by six — that is the whole reason it
                // is a separate tier and a separate price.
                const bottlePrice = (tp?.price_per_pack_mvr ?? a.sku.selling_price_per_pack_mvr) ?? 0;
                const perPack = a.sku.pcs_per_pack || 1;

                const line: DraftLine = a.kind === "single"
                  ? {
                      key, sku: a.sku, uom: "pack", qty: pieces / perPack, qty_pieces: pieces,
                      unit_price_mvr: bottlePrice,
                      line_total_mvr: bottlePrice * (pieces / perPack),
                      is_mixed_carton_fill: false,
                      source_godown_id: gId, source_godown_name: gName,
                    }
                  : mixed
                  ? {
                      key, sku: a.sku, uom: "piece", qty: pieces, qty_pieces: pieces,
                      unit_price_mvr: cartonPrice / perMix,
                      line_total_mvr: (cartonPrice / perMix) * pieces,
                      is_mixed_carton_fill: true,
                      source_godown_id: gId, source_godown_name: gName,
                    }
                  : {
                      key, sku: a.sku, uom: "carton", qty: pieces / perLine, qty_pieces: pieces,
                      unit_price_mvr: cartonPrice,
                      line_total_mvr: cartonPrice * (pieces / perLine),
                      is_mixed_carton_fill: false,
                      source_godown_id: gId, source_godown_name: gName,
                    };
                if (i === -1) next.push(line); else next[i] = line;
              }
              return next;
            });
            // Ali, 2026-08-09: "It's not showing me whether adding or not.
            // There is no way for me to know." The sheet closes on add, so
            // without this nothing at all confirms it landed.
            const per = adds[0].sku.mixed_carton_pieces || 1;
            const pieces = adds.reduce((a, x) => a + x.pieces, 0);
            const ctns = Math.round(pieces / per);
            const noun = containerLabel(adds[0].sku.unit_uom as UnitUom | null | undefined);
            toast.success(
              adds[0].kind === "single"
                // Loose singles are counted in what they ARE, not converted to
                // a fraction of a carton nobody bought.
                ? `Added ${pieces} ${noun}${pieces === 1 ? "" : "s"} of ${adds[0].sku.brand_name}`
                : `Added ${ctns} ${adds[0].kind === "mix" ? "mixed " : ""}carton${ctns === 1 ? "" : "s"} of ${adds[0].sku.brand_name}`,
            );
            setMixedCartonBrandId(null);
          }}
        />,
        document.body,
      )}
      </div>
    </div>,
    document.body,
  );
}

// ── Sosoft carton picker (single colour or mixed) ────────────────────────────
// Ali, 2026-08-07: "Sosoft I sell in cartons. Not bottles. But customer can
// make mixed carton of six bottles not less. Customer can also purchase single
// color carton." And 2026-08-09: "must be able to sell mixed color cartons and
// single color cartons too if the customer choice. And customer must be able to
// purchase any quantity of cartons as long as it's in stock."
//
// So there are two first-class ways to buy, and any number of cartons of each:
//
//   SINGLE COLOUR  n whole cartons of one colour -> an ordinary CARTON line
//                  (uom 'carton'), because that is exactly what it is. FIFO,
//                  costing, the money-in-the-unit-sold rule and the whole-unit
//                  edit guard (0156) then all apply unchanged.
//   MIXED          n cartons' worth of bottles picked across colours ->
//                  is_mixed_carton_fill piece lines at carton-rate ÷ 6. This is
//                  the sanctioned piece carve-out in CLAUDE.md: a mixed carton
//                  is the one place a bottle is a real ledger unit.
//
// WHAT WAS WRONG BEFORE
//
//  * The sheet could only ever build ONE carton. Every colour was capped at 6
//    bottles and the Add button required the total to equal exactly 6. There
//    was no quantity control at all.
//  * Single colour had no door. Every Sosoft SKU is pulled out of the product
//    grid into one card, so the mixer was the only way in. Six of one colour
//    did work, but nothing said so and it was still capped at one carton.
//  * Adding REPLACED any existing line for the same colour instead of adding to
//    it. Building 2 Purple + 4 Red, then 6 Purple, left 6 Purple + 4 Red = 10
//    bottles: four bottles the salesperson had entered vanished from the order,
//    and the cart held one and two-thirds of a carton. That is the
//    "1.6666666666666667 cartons in cart" Ali screenshotted.
//
// One line per product per order is a database rule
// (sales_order_lines_order_sku_uniq), so a colour bought BOTH as a whole carton
// and inside a mix merges into one line, expressed in bottles — the only unit
// that can describe a non-carton multiple. The money is identical either way,
// because both sides are priced off the same carton rate.
//
