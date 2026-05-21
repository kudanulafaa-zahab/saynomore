"use client";
import React from "react";
import type { LabelData } from "@/lib/queries/labels";

interface Props {
  data: LabelData;
  boatName: string;
  boatJetty: string;
  boatDate: string;
  boatTime: string;
  boatNumber: string;
}

// PNG: 1240 × 1748 px. All SVG coordinates are in this pixel space.
// Measured zones (approximate px from top):
//   Product row:          y = 265–545  (cell x = 175–955 | SIZE cell x = 955–1240)
//     brand name row:     y ≈ 265–365  (static in PNG: "Mamypoko Diaper Pants")
//     dynamic rows below: y ≈ 370–545
//   DELIVER TO header:    y = 545–618  (static in PNG)
//   Address/boat block:   y = 618–840  (4 rows, ~55px spacing)
//     row centres:        645, 700, 755, 810
//   CONTACT NO row:       y = 840–910
//     phone box:          x = 410–870, centre y ≈ 875
//   Column split (L|R):   x ≈ 648
//   Boat labels end:      x ≈ 870  → values start x = 878

const W = 1240;
const H = 1748;
const F = "Arial, Helvetica, sans-serif";

export function DiaperTemplate({ data, boatName, boatJetty, boatDate, boatTime }: Props) {
  const model    = (data.variantDisplay ?? "").toUpperCase();
  const pcsLine  = data.pcsPerPack      ? `${data.pcsPerPack} PCS / PACK`        : "";
  const packLine = data.packsPerCarton  ? `${data.packsPerCarton} PACKS / CASE`  : "";
  const sizeVal  = (data.size ?? "").toUpperCase();

  const name   = (data.deliveryName          ?? "").toUpperCase();
  const addr1  = (data.deliveryAddressLine1  ?? "").toUpperCase();
  const addr2  = (data.deliveryAddressLine2  ?? "").toUpperCase();
  const island = (data.deliveryIsland        ?? "").toUpperCase();
  const phone  =  data.customerPhone ?? "";

  return (
    <div style={{ width: "105mm", height: "148mm", position: "relative", overflow: "hidden", background: "white" }}>
      {/* Layer 1 — PNG base */}
      <img
        src="/diaper-label-design.png"
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />

      {/* Layer 2 — live text overlay */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* ── PRODUCT CELL (x=264–1004, y=263–455) ── */}
        {/* Brand name "Mamypoko Diaper Pants" is static in PNG above this cell */}
        {model && (
          <text x="280" y="305" fontFamily={F} fontWeight="700" fontSize="44" fill="#000" dominantBaseline="middle">
            {model}
          </text>
        )}
        {pcsLine && (
          <text x="280" y="365" fontFamily={F} fontWeight="700" fontSize="38" fill="#000" dominantBaseline="middle">
            {pcsLine}
          </text>
        )}
        {packLine && (
          <text x="280" y="420" fontFamily={F} fontWeight="700" fontSize="38" fill="#000" dominantBaseline="middle">
            {packLine}
          </text>
        )}

        {/* ── SIZE cell (x=1004–1235, centre x=1120, centre y=359) ── */}
        {sizeVal && (
          <text x="1120" y="359" fontFamily={F} fontWeight="900" fontSize="88" fill="#000" textAnchor="middle" dominantBaseline="middle">
            {sizeVal}
          </text>
        )}

        {/* ── DELIVER TO block (left col x=74–564, text from x=90) ── */}
        {/* Header "DELIVER TO" static in PNG at y=455–530. Data rows y=590–800 */}
        <text x="90" y="590" fontFamily={F} fontWeight="900" fontSize="44" fill="#000" dominantBaseline="middle">
          {name}
        </text>
        <text x="90" y="660" fontFamily={F} fontWeight="700" fontSize="38" fill="#000" dominantBaseline="middle">
          {addr1}
        </text>
        <text x="90" y="730" fontFamily={F} fontWeight="700" fontSize="38" fill="#000" dominantBaseline="middle">
          {addr2}
        </text>
        <text x="90" y="800" fontFamily={F} fontWeight="700" fontSize="38" fill="#000" dominantBaseline="middle">
          {island}
        </text>

        {/* ── BOAT DETAILS (right col x=564–1235, text from x=580) ── */}
        <text x="580" y="590" fontFamily={F} fontWeight="700" fontSize="34" fill="#000" dominantBaseline="middle">
          {boatName}
        </text>
        <text x="580" y="660" fontFamily={F} fontWeight="700" fontSize="34" fill="#000" dominantBaseline="middle">
          {boatJetty}
        </text>
        <text x="580" y="730" fontFamily={F} fontWeight="700" fontSize="34" fill="#000" dominantBaseline="middle">
          {boatTime}
        </text>
        <text x="580" y="800" fontFamily={F} fontWeight="700" fontSize="34" fill="#000" dominantBaseline="middle">
          {boatDate}
        </text>

        {/* ── CONTACT NO — phone box x=435–797, centre x=616, centre y=852 ── */}
        <text x="616" y="852" fontFamily={F} fontWeight="900" fontSize="60" fill="#000" textAnchor="middle" dominantBaseline="middle">
          {phone}
        </text>
      </svg>
    </div>
  );
}
