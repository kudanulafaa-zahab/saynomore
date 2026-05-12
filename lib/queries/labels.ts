"use client";

import { supabase } from "@/lib/supabase";

export interface LabelData {
  // Order line
  lineId: string;
  orderId: string;
  orderNumber: string;
  qty: number;
  uom: string;

  // Product
  brandName: string;
  modelName: string;
  variantDisplay: string;
  categoryName: string;
  pcsPerPack: number;
  packsPerCarton: number;
  // From variant attributes
  size: string | null;       // e.g. "XL", "M"
  volumeMl: number | null;   // e.g. 700

  // Customer
  customerName: string;
  customerIsland: string | null;
  customerPhone: string | null;
}

export async function getLabelData(
  orderId: string,
  lineId: string,
): Promise<LabelData> {
  // Fetch the order line + sku + variant + model + category + customer in one shot
  const { data: line, error: lineErr } = await supabase
    .from("sales_order_lines")
    .select(`
      id,
      order_id,
      qty,
      uom,
      skus (
        pcs_per_pack,
        packs_per_carton,
        variants (
          display_name,
          attributes,
          product_models (
            name,
            product_categories ( name )
          )
        )
      ),
      sales_orders (
        order_number,
        customers (
          name,
          island,
          phone
        )
      )
    `)
    .eq("id", lineId)
    .eq("order_id", orderId)
    .single();

  if (lineErr || !line) throw new Error(lineErr?.message ?? "Line not found");

  const sku = (line.skus as unknown) as {
    pcs_per_pack: number;
    packs_per_carton: number;
    variants: {
      display_name: string;
      attributes: Record<string, unknown>;
      product_models: {
        name: string;
        product_categories: { name: string } | null;
      } | null;
    } | null;
  } | null;

  const variant = sku?.variants ?? null;
  const model = variant?.product_models ?? null;
  const category = model?.product_categories ?? null;
  const order = (line.sales_orders as unknown) as {
    order_number: string;
    customers: { name: string; island: string | null; phone: string | null } | null;
  } | null;
  const customer = order?.customers ?? null;

  const attrs = (variant?.attributes ?? {}) as Record<string, unknown>;

  return {
    lineId: line.id,
    orderId: line.order_id,
    orderNumber: order?.order_number ?? "",
    qty: Number(line.qty),
    uom: line.uom,

    brandName: "", // brand name not directly needed on label
    modelName: model?.name ?? "",
    variantDisplay: variant?.display_name ?? "",
    categoryName: category?.name ?? "",
    pcsPerPack: sku?.pcs_per_pack ?? 0,
    packsPerCarton: sku?.packs_per_carton ?? 0,

    size: typeof attrs.size === "string" ? attrs.size : null,
    volumeMl: typeof attrs.volume_ml === "number" ? attrs.volume_ml : null,

    customerName: customer?.name ?? "",
    customerIsland: customer?.island ?? null,
    customerPhone: customer?.phone ?? null,
  };
}

export async function getAllLabelData(orderId: string): Promise<LabelData[]> {
  const { data: lines, error } = await supabase
    .from("sales_order_lines")
    .select("id")
    .eq("order_id", orderId);

  if (error || !lines) throw new Error(error?.message ?? "Failed to load lines");

  const results = await Promise.all(
    lines.map((l) => getLabelData(orderId, l.id)),
  );
  return results;
}
