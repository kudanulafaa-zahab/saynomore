import { PriceListsView } from "@/components/finance/price-lists-view";

export const metadata = { title: "Price Lists — SayNoMore" };

export default function PriceListsPage() {
  return (
    <div className="pb-10">
      <PriceListsView />
    </div>
  );
}
