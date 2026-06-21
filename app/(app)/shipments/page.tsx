import { ShipmentsList } from "@/components/shipments/shipments-list";
import { getShipmentsData } from "./data";

// Server component: fetch the screen's data here so it arrives WITH the page
// (no client-side mount-then-fetch waterfall). loading.tsx streams the skeleton
// while this runs.
export default async function Page() {
  const initialData = await getShipmentsData();
  return (
    <div className="max-w-4xl mx-auto">
      <ShipmentsList initialData={initialData} />
    </div>
  );
}
