-- 0113 — Which godown fulfils a web order.
--
-- Phase 1 of the customer storefront (see docs/STOREFRONT_PLAN.md and the
-- approved plan) uses a single configured warehouse to fulfil every web
-- order, rather than per-order routing logic. This needs one source of truth
-- both the public catalogue view and the order-placing RPC can read — not a
-- godown UUID hardcoded into application code.
--
-- Mirrors the existing `is_default` boolean pattern on this table. A partial
-- unique index enforces at most one `true` row structurally, which
-- `is_default` itself does not have today — worth doing properly here since
-- this flag gates what an anonymous public API can see and sell against.
--
-- Seeded to Veesange: the current default godown, already fulfilling the
-- large majority of orders (58 of 58 non-web orders today). Staff can move
-- this flag to Funvilu later from the Godowns screen once that UI exists;
-- for now it is set directly, once, here.

alter table public.godowns
  add column if not exists is_web_fulfilment boolean not null default false;

create unique index if not exists godowns_one_web_fulfilment
  on public.godowns (is_web_fulfilment)
  where is_web_fulfilment;

update public.godowns set is_web_fulfilment = true
where name = 'Veesange'
  and not exists (select 1 from public.godowns where is_web_fulfilment);
