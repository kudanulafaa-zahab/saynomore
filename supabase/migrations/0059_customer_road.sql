-- ============================================================================
-- 0059 — Add road/street as its own field on customers
-- ============================================================================
-- customers.address was one freeform field holding both the house/shop name
-- AND the road name (e.g. "H. Adhunge, Raivilla Magu"), so the road never had
-- its own place on the label — it either got jammed onto line 1 with the
-- house name, or lost entirely. sales_orders already split this properly
-- (delivery_address_line1 / delivery_address_line2, see 0029); customers now
-- gets the same split: address = house/shop, road = street name.
-- ============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS road TEXT;
