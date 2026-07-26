-- ============================================================
-- 0012_class_holds.sql
-- Propósito: Tabla public.class_holds — plazas apartadas temporalmente
-- (caducan a los 10 min) durante la preselección de clases desde la página
-- de packs. Una fila = una plaza reservada. Sin login: se identifica por
-- cart_token. Portado LITERALMENTE de Entreolas (migration-class-holds).
--
-- ⚠ RLS ACTIVA, CERO POLÍTICAS: la tabla solo es accesible vía las funciones
-- SECURITY DEFINER (create_hold / release_holds / release_class_holds /
-- fetch_class_availability), definidas en 0018_rpc_holds.sql.
-- ============================================================

create table public.class_holds (
  id          uuid primary key default uuid_generate_v4(),
  class_id    uuid not null references public.surf_classes(id) on delete cascade,
  cart_token  text not null,
  held_until  timestamptz not null,
  created_at  timestamptz not null default now()
);

comment on table public.class_holds is 'Plazas apartadas temporalmente durante la preselección de clases (caducan a los 10 min). Una fila por plaza.';

create index idx_class_holds_class on public.class_holds(class_id);
create index idx_class_holds_token on public.class_holds(cart_token);
create index idx_class_holds_until on public.class_holds(held_until);

-- RLS activa sin políticas → solo accesible vía las funciones SECURITY DEFINER.
alter table public.class_holds enable row level security;
