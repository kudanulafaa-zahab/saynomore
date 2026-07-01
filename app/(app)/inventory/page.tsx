import { Suspense } from "react";
import { InventoryView } from "@/components/inventory/inventory-view";

export default function Page() {
  return (
    <div className="max-w-4xl mx-auto">
      <Suspense fallback={null}>
        <InventoryView />
      </Suspense>
    </div>
  );
}
