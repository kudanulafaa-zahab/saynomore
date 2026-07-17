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
// Same layout as diaper except: no SIZE cell, right product cell spans full width.
// SoSoft product cell: x = 175–1235 (no right size column).

const W = 1240;
const H = 1748;
const F = "Arial, Helvetica, sans-serif";

export function DetergentTemplate({ data, boatName, boatJetty, boatDate, boatTime }: Props) {
  const variant     = data.variantDisplay ?? "";
  const bottlesCase = data.packsPerCarton ? `${data.packsPerCarton} Bottles / Case` : "";
  const volLabel    = data.volumeMl
    ? data.volumeMl >= 1000
      ? `${data.volumeMl / 1000}L / Bottle`
      : `${data.volumeMl}ml / Bottle`
    : "";

  const name   = (data.deliveryName          ?? "").toUpperCase();
  const addr1  = (data.deliveryAddressLine1  ?? "").toUpperCase();
  const addr2  = (data.deliveryAddressLine2  ?? "").toUpperCase();
  const island = (data.deliveryIsland        ?? "").toUpperCase();
  const phone  =  data.customerPhone ?? "";

  return (
    <div style={{ width: "105mm", height: "148mm", position: "relative", overflow: "hidden", background: "white" }}>
      {/* Layer 1 — PNG base. Deliberately a plain <img>, not next/image: this
          is a fixed-size print label (105mm × 148mm), not a responsive web
          image — next/image's lazy-loading/srcset/layout-shift machinery has
          nothing to optimize here and risks disturbing the exact absolute
          positioning the SVG text overlay below is aligned against. */}
      <img
        src="/sosoft-label-design.png"
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />

      {/* Layer 2 — live text overlay */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* ── PRODUCT CELL (x=264–1235, y=263–455, no SIZE sub-cell) ── */}
        {/* Brand name "SoSoft Detergent" is static in PNG above this cell */}
        {variant && (
          <text x="280" y="305" fontFamily={F} fontWeight="700" fontSize="44" fill="#000" dominantBaseline="middle">
            {variant}
          </text>
        )}
        {bottlesCase && (
          <text x="280" y="365" fontFamily={F} fontWeight="700" fontSize="38" fill="#000" dominantBaseline="middle">
            {bottlesCase}
          </text>
        )}
        {volLabel && (
          <text x="280" y="420" fontFamily={F} fontWeight="700" fontSize="38" fill="#000" dominantBaseline="middle">
            {volLabel}
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
