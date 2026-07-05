import { ReorderView } from "@/components/shipments/reorder-view";

export const metadata = { title: "Reorder — SayNoMore" };

export default function ReorderPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Procurement</p>
        <h1 className="ios-page-title">What to Order Next</h1>
        <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>
          Based on your real sales speed. Tick what to order, adjust quantities, create a draft PO.
        </p>
      </div>
      <ReorderView />
    </div>
  );
}
