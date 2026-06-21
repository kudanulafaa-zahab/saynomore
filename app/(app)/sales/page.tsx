import { Suspense } from "react";
import { SalesList } from "@/components/sales/sales-list";

export default function Page() {
  return (
    <div className="max-w-4xl mx-auto">
      <Suspense>
        <SalesList />
      </Suspense>
    </div>
  );
}
