"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getLabelData, type LabelData } from "@/lib/queries/labels";
import { LabelPreview } from "./label-preview";
import "./label.css";

export function LabelPageClient({ orderId, lineId }: { orderId: string; lineId: string }) {
  const [data, setData]   = useState<LabelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLabelData(orderId, lineId)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [orderId, lineId]);

  if (error) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100vh", padding: 24 }}>
        <p style={{ color: "var(--snm-error)", fontSize: 14 }}>Failed to load label: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ background: "var(--background)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100vh", padding: "16px 16px 40px" }}>
      <LabelPreview data={data} />
    </div>
  );
}
