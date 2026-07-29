"use client";

import { supabase } from "@/lib/supabase";
import type { SellUnit } from "@/lib/queries/catalogue";

export type PaymentMethod = "cod" | "bank_transfer";

export interface CheckoutLine {
  sku_id: string;
  uom: SellUnit;
  qty: number;
}

export interface CheckoutInput {
  name: string;
  phone: string;
  island: string;
  address: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  lines: CheckoutLine[];
  // Hidden form field a real shopper never fills; place_customer_order
  // silently rejects anything else if this isn't empty. See migration 0116.
  honeypot?: string;
}

export interface PlacedOrder {
  order_number: string;
  order_id: string;
}

export async function placeOrder(input: CheckoutInput): Promise<PlacedOrder> {
  const { data, error } = await supabase.rpc("place_customer_order", {
    p_customer_name: input.name,
    p_customer_phone: input.phone,
    p_delivery_island: input.island,
    p_delivery_address: input.address,
    p_payment_method: input.paymentMethod,
    p_lines: input.lines,
    p_notes: input.notes || null,
    p_honeypot: input.honeypot || null,
  });
  if (error) throw error;
  // returns table(...) comes back as an array of one row
  const row = Array.isArray(data) ? data[0] : data;
  return row as PlacedOrder;
}
