import { SaleDetail } from "@/components/sales/sale-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-4xl mx-auto">
      <SaleDetail id={id} />
    </div>
  );
}
