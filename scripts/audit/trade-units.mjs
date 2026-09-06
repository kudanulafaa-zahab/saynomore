// Every product SHAPE, through every unit function, in one second.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
//
// Every unit complaint Ali has raised is the same defect wearing a different
// product: a number correct in value, printed under a word the product does
// not use. "MVR 380 per ctn" for a tub. "1/pack × 1/ctn" for a tub. "24 ctn"
// for 24 tubs, on three separate screens. "12 piece" for six bottles.
//
// The browser audits cannot catch these, and it is worth being precise about
// why rather than adding more of them: they drive the FIXTURE, and the fixture
// contains the shapes someone thought to seed. On 2026-09-06 I ran the real
// catalogue's shapes through the shared functions by hand and two defects fell
// out immediately that 54 CI checks had passed over:
//
//   * a diaper shipped singly (34 to a pack, 1 pack to a carton) reported
//     "3 ctn" for 102 pieces. Right count, and it has no carton — pcsPerCarton
//     collapses to pcsPerPack when packs_per_carton is 1, so the carton branch
//     silently claims a tier that does not exist. Ali's screenshot, one shape
//     over from the one he photographed.
//   * every gram-measured product pluralised to "pouchs". That is body
//     butter's own noun.
//
// So this is a SHAPE audit, not a screen audit. It asserts the RULES the unit
// vocabulary must obey, against the shapes the catalogue can actually hold —
// including the ones no fixture has yet.
//
// Usage:  node --experimental-strip-types scripts/audit/trade-units.mjs

import {
  containerLabel, formatQtyInTradeUnits, formatStockQty, packConfigSentence,
  packConfigText, plural, pluralNoun, shipUnitLabel, unitAbbr,
} from "../../lib/trade-units.ts";
import { checklist, finish } from "./lib.mjs";

/** Every shape the catalogue can hold, named as Ali would name it. */
const SHAPES = [
  { name: "MamyPoko X-Tra Kering XXXL", pcsPerPack: 34, packsPerCarton: 3,  unitUom: "pcs", sellableUnits: ["pack", "carton"], hasCarton: true,  noun: "pack" },
  { name: "a diaper shipped singly",    pcsPerPack: 34, packsPerCarton: 1,  unitUom: "pcs", sellableUnits: ["pack"],           hasCarton: false, noun: "pack" },
  { name: "Sosoft 500ml, carton-only",  pcsPerPack: 1,  packsPerCarton: 6,  unitUom: "ml",  sellableUnits: ["carton"],         hasCarton: true,  noun: "bottle" },
  { name: "a Body Shop tub",            pcsPerPack: 1,  packsPerCarton: 1,  unitUom: "tub", sellableUnits: ["pack"],           hasCarton: false, noun: "tub" },
  { name: "a bedding set",              pcsPerPack: 1,  packsPerCarton: 1,  unitUom: "set", sellableUnits: ["pack"],           hasCarton: false, noun: "set" },
  { name: "a gram-measured pouch",      pcsPerPack: 1,  packsPerCarton: 12, unitUom: "g",   sellableUnits: ["pack", "carton"], hasCarton: true,  noun: "pouch" },
  { name: "a sachet by the carton",     pcsPerPack: 20, packsPerCarton: 8,  unitUom: "sachet", sellableUnits: ["pack", "carton"], hasCarton: true, noun: "sachet" },
];

const QTYS = [0, 1, 3, 24, 102, 250, 1000];
const list = checklist(`Unit vocabulary — ${SHAPES.length} product shapes`);

for (const s of SHAPES) {
  const cfg = {
    pcsPerPack: s.pcsPerPack, packsPerCarton: s.packsPerCarton,
    unitUom: s.unitUom, sellableUnits: s.sellableUnits,
  };
  const all = QTYS.flatMap((q) => [formatStockQty(q, cfg), formatQtyInTradeUnits(q, cfg)]);
  const every = [
    ...all,
    packConfigText(cfg) ?? "", packConfigSentence(cfg) ?? "",
    shipUnitLabel(cfg), unitAbbr(s.unitUom),
  ].join(" | ");

  // RULE 1. A product with one pack to a carton HAS NO CARTON, and nothing may
  // say it does. This is Ali's screenshot, generalised past the tub.
  if (!s.hasCarton) {
    list.ok(!/\bctn\b|\bcarton\b/i.test(every),
      `${s.name}: never says carton — it has none (${every.slice(0, 110)})`);
  }

  // RULE 2. The noun is the PRODUCT'S. A tub is never a pack; a bottle is
  // never a pack. The word comes from unit_uom, via containerLabel.
  const noun = containerLabel(s.unitUom);
  list.is(noun, s.noun, `${s.name}: its unit is a "${s.noun}"`);
  if (noun !== "pack") {
    list.ok(!/\bpacks?\b/i.test(every),
      `${s.name}: never calls a ${noun} a pack (${every.slice(0, 110)})`);
  }

  // RULE 3. NEVER A PIECE COUNT. CLAUDE.md, five times over: pieces are the
  // ledger's unit and never reach a word Ali reads.
  list.ok(!/\bpcs\b|\bpieces?\b/i.test(every),
    `${s.name}: no piece count anywhere (${every.slice(0, 110)})`);

  // RULE 4. Plurals are English. "pouchs" reached production; it is the noun
  // for every gram-measured product, body butter included.
  list.ok(!/\b\w+(chs|shs|ss|xs|zs)\b/i.test(every),
    `${s.name}: plurals are spelled correctly (${every.slice(0, 110)})`);

  // RULE 5. A product with nothing to say about its packing says NOTHING,
  // rather than "1/pk × 1/ctn" — three numbers carrying no information, which
  // is the second line of the row Ali photographed.
  if (s.pcsPerPack === 1 && s.packsPerCarton === 1) {
    list.is(packConfigText(cfg), null, `${s.name}: has no pack configuration to state`);
    list.is(packConfigSentence(cfg), null, `${s.name}: and does not invent one in prose`);
  } else {
    list.ok(packConfigText(cfg) !== null, `${s.name}: states its pack configuration`);
  }

  // RULE 6. Zero is "0", never "0 ctn" of a thing with no carton, and never
  // an empty string that leaves a row looking broken.
  list.ok(formatStockQty(0, cfg) === "0",
    `${s.name}: no stock reads "0" (${formatStockQty(0, cfg)})`);

  // RULE 7. The two formatters answer different questions and BOTH must
  // answer. The ledger keeps a loose tier (a torn pack is real); the selling
  // view honours sellable_units. Neither may return nothing.
  for (const q of QTYS) {
    list.ok(formatStockQty(q, cfg).length > 0 && formatQtyInTradeUnits(q, cfg).length > 0,
      `${s.name}: both formatters answer for ${q}`);
  }
}

// RULE 8. The plural helper itself, on the words this catalogue actually uses.
// It is ONE helper: the cart had its own copy with the same + "s" bug, so
// "2 pouchs" could reach an order as well as a stock screen (audit:onedef
// caught that, not me).
for (const [n, noun, want] of [
  [1, "tub", "1 tub"], [2, "tub", "2 tubs"],
  [1, "pouch", "1 pouch"], [12, "pouch", "12 pouches"],
  [3, "sachet", "3 sachets"], [6, "bottle", "6 bottles"],
  [2, "set", "2 sets"], [4, "box", "4 boxes"],
]) {
  list.is(plural(n, noun), want, `plural: ${want}`);
  list.is(pluralNoun(noun, n), want.split(" ").slice(1).join(" "),
    `pluralNoun: ${noun} x${n}`);
}

finish(list.report());
