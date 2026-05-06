import { ProductsExplorer } from "@/components/products/products-explorer";

export default function ProductsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Master Data</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Products</h1>
      </div>
      <ProductsExplorer />
    </div>
  );
}
