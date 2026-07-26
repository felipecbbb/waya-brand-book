-- ============================================================
-- 0015_payments_coupons_trash.sql
-- Propósito: contabilidad polimórfica + cupones + papelera (WAYA).
--   payments       → pagos polimórficos (enrollment/rental/custom/bono/booking/order)
--   coupons        → códigos de descuento
--   deleted_items  → papelera (soft-delete con snapshot para restaurar)
-- Portado LITERALMENTE de Entreolas (versión final consolidada:
--   payments + payments-encargado + custom-payments + payment-channel +
--   unify-bono-payments, coupons, trash), ajustado al CONTRATO WAYA:
--   · payments.reservation_type CHECK con los 6 valores desde el inicio:
--       enrollment / rental / custom / bono / booking / order
--   · payments.payment_method CHECK con los 6 métodos + channel web/in_person
--   · coupons.applies_to = all/camps/classes/products/rentals; activity_type
--     libre (NULL = todos, o uno de los 6 tipos de clase Waya).
--   · RLS habilitada; las POLÍTICAS viven en 0021_rls_policies.sql
--     (coupons: lectura pública ELIMINADA → se sirve vía RPC get_coupon en 0019).
--   · Los RPC (get_user_payments, get_bono_payments, get_coupon,
--     increment_coupon_usage) viven en 0019/0020.
-- Depende de: 0002 (profiles/auth), 0005 (surf_camps → coupons.camp_id).
-- ============================================================

-- 1. PAYMENTS (contabilidad polimórfica) ---------------------
-- reference_id es una FK polimórfica SIN constraint: apunta a
-- enrollment / rental / booking / bono / order / user según reservation_type.
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  reservation_type text not null
                     check (reservation_type in
                       ('enrollment','rental','custom','bono','booking','order')),
  reference_id     uuid not null,
  amount           numeric(10,2) not null default 0,
  payment_method   text not null default 'efectivo'
                     check (payment_method in
                       ('efectivo','tarjeta','transferencia','voucher','saldo','online')),
  channel          text not null default 'in_person'
                     check (channel in ('web','in_person')),
  concept          text,
  payment_date     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

comment on table public.payments is 'Pagos polimórficos: reference_id apunta a enrollment/rental/booking/bono/order/user según reservation_type';

create index if not exists idx_payments_reference    on public.payments(reservation_type, reference_id);
create index if not exists idx_payments_reference_id on public.payments(reference_id);
create index if not exists idx_payments_channel      on public.payments(channel, payment_date desc);

alter table public.payments enable row level security;
-- Políticas RLS en 0021_rls_policies.sql

-- 2. COUPONS (códigos de descuento) --------------------------
create table public.coupons (
  id                uuid primary key default uuid_generate_v4(),
  code              text not null unique,
  name              text not null,
  discount_type     text not null default 'percentage' check (discount_type in ('percentage','fixed')),
  discount_value    numeric(10,2) not null default 0,
  applies_to        text not null default 'all' check (applies_to in ('all','camps','classes','products','rentals')),
  activity_type     text,  -- NULL = todos, o uno de los 6 tipos Waya (grupal/privada/semiprivada/familiar/residente/kids)
  camp_id           uuid references public.surf_camps(id) on delete set null,
  min_amount        numeric(10,2) default 0,
  max_uses          int,   -- NULL = ilimitado
  used_count        int not null default 0,
  max_uses_per_user int default 1,
  starts_at         timestamptz,
  expires_at        timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.coupons is 'Códigos de descuento; lectura pública vía RPC get_coupon (no política SELECT abierta). Refer-a-friend -10% residente = fila coupons, no hardcode.';

create index if not exists idx_coupons_code   on public.coupons(code);
create index if not exists idx_coupons_active on public.coupons(active);

alter table public.coupons enable row level security;
-- Políticas RLS en 0021_rls_policies.sql (lectura pública ELIMINADA)

-- 3. DELETED_ITEMS (papelera / soft-delete) ------------------
-- En vez de borrar definitivamente, "Eliminar" archiva una instantánea
-- (fila + pagos + inscripciones) en snapshot y luego borra. Restaurar la reinserta.
create table public.deleted_items (
  id          uuid primary key default uuid_generate_v4(),
  entity_type text not null,           -- 'bono' | 'booking' (texto libre, sin CHECK duro)
  entity_id   uuid not null,
  label       text,                    -- texto para mostrar (cliente / título)
  snapshot    jsonb not null,          -- { row, payments[], enrollments[] }
  deleted_at  timestamptz not null default now(),
  deleted_by  uuid references auth.users(id),
  restored_at timestamptz
);

comment on table public.deleted_items is 'Papelera con snapshot para restaurar bonos/bookings eliminados';

create index if not exists idx_deleted_items_pending on public.deleted_items(restored_at, deleted_at desc);

alter table public.deleted_items enable row level security;
-- Políticas RLS en 0021_rls_policies.sql

select pg_notify('pgrst', 'reload schema');
