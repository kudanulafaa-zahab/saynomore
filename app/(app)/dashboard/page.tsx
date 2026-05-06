import { getSupabaseServer } from "@/lib/supabase-server";
import { Package, Truck, Boxes, ShoppingCart } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await getSupabaseServer();

  const [brandsRes, skusRes, shipmentsRes, salesRes] = await Promise.all([
    supabase.from("brands").select("*", { count: "exact", head: true }),
    supabase.from("skus").select("*", { count: "exact", head: true }),
    supabase.from("shipments").select("*", { count: "exact", head: true }),
    supabase.from("sales_orders").select("*", { count: "exact", head: true }),
  ]);

  const stats = [
    { label: "Brands", value: brandsRes.count ?? 0, icon: Package, href: "/products", color: "from-indigo-500 to-purple-500" },
    { label: "SKUs", value: skusRes.count ?? 0, icon: Boxes, href: "/products", color: "from-blue-500 to-cyan-500" },
    { label: "Shipments", value: shipmentsRes.count ?? 0, icon: Truck, href: "/shipments", color: "from-emerald-500 to-teal-500" },
    { label: "Sales Orders", value: salesRes.count ?? 0, icon: ShoppingCart, href: "/sales", color: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Welcome back</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Dashboard</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map(({ label, value, icon: Icon, href, color }) => (
          <Link key={label} href={href} className="glass p-4 sm:p-5 block group">
            <div className="flex items-start justify-between mb-3 sm:mb-4">
              <div
                className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${color}`}
                style={{ boxShadow: "0 8px 24px rgba(99,102,241,0.25)" }}
              >
                <Icon className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-white" />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-semibold text-foreground mb-0.5 sm:mb-1 group-hover:text-primary transition">{value}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">{label}</p>
          </Link>
        ))}
      </div>

      <div className="glass p-6 sm:p-10 text-center space-y-3">
        <h2 className="text-base sm:text-lg font-medium text-foreground">Get started</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Begin by adding your first <strong className="text-foreground">Brand</strong>.
          Then build out the catalogue with models, variants, and SKUs.
        </p>
        <Link
          href="/products"
          className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-medium text-white"
          style={{ background: "#6366f1", boxShadow: "0 8px 24px rgba(99,102,241,0.35)" }}
        >
          <Package className="h-4 w-4" />
          Open Products
        </Link>
      </div>
    </div>
  );
}
