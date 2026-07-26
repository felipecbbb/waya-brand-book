-- ============================================================
-- 0010_bonos.sql
-- Propósito: Tabla public.bonos — packs de créditos de clases comprados por
-- los usuarios. Versión FINAL consolidada portada de Entreolas
-- (migration-reservation-system + activities[activity_id] + pricing-sync[total_paid]
--  + bono-custom-total[custom_total] + audit-fixes[índices]).
-- ⚠ WAYA: class_type con CHECK de los 6 tipos de clase transversales
-- (grupal, privada, semiprivada, familiar, residente, kids).
-- El webhook fija expires_at = now() + activity.pack_validity días.
-- used_credits/status se materializan por trigger (ver 0016).
-- ============================================================

create table public.bonos (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  order_id       uuid references public.orders(id) on delete set null,
  activity_id    uuid references public.activities(id),
  class_type     text not null
                   check (class_type in ('grupal','privada','semiprivada','familiar','residente','kids')),
  total_credits  int not null check (total_credits > 0),
  used_credits   int not null default 0 check (used_credits >= 0),
  status         text not null default 'active'
                   check (status in ('active','expired','exhausted','cancelled')),
  expires_at     timestamptz not null,
  total_paid     numeric(10,2) default 0,
  custom_total   numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.bonos is 'Packs de créditos de clases comprados por los usuarios';
comment on column public.bonos.custom_total is
  'Precio total del bono fijado a mano (descuento/precio a medida). Si NULL, se usa el precio del catálogo por nº de créditos.';
comment on column public.bonos.expires_at is
  'Caducidad del bono; el webhook/creación fija = now() + activity.pack_validity días.';

-- Índices
create index idx_bonos_user           on public.bonos(user_id);
create index idx_bonos_status         on public.bonos(status);
create index idx_bonos_user_id_status on public.bonos(user_id, status);
create index idx_bonos_activity_id    on public.bonos(activity_id);

-- RLS (política de INSERT de cliente ELIMINADA: los bonos solo se crean vía
-- webhook/staff — ver contrato §0021). Lectura del propio bono + gestión admin.
alter table public.bonos enable row level security;

drop policy if exists "Users read own bonos" on public.bonos;
create policy "Users read own bonos"
  on public.bonos for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins manage all bonos" on public.bonos;
create policy "Admins manage all bonos"
  on public.bonos for all
  using (public.is_admin());
