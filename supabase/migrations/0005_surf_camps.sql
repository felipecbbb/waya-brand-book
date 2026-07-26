-- ============================================================
-- 0005_surf_camps.sql
-- Propósito: Crear la tabla LATENTE public.surf_camps (ediciones de Surf Camp)
-- y sus hijas de contenido (camp_photos, camp_testimonials, camp_faqs).
-- Portado literalmente de Entreolas (schema.sql + migration-hero-tags.sql +
-- migration-camp-content.sql — versión FINAL fusionada de cada objeto).
-- LATENTE: se crea pero NO se puebla en el seed (0023). Sin UI en Waya v1.
-- Las POLÍTICAS RLS viven centralizadas en 0021_rls_policies.sql; aquí solo
-- se activa row level security.
-- Requiere: 0001 (uuid-ossp) y 0003 (is_admin, para las políticas de 0021).
-- ============================================================

-- 1. SURF CAMPS (ediciones) — versión FINAL con hero_tags + contenido de camp
-- ============================================================
create table public.surf_camps (
  id                   uuid primary key default uuid_generate_v4(),
  title                text not null,
  slug                 text not null unique,
  kicker               text,
  date_start           date not null,
  date_end             date not null,
  duration_days        int generated always as (date_end - date_start + 1) stored,
  price                numeric(8,2) not null,
  original_price       numeric(8,2),
  deposit              numeric(8,2) not null default 180,
  max_spots            int not null default 17,
  spots_taken          int not null default 0,
  status               text not null default 'open'
                         check (status in ('open','full','closed','coming_soon')),
  hero_image           text,
  description          text,
  cart_id              int,
  -- migration-hero-tags.sql
  hero_tags            text[],
  -- migration-camp-content.sql
  sold_out             boolean default false,
  hero_kicker          text,
  hero_title           text,
  hero_subtitle        text,
  color                text default '#1a1a1a',  -- ⚠ WAYA (era '#0f2f39')
  whats_included       text[],
  whats_included_title text,
  ideal_for            text[],
  ideal_for_title      text,
  meta_title           text,
  meta_description     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.surf_camps is 'Cada edición de Surf Camp (LATENTE en Waya v1)';

alter table public.surf_camps enable row level security;

-- 2. CAMP PHOTOS
-- ============================================================
create table public.camp_photos (
  id          uuid primary key default uuid_generate_v4(),
  camp_id     uuid not null references public.surf_camps(id) on delete cascade,
  url         text not null,
  alt_text    text,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

create index idx_camp_photos_camp_id on public.camp_photos(camp_id);

alter table public.camp_photos enable row level security;

-- 3. CAMP TESTIMONIALS
-- ============================================================
create table public.camp_testimonials (
  id           uuid primary key default uuid_generate_v4(),
  camp_id      uuid not null references public.surf_camps(id) on delete cascade,
  author_name  text not null,
  quote        text not null,
  stars        int default 5,
  sort_order   int default 0,
  created_at   timestamptz default now()
);

create index idx_camp_testimonials_camp_id on public.camp_testimonials(camp_id);

alter table public.camp_testimonials enable row level security;

-- 4. CAMP FAQS
-- ============================================================
create table public.camp_faqs (
  id          uuid primary key default uuid_generate_v4(),
  camp_id     uuid not null references public.surf_camps(id) on delete cascade,
  question    text not null,
  answer      text not null,
  col_index   int default 0,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

create index idx_camp_faqs_camp_id on public.camp_faqs(camp_id);

alter table public.camp_faqs enable row level security;
