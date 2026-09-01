import { ProductsExplorer } from "@/components/products/products-explorer";
import { ProductsList } from "@/components/products/products-list";
import { CategoriesManager } from "@/components/products/categories-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SetupGaps } from "@/components/products/setup-gaps";

const TABS = ["tree", "all", "categories"] as const;
type Tab = (typeof TABS)[number];

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: Tab = (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "tree";

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Product Catalogue</p>
        <h1 className="ios-page-title">Products</h1>
      </div>

      {/* Above the tabs on purpose: it is about the catalogue as a whole, not
          about any one view of it, and it renders nothing at all when every
          product is ready — so it costs no space on a normal day. */}
      <SetupGaps />

      {/* `?tab=` so a link can land on the right tab — Setup Gaps sends the
          "sold differently from its type" row straight to Categories, which is
          the only screen that can fix it.
          KEYED ON THE TAB because defaultValue is uncontrolled: Setup Gaps sits
          on THIS page, so following its link is a same-page navigation and the
          Tabs would otherwise keep whatever tab was already open. The key
          remounts them, which is what makes the link actually arrive. */}
      <Tabs key={active} defaultValue={active} className="space-y-4">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="tree">By Brand</TabsTrigger>
          <TabsTrigger value="all">All SKUs</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="tree">
          <ProductsExplorer />
        </TabsContent>
        <TabsContent value="all">
          <ProductsList />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
