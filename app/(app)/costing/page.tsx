import { CostingSimulator } from "@/components/costing/costing-simulator";

export const metadata = { title: "Costing Sandbox — SayNoMore" };

export default function CostingPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Procurement</p>
        <h1 className="ios-page-title">Costing Sandbox</h1>
        <p className="ios-subhead mt-1" style={{ color: "var(--muted-foreground)" }}>
          Try a container on paper. See what each product would land at, and what
          that does to your margin — without touching a single real cost.
        </p>
      </div>
      <CostingSimulator />
    </div>
  );
}
