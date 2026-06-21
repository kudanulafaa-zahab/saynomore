import { InventoryView } from "@/components/inventory/inventory-view";
import { getInventoryData } from "./data";

// Server component: data fetched here so the screen arrives populated.
export default async function Page() {
  const initialData = await getInventoryData();
  return (
    <div className="max-w-4xl mx-auto">
      <InventoryView initialData={initialData} />
    </div>
  );
}
