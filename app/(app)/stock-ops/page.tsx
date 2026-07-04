import { Suspense } from "react";
import { StockOpsView } from "@/components/inventory/stock-ops-view";

export default function Page() {
  return (
    <div className="max-w-2xl mx-auto">
      <Suspense fallback={null}>
        <StockOpsView />
      </Suspense>
    </div>
  );
}
