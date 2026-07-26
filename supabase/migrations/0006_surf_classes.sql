-- ============================================================
-- 0006_surf_classes.sql
-- Propósito: Crear public.surf_classes (clases de surf programadas) en su
-- versión FINAL fusionada, con el enum transversal de 6 tipos WAYA, niveles,
-- publicación, contador materializado, notas y audiencia.
-- Portado literalmente de Entreolas (schema.sql + migration-reservation-system.sql
-- ALTERs + migration-class-notes.sql + migration-client-updates.sql), tomando
-- la forma final de cada columna. ⚠ WAYA marca desviaciones.
-- Las POLÍTICAS RLS viven centralizadas en 0021_rls_policies.sql; aquí solo
-- se activa row level security.
-- Requiere: 0001 (uuid-ossp).
-- ============================================================

create table public.surf_classes (
  id             uuid primary key default uuid_generate_v4(),
  -- ⚠ WAYA: enum transversal de tipo de clase (= activities.type_key = bonos.class_type)
  type           text not null
                   check (type in ('grupal','privada','semiprivada','familiar','residente','kids')),
  title          text not null,
  date           date not null,
  time_start     time not null,
  time_end       time not null,
  max_students   int not null default 8,
  price          numeric(8,2) not null,
  instructor     text,
  location       text default 'Las Canteras',  -- ⚠ WAYA (era 'Playa de Roche')
  status         text not null default 'scheduled'
                   check (status in ('scheduled','completed','cancelled')),
  level          text default 'todos'
                   check (level in ('principiante','intermedio','avanzado','todos')),
  published      boolean not null default false,
  enrolled_count int not null default 0,   -- materializado por trigger (0016)
  notes          text,
  audience       text,
  created_at     timestamptz not null default now()
);

comment on table public.surf_classes is 'Clases de surf programadas (enum de 6 tipos Waya)';

create index idx_surf_classes_date on public.surf_classes(date);

alter table public.surf_classes enable row level security;
