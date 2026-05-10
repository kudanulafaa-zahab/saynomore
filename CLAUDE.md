# SayNoMore — Project Rules

## Behaviour
- Plain English. One recommendation. Lead with the answer.
- Never ask Ali to choose between technical options.

## Stack (locked)
Next.js 15 App Router · TypeScript strict · Tailwind CSS v4 · shadcn/ui · Supabase (Postgres) · Vercel · Lucide icons

## Design
- Light/dark adaptive: use CSS vars (`var(--foreground)`, `var(--background)`, `var(--glass-1)`, `var(--glass-2)`, `var(--muted-foreground)`, `var(--glass-border)`) — never hardcode hex colours
- Primary action buttons: `background: var(--foreground)` / `color: var(--background)`
- Cards: `background: var(--glass-1)` with `backdropFilter: blur(20px)`
- Responsive grids: Tailwind classes (`grid-cols-1 sm:grid-cols-3`) not inline `gridTemplateColumns`
- No decorative watermark icons behind content

## Hard Rules (never break)
1. All financial calculations in **Postgres**, never TypeScript
2. Stock quantity derived from `stock_movements` sum — never stored directly
3. Forex rate locked at GRN confirmation — never recalculate after
4. Zero-CBM shipment line → block GRN with clear error
5. SKU hierarchy = 7 levels: Brand → Category → Variant → Packaging → Unit Size → Units/Pack → Packs/Carton
6. Push to GitHub after every confirmed working change
7. Never call Supabase directly in pages — always via `lib/queries/`

## Key paths
- Queries: `lib/queries/` · Pages: `app/(app)/` · Components: `components/`
- Sales status flow: `draft → confirmed → out_for_delivery → delivered`
- `postSale(orderId)` RPC deducts stock FIFO on confirmation
