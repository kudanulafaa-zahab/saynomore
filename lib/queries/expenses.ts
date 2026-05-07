"use client";

import { supabase } from "@/lib/supabase";

export type SpendChannel = "meta_boost" | "google" | "tiktok_ad" | "other";

export interface MarketingSpendRow {
  id: string;
  channel: SpendChannel;
  amount_mvr: number;
  campaign_name: string | null;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  sku_ids?: string[];
}

export interface MarketingSpendInput {
  channel: SpendChannel;
  amount_mvr: number;
  campaign_name?: string | null;
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
  sku_ids?: string[];
}

export async function listMarketingSpend(): Promise<MarketingSpendRow[]> {
  const { data, error } = await supabase
    .from("marketing_spend")
    .select("*, marketing_spend_skus(sku_id)")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as Omit<MarketingSpendRow, "sku_ids">),
    sku_ids: ((row.marketing_spend_skus as { sku_id: string }[]) ?? []).map((r) => r.sku_id),
  }));
}

export async function createMarketingSpend(input: MarketingSpendInput): Promise<MarketingSpendRow> {
  const { sku_ids, ...rest } = input;
  const { data, error } = await supabase.from("marketing_spend").insert(rest).select().single();
  if (error) throw error;
  const spend = data as MarketingSpendRow;
  if (sku_ids && sku_ids.length > 0) {
    const links = sku_ids.map((sku_id) => ({ spend_id: spend.id, sku_id }));
    const { error: linkErr } = await supabase.from("marketing_spend_skus").insert(links);
    if (linkErr) throw linkErr;
  }
  return { ...spend, sku_ids: sku_ids ?? [] };
}

export async function updateMarketingSpend(id: string, input: MarketingSpendInput): Promise<void> {
  const { sku_ids, ...rest } = input;
  const { error } = await supabase.from("marketing_spend").update(rest).eq("id", id);
  if (error) throw error;
  // replace SKU links
  await supabase.from("marketing_spend_skus").delete().eq("spend_id", id);
  if (sku_ids && sku_ids.length > 0) {
    const links = sku_ids.map((sku_id) => ({ spend_id: id, sku_id }));
    const { error: linkErr } = await supabase.from("marketing_spend_skus").insert(links);
    if (linkErr) throw linkErr;
  }
}

export async function deleteMarketingSpend(id: string): Promise<void> {
  const { error } = await supabase.from("marketing_spend").delete().eq("id", id);
  if (error) throw error;
}
