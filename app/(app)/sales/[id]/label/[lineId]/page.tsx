import { LabelPageClient } from "@/components/labels/label-page-client";

export default async function LabelPage({
  params,
}: {
  params: Promise<{ id: string; lineId: string }>;
}) {
  const { id, lineId } = await params;
  return <LabelPageClient orderId={id} lineId={lineId} />;
}
