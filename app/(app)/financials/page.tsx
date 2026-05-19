import { Suspense } from "react";
import { FinancialsView } from "@/components/financials/financials-view";

export default function FinancialsPage() {
  return (
    <Suspense>
      <FinancialsView />
    </Suspense>
  );
}
