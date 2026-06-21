import { ProductsExplorer } from "@/components/products/products-explorer";
import { ProductsList } from "@/components/products/products-list";
import { CategoriesManager } from "@/components/products/categories-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getProductsData } from "./data";

export default async function ProductsPage() {
  const initialData = await getProductsData();
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Product Catalogue</p>
        <h1 className="ios-page-title">Products</h1>
      </div>

      <Tabs defaultValue="tree" className="space-y-4">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="tree">By Brand</TabsTrigger>
          <TabsTrigger value="all">All SKUs</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="tree">
          <ProductsExplorer initialData={initialData} />
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
