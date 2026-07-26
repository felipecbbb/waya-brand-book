-- ============================================================
-- 0008_family_members.sql
-- Propósito: Crear public.family_members (sub-perfiles familiares) en su versión
-- FINAL fusionada, con last_name, campos de salud/talla y el índice único
-- anti-duplicados por nombre+apellido por usuario.
-- Portado literalmente de Entreolas (migration-reservation-system.sql +
-- migration-pricing-sync.sql (last_name) + migration-profile-health-fields.sql +
-- migration-unique-anti-duplicados.sql), tomando la forma final de cada columna.
-- ⚠ WAYA: el CHECK de level incluye 'todos' (Entreolas no lo tenía).
-- Las POLÍTICAS RLS viven centralizadas en 0021_rls_policies.sql; aquí solo
-- se activa row level security.
-- Requiere: 0001 (uuid-ossp), 0002 (profiles).
-- ============================================================

create table public.family_members (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  full_name      text not null,
  last_name      text default '',
  birth_date     date,
  -- ⚠ WAYA: se añade 'todos' al CHECK de nivel (Entreolas: 3 buckets)
  level          text check (level in ('principiante','intermedio','avanzado','todos')),
  -- migration-profile-health-fields.sql
  can_swim       boolean,
  has_injury     boolean default false,
  injury_detail  text,
  wetsuit_size   text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.family_members is 'Sub-perfiles familiares gestionados por el usuario principal';

create index idx_family_members_user on public.family_members(user_id);

-- Único anti-duplicados: nombre+apellidos por cliente (ignorando mayúsculas)
create unique index uq_family_members_name_per_user
  on public.family_members (user_id, lower(full_name), coalesce(lower(last_name), ''));

alter table public.family_members enable row level security;
