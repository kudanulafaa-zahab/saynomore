-- 0189 — a product name says its size once.
--
-- Ali, 2026-08-20: *"What's mamypoko m of m? What does that even mean?"*
--
-- Nothing. It is a size printed twice, and it was going out to CUSTOMERS:
--
--     "Hi Luhaa! We now stock Mamypoko Xtra Kering M in M.
--      Same size as before. Happy to send some over today."
--
-- `get_stranded_customers` built `swap_label` as brand + model + SIZE, and
-- returned the size again in its own column. Every caller pairs the two —
-- `switchDrafts(name, swap_label, dropped_size)` appends " in M" — so the size
-- was always doubled. The follow-up round did not introduce this; it has been
-- in the At risk lens since 0180 and simply had fewer readers.
--
-- THE FIX IS AT THE SOURCE, not at the two call sites. A label that contains a
-- field which is also its own column is a trap set for every future caller: the
-- next screen to use it would print "M in M" again, and would look correct in
-- review. `swap_label` is now the PRODUCT — brand and model — and the size
-- travels in `swap_size` where it belongs.
--
-- WHY THIS MATTERS MORE THAN A TYPO. This text is not app chrome; it is a
-- message to a customer, sent under Ali's name, about a product they are being
-- asked to switch to. "Xtra Kering M in M" reads as though nobody checked, and
-- the whole point of the swap message is to make a change feel considered.
--
-- Rewritten by replacement rather than retyped: 0180's function is long, the
-- label is one line of it, and re-declaring the other forty lines to change one
-- is how an unrelated clause gets silently dropped.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname = 'get_stranded_customers';

  v_src := replace(v_src,
    'b2.name || '' '' || pm2.name
           || coalesce('' '' || (v2.attributes->>''size''), '''') as label',
    'b2.name || '' '' || pm2.name as label');

  execute v_src;
end $$;

comment on function get_stranded_customers() is
  'Customers whose whole history in a category is a range we stopped buying, '
  'with a replacement we actually hold. swap_label is the PRODUCT only — brand '
  'and model — because swap_size carries the size and every caller pairs them. '
  'A label that repeats one of its own columns produced "Xtra Kering M in M" '
  'in a message to a customer.';
