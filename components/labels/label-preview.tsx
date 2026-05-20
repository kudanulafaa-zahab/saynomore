"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, Pencil } from "lucide-react";
import type { LabelData } from "@/lib/queries/labels";
import { DiaperTemplate } from "./diaper-template";
import { DetergentTemplate } from "./detergent-template";

function todayFormatted() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function pickTemplate(categoryName: string): "diaper" | "detergent" | "generic" {
  const n = categoryName.toLowerCase();
  if (n.includes("diaper")) return "diaper";
  if (n.includes("detergent") || n.includes("liquid") || n.includes("powder") || n.includes("soap")) return "detergent";
  return "generic";
}

export function LabelPreview({ data }: { data: LabelData }) {
  const router = useRouter();
  const [boatName,   setBoatName]   = useState("");
  const [boatJetty,  setBoatJetty]  = useState("");
  const [boatDate,   setBoatDate]   = useState(todayFormatted());
  const [boatNumber, setBoatNumber] = useState("");
  const [editing,    setEditing]    = useState(true);

  const template = pickTemplate(data.categoryName);

  const templateProps = {
    data,
    boatName,
    boatJetty,
    boatDate,
    boatNumber,
  };

  function handlePrint() {
    window.print();
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--glass-bg-1)",
    color: "var(--foreground)",
    border: "0.5px solid var(--glass-border-lo)",
    borderRadius: 10,
    padding: "11px 14px",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <>
      {/* ── Screen UI (hidden at print) ── */}
      <div className="no-print screen-ui">
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button
            onClick={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 10, background: "var(--glass-1)", border: "none", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <ArrowLeft style={{ width: 18, height: 18 }} />
          </button>
          <div style={{ flex: 1 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>Label Preview</p>
            <p style={{ color: "var(--foreground)", fontSize: 16, fontWeight: 600 }}>
              {data.modelName}
              {data.variantDisplay ? ` · ${data.variantDisplay}` : ""}
            </p>
          </div>
        </div>

        {/* Label preview box */}
        <div style={{ background: "white", borderRadius: 16, padding: 4, marginBottom: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.15)" }}>
          <div className="label-scale-wrapper">
            {template === "diaper"    && <DiaperTemplate    {...templateProps} />}
            {template === "detergent" && <DetergentTemplate {...templateProps} />}
            {template === "generic"   && <DiaperTemplate    {...templateProps} />}
          </div>
        </div>

        {/* Boat details panel */}
        <div style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", borderRadius: 16, marginBottom: 16, overflow: "hidden", boxShadow: "var(--glass-shadow), var(--glass-inner)", border: "0.5px solid var(--glass-border-lo)" }}>
          <button
            onClick={() => setEditing(!editing)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "transparent", border: "none", color: "var(--foreground)", cursor: "pointer" }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <Pencil style={{ width: 15, height: 15, color: "var(--muted-foreground)" }} />
              Boat Details
            </span>
            <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{editing ? "▲" : "▼"}</span>
          </button>

          {editing && (
            <div style={{ padding: "0 20px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Boat Name</p>
                <input
                  value={boatName}
                  onChange={(e) => setBoatName(e.target.value)}
                  placeholder="e.g. JUPITER"
                  style={inputStyle}
                />
              </div>
              <div>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Jetty</p>
                <input
                  value={boatJetty}
                  onChange={(e) => setBoatJetty(e.target.value)}
                  placeholder="e.g. T Jetty"
                  style={inputStyle}
                />
              </div>
              <div>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Date</p>
                <input
                  value={boatDate}
                  onChange={(e) => setBoatDate(e.target.value)}
                  placeholder="DD/MM/YY"
                  style={inputStyle}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 500, marginBottom: 6 }}>Boat Number</p>
                <input
                  value={boatNumber}
                  onChange={(e) => setBoatNumber(e.target.value)}
                  placeholder="e.g. 9465611"
                  style={inputStyle}
                />
              </div>
            </div>
          )}
        </div>

        {/* Print button */}
        <button
          onClick={handlePrint}
          style={{ width: "100%", background: "var(--foreground)", color: "var(--background)", border: "none", borderRadius: 999, padding: 16, fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
        >
          <Printer style={{ width: 18, height: 18 }} />
          Print Label
        </button>
      </div>

      {/* ── Print-only label (shown at print, hidden on screen) ── */}
      <div className="print-only">
        {template === "diaper"    && <DiaperTemplate    {...templateProps} />}
        {template === "detergent" && <DetergentTemplate {...templateProps} />}
        {template === "generic"   && <DiaperTemplate    {...templateProps} />}
      </div>
    </>
  );
}
