# SKILL.md — Domain Formulas

## Landed Cost Calculation

All steps execute in Postgres functions, never in application code.

```
total_mvr = freight_usd × rate_usd_to_mvr
          + duty_mvr
          + agent_mvr
          + other_mvr
          + SUM(fob_price × qty_cartons × rate_to_mvr)  -- per line

line_share_mvr = (line_cbm / total_shipment_cbm) × total_mvr

landed_per_carton = line_share_mvr / qty_cartons
landed_per_pack   = landed_per_carton / packs_per_carton
landed_per_piece  = landed_per_carton / (units_per_pack × packs_per_carton)
```

## Stock Quantity

Never stored. Always derived:

```sql
SELECT COALESCE(SUM(
  CASE type WHEN 'in' THEN qty_pieces
            WHEN 'out' THEN -qty_pieces
            WHEN 'adjust' THEN qty_pieces
  END
), 0) AS stock
FROM stock_movements
WHERE sku_id = $1 AND godown_id = $2;
```
