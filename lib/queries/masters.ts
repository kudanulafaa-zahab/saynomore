"use client";

import { supabase } from "@/lib/supabase";

// ── Suppliers ────────────────────────────────────────────────────────────

export type SupplierCurrency = "IDR" | "USD" | "MVR" | "MYR" | "THB" | "CNY" | "EUR";

export interface SupplierRow {
  id: string;
  name: string;
  country: string;
  invoice_currency: SupplierCurrency;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface SupplierInput {
  name: string;
  country: string;
  invoice_currency: SupplierCurrency;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

export async function listSuppliers(): Promise<SupplierRow[]> {
  const { data, error } = await supabase.from("suppliers").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createSupplier(input: SupplierInput) {
  const { data, error } = await supabase.from("suppliers").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateSupplier(id: string, patch: Partial<SupplierInput>) {
  const { error } = await supabase.from("suppliers").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteSupplier(id: string) {
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) throw error;
}

// ── Customers ────────────────────────────────────────────────────────────

export type CustomerChannel = "whatsapp" | "viber" | "messenger" | "instagram" | "tiktok" | "facebook" | "walkin" | "phone" | "other";

export interface CustomerRow {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  island: string | null;
  channel: CustomerChannel | null;
  notes: string | null;
  created_at: string;
}

export interface CustomerInput {
  name: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  island?: string | null;
  channel?: CustomerChannel | null;
  notes?: string | null;
}

export async function listCustomers(): Promise<CustomerRow[]> {
  const { data, error } = await supabase.from("customers").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createCustomer(input: CustomerInput) {
  const { data, error } = await supabase.from("customers").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id: string, patch: Partial<CustomerInput>) {
  const { error } = await supabase.from("customers").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCustomer(id: string) {
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) throw error;
}

// ── Godowns ──────────────────────────────────────────────────────────────

export interface GodownRow {
  id: string;
  name: string;
  location: string | null;
  is_default: boolean;
  created_at: string;
}

export interface GodownInput {
  name: string;
  location?: string | null;
  is_default?: boolean;
}

export async function listGodowns(): Promise<GodownRow[]> {
  const { data, error } = await supabase.from("godowns").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createGodown(input: GodownInput) {
  const { data, error } = await supabase.from("godowns").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateGodown(id: string, patch: Partial<GodownInput>) {
  const { error } = await supabase.from("godowns").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteGodown(id: string) {
  const { error } = await supabase.from("godowns").delete().eq("id", id);
  if (error) throw error;
}
