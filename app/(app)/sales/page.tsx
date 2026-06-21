import { Suspense } from "react";
import { SalesList } from "@/components/sales/sales-list";
import { getSalesData } from "./data";

// Server component: fetch the screen's data here so it arrives populated, no
// client mount-then-fetch waterfall. SalesList uses useSearchParams, so it
// stays inside Suspense.
export default async function Page() {
  const initialData = await getSalesData();
  return (
    <div className="max-w-4xl mx-auto">
      <Suspense>
        <SalesList initialData={initialData} />
      </Suspense>
    </div>
  );
}
