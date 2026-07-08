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

  // Delivery address — from sales_orders (per-order, not customer profile)
  deliveryName: string;          // customers.name (order's customer name)
  deliveryAddressLine1: string | null; // e.g. "H. EKKALAGE"
  deliveryAddressLine2: string | null; // e.g. "MADUGADHOSHU MAGU"
  deliveryIsland: string | null;       // e.g. "MALE"
  customerPhone: string | null;
}

export async function getLabelData(
  orderId: string,
  lineId: string,
): Promise<LabelData> {
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
        delivery_address_line1,
        delivery_address_line2,
        delivery_island,
        customers (
          name,
          phone,
          address,
          road,
          island
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
    delivery_address_line1: string | null;
    delivery_address_line2: string | null;
    delivery_island: string | null;
    customers: { name: string; phone: string | null; address: string | null; road: string | null; island: string | null } | null;
  } | null;
  const customer = order?.customers ?? null;

  const attrs = (variant?.attributes ?? {}) as Record<string, unknown>;

  return {
    lineId: line.id,
    orderId: line.order_id,
    orderNumber: order?.order_number ?? "",
    qty: Number(line.qty),
    uom: line.uom,

    brandName: "",
    modelName: model?.name ?? "",
    variantDisplay: variant?.display_name ?? "",
    categoryName: category?.name ?? "",
    pcsPerPack: sku?.pcs_per_pack ?? 0,
    packsPerCarton: sku?.packs_per_carton ?? 0,

    size: typeof attrs.size === "string" ? attrs.size : null,
    volumeMl: typeof attrs.volume_ml === "number" ? attrs.volume_ml : null,

    deliveryName: customer?.name ?? "",
    // Prefer the order's one-off delivery address as a whole; only when the
    // order has NO delivery address at all do we fall back to the customer's
    // saved profile — so a label is never blank just because no per-order
    // address was typed, and we never mix an order line with a customer
    // island. Customer house/shop (address) → line 1, road → line 2.
    ...(() => {
      const hasOrderAddress = !!(order?.delivery_address_line1 || order?.delivery_address_line2 || order?.delivery_island);
      return hasOrderAddress
        ? {
            deliveryAddressLine1: order?.delivery_address_line1 ?? null,
            deliveryAddressLine2: order?.delivery_address_line2 ?? null,
            deliveryIsland: order?.delivery_island ?? null,
          }
        : {
            deliveryAddressLine1: customer?.address ?? null,
            deliveryAddressLine2: customer?.road ?? null,
            deliveryIsland: customer?.island ?? null,
          };
    })(),
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
