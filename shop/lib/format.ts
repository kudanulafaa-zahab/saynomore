// Matches the staff app's convention: whole-number MVR, "MVR" prefix — see
// components/sales/sales-list.tsx. Prices already arrive rounded to 0dp from
// get_storefront_catalogue(), this just adds thousands separators.
export function formatMvr(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `MVR ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
