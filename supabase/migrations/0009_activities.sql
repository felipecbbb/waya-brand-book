-- ============================================================
-- 0009_activities.sql
-- Propósito: Crear el sistema de actividades en su versión FINAL fusionada:
-- public.activities (catálogo por tipo de clase) + activity_packs (bonos de
-- catálogo) + activity_photos / activity_testimonials / activity_faqs (contenido).
-- Portado literalmente de Entreolas (migration-activities.sql +
-- migration-activity-packs-public.sql (public + drop unique) +
-- migration-pricing-sync.sql (extra_class_price)), tomando la forma final.
-- ⚠ WAYA: type_key con el enum transversal de 6 tipos; ubicacion default
-- 'Las Canteras'; color default '#1a1a1a'; NUEVO per_person boolean.
-- activity_packs NO lleva unique(activity_id, sessions) (eliminado en Entreolas:
-- permite pack familiar único + packs duplicados).
-- NO se hace seed aquí: el seed de Waya vive en 0023_seed_waya.sql.
-- Las POLÍTICAS RLS viven centralizadas en 0021_rls_policies.sql; aquí solo
-- se activa row level security.
-- Requiere: 0001 (uuid-ossp).
-- ============================================================

-- 1. ACTIVITIES (catálogo por tipo de clase)
-- ============================================================
create table public.activities (
  id                    uuid primary key default uuid_generate_v4(),
  slug                  text not null unique,
  -- ⚠ WAYA: enum transversal (= surf_classes.type = bonos.class_type)
  type_key              text not null unique
                          check (type_key in ('grupal','privada','semiprivada','familiar','residente','kids')),
  nombre                text not null,
  nombre_interno        text,
  descripcion           text,
  hero_image            text,
  hero_title            text,
  hero_subtitle         text,
  hero_kicker           text,
  pre_section_kicker    text,
  pre_section_title     text,
  pre_section_lead      text,
  whats_included        jsonb default '[]'::jsonb,
  whats_included_title  text default '¿Qué incluye cada clase?',
  ideal_for             jsonb default '[]'::jsonb,
  ideal_for_title       text default 'Ideal para',
  duracion              int,
  capacidad_max         int,
  ubicacion             text default 'Las Canteras',   -- ⚠ WAYA (era 'Playa de Roche')
  color                 text default '#1a1a1a',        -- ⚠ WAYA (era '#0f2f39')
  deposit               numeric(8,2) not null default 15,  -- TODO Waya: revisar anticipo (15€) en admin
  pack_validity         int not null default 180,          -- TODO Waya: revisar vigencia (días) en admin
  extra_class_price     numeric default 0,
  -- ⚠ WAYA (nuevo): precio por persona (true en semiprivada)
  per_person            boolean not null default false,
  meta_title            text,
  meta_description      text,
  activo                boolean not null default true,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.activities is 'Catálogo de actividades por tipo de clase (enum de 6 tipos Waya)';

alter table public.activities enable row level security;

-- 2. ACTIVITY PACKS (bonos de catálogo) — SIN unique(activity_id, sessions)
-- ============================================================
create table public.activity_packs (
  id           uuid primary key default uuid_generate_v4(),
  activity_id  uuid not null references public.activities(id) on delete cascade,
  sessions     int not null check (sessions > 0),
  price        numeric(8,2) not null,
  featured     boolean not null default false,
  public       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.activity_packs is 'Packs/bonos de catálogo por actividad (sin unique: permite pack único familiar y packs duplicados)';

alter table public.activity_packs enable row level security;

-- 3. ACTIVITY PHOTOS
-- ============================================================
create table public.activity_photos (
  id           uuid primary key default uuid_generate_v4(),
  activity_id  uuid not null references public.activities(id) on delete cascade,
  url          text not null,
  alt_text     text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.activity_photos enable row level security;

-- 4. ACTIVITY TESTIMONIALS
-- ============================================================
create table public.activity_testimonials (
  id           uuid primary key default uuid_generate_v4(),
  activity_id  uuid not null references public.activities(id) on delete cascade,
  author_name  text not null,
  quote        text not null,
  stars        int not null default 5 check (stars >= 1 and stars <= 5),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.activity_testimonials enable row level security;

-- 5. ACTIVITY FAQS
-- ============================================================
create table public.activity_faqs (
  id           uuid primary key default uuid_generate_v4(),
  activity_id  uuid not null references public.activities(id) on delete cascade,
  question     text not null,
  answer       text not null,
  col_index    int not null default 0 check (col_index in (0, 1)),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.activity_faqs enable row level security;

-- 6. ÍNDICES
-- ============================================================
create index idx_activity_packs_aid on public.activity_packs(activity_id);
create index idx_activity_photos_aid on public.activity_photos(activity_id);
create index idx_activity_test_aid on public.activity_testimonials(activity_id);
create index idx_activity_faqs_aid on public.activity_faqs(activity_id);
