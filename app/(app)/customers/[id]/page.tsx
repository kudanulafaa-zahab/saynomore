import { CustomerDetail } from "@/components/masters/customer-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-4xl mx-auto">
      <CustomerDetail id={id} />
    </div>
  );
}
