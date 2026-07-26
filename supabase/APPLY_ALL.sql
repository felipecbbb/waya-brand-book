-- ============================================================
-- Waya · Esquema de reservas COMPLETO (23 migraciones 0001-0023)
-- Pegar en Supabase → SQL Editor → Run. Transaccional: si algo
-- falla, revierte todo (no deja estado a medias). Convive con el blog.
-- ============================================================
begin;

-- ▼▼▼ 0001_extensions.sql ▼▼▼
-- ============================================================
-- 0001_extensions.sql
-- Propósito: extensiones Postgres necesarias para el esquema de reservas WAYA.
--   - uuid-ossp  → uuid_generate_v4() (PK por defecto de la mayoría de tablas).
--   - pgcrypto   → gen_random_uuid()  (PK de payments e inventory_units).
-- Idempotente (create extension if not exists).
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ▼▼▼ 0002_profiles.sql ▼▼▼
-- ============================================================
-- 0002_profiles.sql
-- Propósito: tabla public.profiles (extiende auth.users) con TODOS los campos
--   finales de salud/dirección/legales, + handle_new_user() (versión FINAL que
--   persiste todo el metadata del signUp) + trigger on_auth_user_created.
--   RLS activada aquí; las políticas viven en 0004.
-- Fuente Entreolas (versión final de cada objeto): schema.sql, migration-profile-*,
--   migration-client-updates, migration-pricing-sync, migration-audit-fixes,
--   migration-must-change-password, migration-signup-full-profile,
--   migration-unique-anti-duplicados, migration-security-hardening.
-- ⚠ WAYA: role check incluye 'encargado' desde el inicio.
-- ============================================================

-- 1. Tabla profiles (campos finales consolidados)
-- ------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  full_name            text not null,
  last_name            text default '',
  phone                text,
  email                text,
  role                 text not null default 'client'
                         check (role in ('admin','encargado','client')),
  avatar_url           text,
  allowed_sections     jsonb,
  birth_date           date,
  address              text,
  city                 text,
  postal_code          text,
  can_swim             boolean,
  has_injury           boolean default false,
  injury_detail        text,
  wetsuit_size         text,
  level                text,
  credit_balance       numeric(10,2) default 0
                         constraint credit_balance_non_negative check (credit_balance >= 0),
  terms_accepted_at    timestamptz,
  waiver_accepted_at   timestamptz,
  must_change_password boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.profiles is 'Datos extra de cada usuario (admin, encargado o cliente)';

-- Activar RLS (políticas en 0004)
alter table public.profiles enable row level security;

-- 2. Índices
-- ------------------------------------------------------------
create index if not exists idx_profiles_role on public.profiles(role);

-- Email único (ignorando mayúsculas; solo cuando hay email)
create unique index if not exists uq_profiles_email_lower
  on public.profiles (lower(email))
  where email is not null and email <> '';

-- 3. handle_new_user() — persiste todo el metadata del signUp al crear el perfil
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
declare m jsonb := new.raw_user_meta_data;
begin
  insert into public.profiles (
    id, full_name, last_name, phone, email, birth_date, address, city,
    postal_code, level, wetsuit_size, can_swim, has_injury, injury_detail,
    terms_accepted_at, waiver_accepted_at
  ) values (
    new.id,
    coalesce(m->>'full_name', ''),
    nullif(m->>'last_name', ''),
    nullif(m->>'phone', ''),
    new.email,
    nullif(m->>'birth_date', '')::date,
    nullif(m->>'address', ''),
    nullif(m->>'city', ''),
    nullif(m->>'postal_code', ''),
    nullif(m->>'level', ''),
    nullif(m->>'wetsuit_size', ''),
    nullif(m->>'can_swim', '')::boolean,
    coalesce(nullif(m->>'has_injury', '')::boolean, false),
    nullif(m->>'injury_detail', ''),
    case when m->>'terms_accepted' = 'true' then now() else null end,
    case when m->>'terms_accepted' = 'true' then now() else null end
  );
  return new;
end;
$function$;

-- Hardening: función SOLO trigger, no invocable vía /rpc
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- 4. Trigger de alta de usuario
-- ------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ▼▼▼ 0003_auth_helpers.sql ▼▼▼
-- ============================================================
-- 0003_auth_helpers.sql
-- Propósito: funciones auxiliares de autorización usadas por TODAS las políticas
--   RLS y RPCs. Crear ANTES de cualquier política que dependa de ellas.
--   - is_admin()          → staff operativo (role in admin|encargado). ~40 políticas.
--   - is_strict_admin()   → solo role='admin' (cupones, borrado usuario, cambio rol).
--   - enc_can(text[])     → admin siempre; encargado si allowed_sections NULL o ?| p_sections.
-- Fuente Entreolas (versión final): migration-role-encargado.sql,
--   migration-encargado-section-rls.sql, migration-security-hardening.sql.
-- ============================================================

-- is_admin(): staff operativo (admin OR encargado). El nombre se mantiene para
-- que las políticas RLS existentes funcionen sin tocarse.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'encargado')
  );
$$;

-- is_strict_admin(): solo role='admin' (operaciones sensibles).
create or replace function public.is_strict_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- enc_can(secciones[]): admin siempre true; encargado true si allowed_sections
-- es NULL (todas) o contiene alguna de las secciones pedidas (operador ?|).
create or replace function public.enc_can(p_sections text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and ( role = 'admin'
            or (role = 'encargado'
                and (allowed_sections is null or allowed_sections ?| p_sections)) )
  );
$function$;

grant execute on function public.enc_can(text[]) to anon, authenticated;

-- ▼▼▼ 0004_profiles_protect_rls.sql ▼▼▼
-- ============================================================
-- 0004_profiles_protect_rls.sql
-- Propósito: blindaje de privilegios de profiles + políticas RLS de profiles.
--   - protect_profile_privileges() + trigger trg_protect_profile_privileges:
--     bloquea cambios de role/allowed_sections salvo admin estricto o service_role
--     (auth.uid() IS NULL). Defensa a nivel de fila frente a la policy FOR ALL.
--   - Políticas RLS de profiles (versiones FINALES).
-- Fuente Entreolas (versión final): migration-protect-profile-privileges.sql,
--   migration-role-encargado.sql, schema.sql.
-- Depende de: 0002 (tabla profiles), 0003 (is_admin/is_strict_admin).
-- Idempotente: drop policy/trigger if exists antes de crear.
-- ============================================================

-- 1. Trigger de protección de rol/permisos
-- ------------------------------------------------------------
create or replace function public.protect_profile_privileges()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
begin
  if (new.role is distinct from old.role
      or new.allowed_sections is distinct from old.allowed_sections)
     and auth.uid() is not null
     and not public.is_strict_admin() then
    raise exception 'No autorizado a cambiar rol o permisos';
  end if;
  return new;
end;
$function$;

-- Hardening: función SOLO trigger, no invocable vía /rpc
revoke execute on function public.protect_profile_privileges() from anon, authenticated, public;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- 2. Políticas RLS de profiles (versiones finales)
-- ------------------------------------------------------------

-- Lectura del propio perfil (o staff)
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

-- Update del propio perfil, sin poder auto-ascender el rol ni cambiar secciones
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (role = (select p.role from public.profiles p where p.id = auth.uid()) or public.is_strict_admin())
    and (allowed_sections is not distinct from (select p.allowed_sections from public.profiles p where p.id = auth.uid()) or public.is_strict_admin())
  );

-- Gestión total por staff (el trigger sigue blindando role/allowed_sections)
drop policy if exists "Admins manage all profiles" on public.profiles;
create policy "Admins manage all profiles"
  on public.profiles for all
  using (public.is_admin());

-- ▼▼▼ 0005_surf_camps.sql ▼▼▼
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

-- ▼▼▼ 0006_surf_classes.sql ▼▼▼
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

-- ▼▼▼ 0007_products_orders.sql ▼▼▼
-- ============================================================
-- 0007_products_orders.sql
-- Propósito: Crear public.products, public.orders y public.order_items en su
-- versión FINAL fusionada. products/order_items quedan LATENTES (sin UI de
-- tienda en Waya v1); orders es el BACKBONE del checkout y sí se usa.
-- Portado literalmente de Entreolas (schema.sql + migration-products-variants.sql
-- + migration-guest-checkout.sql + migration-order-invoice-fields.sql),
-- tomando la forma final de cada columna. ⚠ WAYA marca desviaciones.
-- Las POLÍTICAS RLS viven centralizadas en 0021_rls_policies.sql (incluidas las
-- de guest insert); aquí solo se activa row level security.
-- Requiere: 0001 (uuid-ossp), 0002 (profiles).
-- ============================================================

-- 1. PRODUCTS (tienda) — con variantes (color/talla/galería) + sizes_stock atómico
-- ============================================================
create table public.products (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  slug         text not null unique,
  description  text,
  price        numeric(8,2) not null,
  image_url    text,
  stock        int not null default 0,
  category     text,
  status       text not null default 'active'
                 check (status in ('active','draft','out_of_stock')),
  -- migration-products-variants.sql
  colors       text,                              -- CSV: 'Negro, Blanco'
  sizes        text,                              -- CSV (compat): 'S, M, L'
  gallery      text,                              -- CSV de URLs de imagen
  sizes_stock  jsonb not null default '[]'::jsonb, -- [{size,stock}] o [{color,size,stock}] — fuente atómica de stock
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.products is 'Productos de la tienda online (LATENTE en Waya v1)';

alter table public.products enable row level security;

-- 2. ORDERS (pedidos) — backbone del checkout, con guest + factura
-- ============================================================
create table public.orders (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid references public.profiles(id) on delete cascade, -- ⚠ nullable (guest checkout)
  status            text not null default 'pending'
                      check (status in ('pending','paid','shipped','delivered','cancelled')),
  total             numeric(8,2) not null,
  shipping_address  text,
  notes             text,  -- el webhook embebe '__cart__:…|__customer__:…' — no meter '|' en texto libre
  -- migration-guest-checkout.sql
  guest_email       text,
  guest_name        text,
  guest_phone       text,
  -- migration-order-invoice-fields.sql
  wants_invoice     boolean not null default false,
  invoice_name      text,
  invoice_tax_id    text,
  invoice_address   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.orders is 'Pedidos (backbone del checkout; soporta guest)';
comment on column public.orders.wants_invoice   is 'El cliente solicitó factura en el checkout';
comment on column public.orders.invoice_name    is 'Razón social / nombre fiscal para la factura';
comment on column public.orders.invoice_tax_id  is 'NIF/CIF para la factura';
comment on column public.orders.invoice_address is 'Dirección fiscal para la factura';

alter table public.orders enable row level security;

-- 3. ORDER ITEMS (líneas de pedido) — con variante (color · talla)
-- ============================================================
create table public.order_items (
  id          uuid primary key default uuid_generate_v4(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete restrict,
  quantity    int not null default 1 check (quantity > 0),
  unit_price  numeric(8,2) not null,
  variant     text,   -- 'Negro · Talla M'
  created_at  timestamptz not null default now()
);

comment on table public.order_items is 'Líneas de cada pedido (LATENTE en Waya v1)';

alter table public.order_items enable row level security;

-- ▼▼▼ 0008_family_members.sql ▼▼▼
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

-- ▼▼▼ 0009_activities.sql ▼▼▼
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

-- ▼▼▼ 0010_bonos.sql ▼▼▼
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

-- ▼▼▼ 0011_class_enrollments.sql ▼▼▼
-- ============================================================
-- 0011_class_enrollments.sql
-- Propósito: Tabla public.class_enrollments — inscripciones de usuarios/
-- familiares a clases programadas. Versión FINAL consolidada portada de
-- Entreolas (migration-reservation-system + admin-bookings[user_id/bono_id
-- nullable, guest_name] + attendance-column[attendance + CHECK 4 estados de pago]
-- + client-updates[cancelled_by] + audit-fixes[índices] +
-- enrollment-unique-titular[índice único parcial con coalesce]).
--
-- Notas de la versión final:
--   · user_id y bono_id son NULLABLE (walk-ins / reservas creadas por admin).
--   · attendance es INDEPENDIENTE del pago: null=sin marcar, true=asistió,
--     false=no se presentó. El color de pago se rige SOLO por status.
--   · status guarda solo pago/ciclo de vida: confirmed/cancelled/paid/partial.
-- enrolled_count (surf_classes) y used_credits (bonos) se materializan por
-- triggers definidos en 0016.
-- ============================================================

create table public.class_enrollments (
  id                uuid primary key default uuid_generate_v4(),
  class_id          uuid not null references public.surf_classes(id) on delete cascade,
  user_id           uuid references public.profiles(id) on delete cascade,
  family_member_id  uuid references public.family_members(id) on delete set null,
  bono_id           uuid references public.bonos(id) on delete cascade,
  guest_name        text,
  status            text not null default 'confirmed'
                      check (status in ('confirmed','cancelled','paid','partial')),
  attendance        boolean,
  cancelled_by      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.class_enrollments is 'Inscripciones de usuarios/familiares a clases programadas';
comment on column public.class_enrollments.attendance is
  'Asistencia a la clase, independiente del pago: null=sin marcar, true=asistió, false=no se presentó';

-- Índices
create index idx_enrollments_class            on public.class_enrollments(class_id);
create index idx_enrollments_user             on public.class_enrollments(user_id);
create index idx_enrollments_bono             on public.class_enrollments(bono_id);
create index idx_class_enrollments_status     on public.class_enrollments(status);
create index idx_class_enrollments_class_id   on public.class_enrollments(class_id);
create index idx_class_enrollments_user_id    on public.class_enrollments(user_id);

-- Índice único parcial (versión final "enrollment-unique-titular"):
-- un mismo titular/familiar no puede inscribirse dos veces en la misma clase
-- salvo que la inscripción previa esté cancelada. El coalesce cierra el hueco
-- de los NULL (Postgres trata los NULL como distintos) para el titular.
drop index if exists idx_unique_enrollment;
create unique index idx_unique_enrollment
  on public.class_enrollments
    (class_id, user_id, coalesce(family_member_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'cancelled';

-- RLS
alter table public.class_enrollments enable row level security;

drop policy if exists "Users read own enrollments" on public.class_enrollments;
create policy "Users read own enrollments"
  on public.class_enrollments for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins manage all enrollments" on public.class_enrollments;
create policy "Admins manage all enrollments"
  on public.class_enrollments for all
  using (public.is_admin());

drop policy if exists "Admins insert enrollments" on public.class_enrollments;
create policy "Admins insert enrollments"
  on public.class_enrollments for insert
  with check (public.is_admin());

-- ▼▼▼ 0012_class_holds.sql ▼▼▼
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

-- ▼▼▼ 0013_bookings.sql ▼▼▼
-- ============================================================
-- 0013_bookings.sql
-- Propósito: Tabla public.bookings — reservas de Surf Camp. LATENTE: se crea
-- como backbone del checkout de camps pero sin UI en Waya. Versión FINAL
-- consolidada portada de Entreolas (schema.sql[bookings] +
-- guest-checkout[user_id nullable + guest cols + política de inserción guest]).
-- El trigger update_spots_on_booking (surf_camps.spots_taken) se define en 0016.
--
-- ⚠ WAYA: user_id NULLABLE (reservas de invitado). Estados de booking:
-- pending / deposit_paid / fully_paid / cancelled / refunded.
-- ============================================================

create table public.bookings (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references public.profiles(id) on delete cascade,
  camp_id         uuid not null references public.surf_camps(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending','deposit_paid','fully_paid','cancelled','refunded')),
  deposit_amount  numeric(8,2),
  total_amount    numeric(8,2) not null,
  payment_method  text,
  notes           text,
  guest_email     text,
  guest_name      text,
  guest_phone     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.bookings is 'Reservas de Surf Camp (latente: backbone de checkout sin UI en Waya)';

-- Índices
create index idx_bookings_user   on public.bookings(user_id);
create index idx_bookings_camp   on public.bookings(camp_id);
create index idx_bookings_status on public.bookings(status);

-- RLS
alter table public.bookings enable row level security;

drop policy if exists "Users read own bookings" on public.bookings;
create policy "Users read own bookings"
  on public.bookings for select
  using (user_id = auth.uid() or public.is_admin());

-- Inserción con soporte de invitado (guest checkout): permite fila sin user_id
-- siempre que se aporte guest_email.
drop policy if exists "Allow guest booking insert" on public.bookings;
create policy "Allow guest booking insert"
  on public.bookings for insert
  with check (user_id is not null or guest_email is not null);

drop policy if exists "Admins manage all bookings" on public.bookings;
create policy "Admins manage all bookings"
  on public.bookings for all
  using (public.is_admin());

-- ▼▼▼ 0014_rentals.sql ▼▼▼
-- ============================================================
-- 0014_rentals.sql
-- Propósito: catálogo y logística de alquiler de material (WAYA).
--   rental_equipment  → catálogo (tipos + precios por duración)
--   inventory_units   → stock físico numerado (cada unidad real)
--   equipment_reservations → reservas de material por fecha
-- Orden por dependencias de FK:
--   rental_equipment  →  inventory_units  →  equipment_reservations
-- Portado LITERALMENTE de Entreolas (versión final: rental-equipment +
-- inventory-units + rental-units-wiring), ajustado al CONTRATO WAYA:
--   · inventory_units.category = ('neopreno','licra','tabla')
--   · SIN seed aquí (el seed vive en 0023).
--   · RLS habilitada; las POLÍTICAS viven en 0021_rls_policies.sql.
--   · Los RPC de alquiler (get_rental_stock, assign_rental_unit) viven en 0019.
-- ============================================================

-- 1. RENTAL EQUIPMENT (catálogo) -----------------------------
create table public.rental_equipment (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  type        text not null default 'basico' check (type in ('basico','con_talla')),
  description text,
  image_url   text,
  pricing     jsonb not null default '{}'::jsonb,   -- claves 1h/2h/1d/1w; Waya usa 1d
  deposit     numeric(8,2) not null default 5,      -- TODO Waya: fianza de alquiler editable en admin
  stock       int not null default 1 check (stock >= 0),
  sizes       jsonb default '[]'::jsonb,
  tags        text[] default '{}',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.rental_equipment is 'Catálogo de material disponible para alquiler';

create index if not exists idx_rental_equipment_active on public.rental_equipment(active);
create index if not exists idx_rental_equipment_slug   on public.rental_equipment(slug);

alter table public.rental_equipment enable row level security;
-- Políticas RLS en 0021_rls_policies.sql

-- 2. INVENTORY UNITS (stock físico numerado) -----------------
-- Cada neopreno/licra/tabla es una unidad física con su número y estado.
-- El catálogo (rental_equipment) define tipos y precios; esta tabla, las unidades.
create table public.inventory_units (
  id           uuid primary key default gen_random_uuid(),
  category     text not null check (category in ('neopreno','licra','tabla')),
  number       text,
  equipment_id uuid references public.rental_equipment(id) on delete set null,
  tipo         text,        -- neopreno: Corto/Largo
  grosor       text,        -- neopreno: 2.2mm, 3.2mm…
  talla        text,        -- neopreno/licra: M, 10, 150…
  genero       text,        -- licra: Niño/Hombre/Mujer
  marca        text,
  pies         numeric,     -- tabla: largo en pies
  descripcion  text,
  estado       text not null default 'disponible'
                 check (estado in ('disponible','en_uso','reparacion','perdido','baja')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.inventory_units is 'Unidades físicas de material de alquiler (stock numerado)';

create index if not exists idx_inventory_units_category on public.inventory_units(category);
create index if not exists idx_inventory_units_estado   on public.inventory_units(estado);

alter table public.inventory_units enable row level security;
-- Políticas RLS en 0021_rls_policies.sql

grant select, insert, update, delete on public.inventory_units to authenticated;
grant all on public.inventory_units to service_role;

-- 3. EQUIPMENT RESERVATIONS (reservas por fecha) -------------
-- assigned_unit_id: unidad física concreta asignada (auto por web o por el admin).
create table public.equipment_reservations (
  id               uuid primary key default uuid_generate_v4(),
  equipment_id     uuid not null references public.rental_equipment(id) on delete cascade,
  user_id          uuid references public.profiles(id) on delete set null,
  assigned_unit_id uuid references public.inventory_units(id) on delete set null,
  guest_name       text,
  guest_email      text,
  guest_phone      text,
  date_start       date not null,
  date_end         date not null,
  duration_key     text not null,
  size             text,
  quantity         int not null default 1 check (quantity > 0),
  status           text not null default 'pending'
                     check (status in ('pending','confirmed','active','returned','cancelled')),
  total_amount     numeric(8,2) not null default 0,
  deposit_paid     numeric(8,2) not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.equipment_reservations is 'Reservas de alquiler de material';

create index if not exists idx_equip_reservations_equipment on public.equipment_reservations(equipment_id);
create index if not exists idx_equip_reservations_dates     on public.equipment_reservations(date_start, date_end);
create index if not exists idx_equip_reservations_user      on public.equipment_reservations(user_id);
create index if not exists idx_equip_reservations_status    on public.equipment_reservations(status);

alter table public.equipment_reservations enable row level security;
-- Políticas RLS en 0021_rls_policies.sql

select pg_notify('pgrst', 'reload schema');

-- ▼▼▼ 0015_payments_coupons_trash.sql ▼▼▼
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

-- ▼▼▼ 0016_business_triggers.sql ▼▼▼
-- ============================================================
-- 0016_business_triggers.sql
-- Propósito: versiones FINALES de las funciones-trigger de negocio y sus
-- triggers. Materializan contadores derivados:
--   * surf_classes.enrolled_count  <- update_enrolled_count()  (cuenta toda
--     inscripción NO cancelada; en un "move" recalcula clase vieja Y nueva).
--   * bonos.used_credits / status  <- update_bono_credits()    (cuenta toda
--     inscripción NO cancelada; status -> 'exhausted' si used>=total,
--     preserva 'cancelled'/'expired').
--   * surf_camps.spots_taken / status <- update_spots_on_booking() (ocupante =
--     status in ('deposit_paid','fully_paid'); simétrico INSERT/UPDATE/DELETE;
--     alterna 'full' <-> 'open').
-- Se crean LOS DOS triggers de class_enrollments (aforo de clase + créditos de
-- bono) además del de bookings. Las funciones-trigger no son invocables como RPC.
-- Portado literalmente de Entreolas (versión final de cada objeto).
-- ============================================================

-- ------------------------------------------------------------
-- 1) enrolled_count de la clase: contar inscripciones no canceladas.
--    En UPDATE con cambio de class_id recalcula la clase vieja y la nueva.
-- ------------------------------------------------------------
create or replace function public.update_enrolled_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    update public.surf_classes
    set enrolled_count = (
      select count(*) from public.class_enrollments
      where class_id = OLD.class_id and status <> 'cancelled'
    )
    where id = OLD.class_id;
    return OLD;

  elsif TG_OP = 'UPDATE' then
    update public.surf_classes
    set enrolled_count = (
      select count(*) from public.class_enrollments
      where class_id = NEW.class_id and status <> 'cancelled'
    )
    where id = NEW.class_id;

    if OLD.class_id is distinct from NEW.class_id then
      update public.surf_classes
      set enrolled_count = (
        select count(*) from public.class_enrollments
        where class_id = OLD.class_id and status <> 'cancelled'
      )
      where id = OLD.class_id;
    end if;
    return NEW;

  else -- INSERT
    update public.surf_classes
    set enrolled_count = (
      select count(*) from public.class_enrollments
      where class_id = NEW.class_id and status <> 'cancelled'
    )
    where id = NEW.class_id;
    return NEW;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 2) used_credits / status del bono: contar inscripciones no canceladas.
--    Preserva estados terminales 'cancelled'/'expired'.
-- ------------------------------------------------------------
create or replace function public.update_bono_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
begin
  if TG_OP = 'DELETE' then
    select count(*) into v_used from public.class_enrollments
    where bono_id = OLD.bono_id and status <> 'cancelled';
    update public.bonos
    set used_credits = v_used,
        status = case
          when status in ('cancelled','expired') then status
          when v_used >= total_credits then 'exhausted'
          else 'active'
        end,
        updated_at = now()
    where id = OLD.bono_id;
    return OLD;
  else
    select count(*) into v_used from public.class_enrollments
    where bono_id = NEW.bono_id and status <> 'cancelled';
    update public.bonos
    set used_credits = v_used,
        status = case
          when status in ('cancelled','expired') then status
          when v_used >= total_credits then 'exhausted'
          else 'active'
        end,
        updated_at = now()
    where id = NEW.bono_id;
    return NEW;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3) spots_taken / status del camp: simétrico y completo (INSERT/UPDATE/DELETE).
--    Ocupante = reserva en ('deposit_paid','fully_paid').
-- ------------------------------------------------------------
create or replace function public.update_spots_on_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_occ boolean := (TG_OP <> 'INSERT') and (OLD.status in ('deposit_paid','fully_paid'));
  v_new_occ boolean := (TG_OP <> 'DELETE') and (NEW.status in ('deposit_paid','fully_paid'));
  v_camp uuid := case when TG_OP = 'DELETE' then OLD.camp_id else NEW.camp_id end;
begin
  if v_camp is null then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if v_new_occ and not v_old_occ then
    update public.surf_camps
    set spots_taken = spots_taken + 1,
        status = case when status <> 'closed' and spots_taken + 1 >= max_spots then 'full' else status end
    where id = v_camp;
  elsif v_old_occ and not v_new_occ then
    update public.surf_camps
    set spots_taken = greatest(spots_taken - 1, 0),
        status = case when status = 'full' and greatest(spots_taken - 1, 0) < max_spots then 'open' else status end
    where id = v_camp;
  end if;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

-- ------------------------------------------------------------
-- 4) Triggers (idempotentes)
-- ------------------------------------------------------------
drop trigger if exists on_enrollment_change on public.class_enrollments;
create trigger on_enrollment_change
  after insert or update or delete on public.class_enrollments
  for each row execute function public.update_enrolled_count();

drop trigger if exists on_enrollment_bono_change on public.class_enrollments;
create trigger on_enrollment_bono_change
  after insert or update or delete on public.class_enrollments
  for each row execute function public.update_bono_credits();

drop trigger if exists on_booking_status_change on public.bookings;
create trigger on_booking_status_change
  after insert or update or delete on public.bookings
  for each row execute function public.update_spots_on_booking();

-- ------------------------------------------------------------
-- 5) Hardening: las funciones-trigger no deben ser invocables como RPC
-- ------------------------------------------------------------
revoke execute on function public.update_enrolled_count()  from anon, authenticated, public;
revoke execute on function public.update_bono_credits()    from anon, authenticated, public;
revoke execute on function public.update_spots_on_booking() from anon, authenticated, public;

select pg_notify('pgrst', 'reload schema');

-- ▼▼▼ 0017_rpc_booking.sql ▼▼▼
-- ============================================================
-- 0017_rpc_booking.sql
-- Propósito: RPCs de reserva de clases (versiones FINALES de Entreolas).
--   * book_class        - inscripción atómica del cliente; respeta holds del
--                         picker, valida bono (dueño/activo/no expirado/con
--                         crédito), clase publicada/no pasada, tipo bono=clase,
--                         family_member del caller. FOR UPDATE sobre bono y clase.
--   * cancel_enrollment - cancela inscripciones confirmed/paid/partial con
--                         antelación > 2h; el crédito vuelve al bono vía trigger.
--   * upgrade_bono      - amplía total_credits del propio bono (activo).
--   * enroll_from_webhook - inscripción atómica del webhook de Stripe (service
--                         role); revalida aforo dentro de la tx, on conflict do
--                         nothing, devuelve false y registra warning si inválido/lleno.
-- Todas SECURITY DEFINER, search_path=public, con sus grants/revokes.
-- ============================================================

-- ------------------------------------------------------------
-- book_class — inscripción atómica del cliente (respeta holds del picker)
-- ------------------------------------------------------------
create or replace function public.book_class(
  p_class_id uuid,
  p_bono_id uuid,
  p_family_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bono record;
  v_class record;
  v_member record;
  v_user_id uuid;
  v_enrollment_id uuid;
  v_holds int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'No autenticado'; end if;

  -- Lock bono
  select * into v_bono from public.bonos where id = p_bono_id for update;
  if v_bono is null then raise exception 'Bono no encontrado'; end if;
  if v_bono.user_id != v_user_id then raise exception 'Este bono no te pertenece'; end if;
  if v_bono.status != 'active' then raise exception 'Bono no activo (estado: %)', v_bono.status; end if;
  if v_bono.expires_at < now() then raise exception 'Bono expirado'; end if;
  if v_bono.used_credits >= v_bono.total_credits then raise exception 'Sin créditos disponibles en este bono'; end if;

  -- Lock class
  select * into v_class from public.surf_classes where id = p_class_id for update;
  if v_class is null then raise exception 'Clase no encontrada'; end if;
  if v_class.published is not true or v_class.status <> 'scheduled' then
    raise exception 'Clase no disponible';
  end if;

  -- Aforo = inscripciones confirmadas (materializadas) + holds activos
  select count(*) into v_holds from public.class_holds
  where class_id = p_class_id and held_until > now();
  if (v_class.enrolled_count + v_holds) >= v_class.max_students then raise exception 'Clase completa'; end if;

  if v_class.type != v_bono.class_type then
    raise exception 'El tipo de bono (%) no coincide con la clase (%)', v_bono.class_type, v_class.type;
  end if;
  if (v_class.date + v_class.time_start) < now() then raise exception 'Esta clase ya ha pasado'; end if;

  -- Verificar miembro familiar
  if p_family_member_id is not null then
    select * into v_member from public.family_members where id = p_family_member_id and user_id = v_user_id;
    if v_member is null then raise exception 'Miembro familiar no encontrado o no te pertenece'; end if;
  end if;

  insert into public.class_enrollments (class_id, user_id, family_member_id, bono_id, status)
  values (p_class_id, v_user_id, p_family_member_id, p_bono_id, 'confirmed')
  returning id into v_enrollment_id;

  return v_enrollment_id;
end;
$$;

revoke all on function public.book_class(uuid, uuid, uuid) from public, anon;
grant execute on function public.book_class(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- cancel_enrollment — cancela confirmed/paid/partial con antelación > 2h
-- ------------------------------------------------------------
create or replace function public.cancel_enrollment(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment record;
  v_class record;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'No autenticado'; end if;

  select * into v_enrollment from public.class_enrollments
  where id = p_enrollment_id for update;

  if v_enrollment is null then raise exception 'Inscripción no encontrada'; end if;
  if v_enrollment.user_id != v_user_id then raise exception 'Esta inscripción no te pertenece'; end if;
  if v_enrollment.status not in ('confirmed','paid','partial') then
    raise exception 'Esta inscripción no se puede cancelar';
  end if;

  select * into v_class from public.surf_classes where id = v_enrollment.class_id;
  if (v_class.date + v_class.time_start) < (now() + interval '2 hours') then
    raise exception 'No se puede cancelar con menos de 2 horas de antelación';
  end if;

  update public.class_enrollments
  set status = 'cancelled', updated_at = now()
  where id = p_enrollment_id;
end;
$$;

revoke all on function public.cancel_enrollment(uuid) from public, anon;
grant execute on function public.cancel_enrollment(uuid) to authenticated;

-- ------------------------------------------------------------
-- upgrade_bono — amplía total_credits del propio bono (activo)
-- ------------------------------------------------------------
create or replace function public.upgrade_bono(
  p_bono_id uuid,
  p_new_total_credits int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bono record;
begin
  select * into v_bono from public.bonos where id = p_bono_id for update;
  if not found then raise exception 'Bono no encontrado'; end if;

  if v_bono.user_id != auth.uid() then
    raise exception 'No tienes permiso para modificar este bono';
  end if;
  if v_bono.status != 'active' then
    raise exception 'Solo se pueden ampliar bonos activos';
  end if;
  if p_new_total_credits <= v_bono.total_credits then
    raise exception 'El nuevo número de sesiones debe ser mayor al actual (%)', v_bono.total_credits;
  end if;
  if p_new_total_credits <= v_bono.used_credits then
    raise exception 'El nuevo total no puede ser menor que las sesiones ya usadas (%)', v_bono.used_credits;
  end if;

  update public.bonos
  set total_credits = p_new_total_credits,
      updated_at = now()
  where id = p_bono_id;
end;
$$;

revoke all on function public.upgrade_bono(uuid, integer) from public, anon;
grant execute on function public.upgrade_bono(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- enroll_from_webhook — inscripción atómica del webhook (service_role ONLY)
-- Revalida aforo dentro de la tx; nunca lanza (return false + warning).
-- ------------------------------------------------------------
create or replace function public.enroll_from_webhook(
  p_class_id uuid,
  p_user_id uuid,
  p_family_member_id uuid,
  p_bono_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class record;
  v_active int;
begin
  select * into v_class from public.surf_classes where id = p_class_id for update;
  if v_class is null or v_class.published is not true or v_class.status <> 'scheduled' then
    raise warning 'enroll_from_webhook: clase % no válida (null/no publicada/no scheduled)', p_class_id;
    return false;
  end if;

  select count(*) into v_active from public.class_enrollments
    where class_id = p_class_id and status <> 'cancelled';
  if v_active >= v_class.max_students then
    raise warning 'enroll_from_webhook: clase % LLENA (%/%) — user %, no se inscribe', p_class_id, v_active, v_class.max_students, p_user_id;
    return false;
  end if;

  insert into public.class_enrollments (class_id, user_id, family_member_id, bono_id, status)
  values (p_class_id, p_user_id, p_family_member_id, p_bono_id, 'confirmed')
  on conflict do nothing;
  return true;
exception when others then
  raise warning 'enroll_from_webhook ERROR (clase %, user %, bono %): %', p_class_id, p_user_id, p_bono_id, sqlerrm;
  return false;
end;
$$;

revoke all on function public.enroll_from_webhook(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.enroll_from_webhook(uuid, uuid, uuid, uuid) to service_role;

select pg_notify('pgrst', 'reload schema');

-- ▼▼▼ 0018_rpc_holds.sql ▼▼▼
-- ============================================================
-- 0018_rpc_holds.sql
-- Propósito: RPCs de holds (plazas apartadas 10 min) y disponibilidad de clases.
-- La tabla public.class_holds tiene RLS activa SIN políticas: solo accesible
-- vía estas funciones SECURITY DEFINER.
--   * create_hold           - aparta p_qty plazas para un cart_token (10 min).
--                             Cada hold caduca por sí mismo (versión final: NO
--                             reextiende los demás holds del token). Aforo =
--                             max_students - enrolled_count - holds activos.
--   * release_class_holds   - libera las plazas de UNA clase para un token.
--   * release_holds         - libera TODAS las plazas de un token.
--   * fetch_class_availability - clases publicadas+scheduled de un día con
--                             holds_count/confirmed_count/spots_taken/spots_left.
-- Grants: anon + authenticated (el picker público las usa sin login).
-- Portado literalmente de Entreolas (versión final de cada objeto).
-- ============================================================

-- ------------------------------------------------------------
-- fetch_class_availability — disponibilidad real por día (confirmadas + holds)
-- ------------------------------------------------------------
create or replace function public.fetch_class_availability(
  p_date  date,
  p_type  text default null,
  p_level text default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(c) || jsonb_build_object(
    'holds_count', coalesce(h.cnt, 0),
    'confirmed_count', c.enrolled_count,
    'spots_taken', c.enrolled_count + coalesce(h.cnt, 0),
    'spots_left', greatest(c.max_students - c.enrolled_count - coalesce(h.cnt, 0), 0)
  )
  from public.surf_classes c
  left join lateral (
    select count(*) as cnt
    from public.class_holds ch
    where ch.class_id = c.id and ch.held_until > now()
  ) h on true
  where c.date = p_date
    and c.published = true
    and c.status = 'scheduled'
    and (p_type is null or c.type = p_type)
    and (p_level is null or p_level = 'todos' or c.level = p_level or c.level = 'todos')
  order by c.time_start;
$$;

-- ------------------------------------------------------------
-- create_hold — aparta p_qty plazas para un cart_token (caducan a los 10 min)
-- ------------------------------------------------------------
create or replace function public.create_hold(
  p_class_id   uuid,
  p_cart_token text,
  p_qty        int default 1
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class   public.surf_classes%rowtype;
  v_active  int;
  v_left    int;
  v_until   timestamptz := now() + interval '10 minutes';
begin
  if p_cart_token is null or length(p_cart_token) < 8 then
    raise exception 'Token de carrito inválido';
  end if;
  if p_qty < 1 then
    raise exception 'Cantidad inválida';
  end if;

  -- Lock de la clase para evitar carreras
  select * into v_class from public.surf_classes where id = p_class_id for update;
  if not found then raise exception 'Clase no encontrada'; end if;
  if v_class.published is not true or v_class.status <> 'scheduled' then
    raise exception 'Clase no disponible';
  end if;

  -- Plazas ocupadas = inscripciones confirmadas + holds activos (cualquier token)
  select count(*) into v_active from public.class_holds
  where class_id = p_class_id and held_until > now();

  v_left := v_class.max_students - v_class.enrolled_count - v_active;
  if v_left < p_qty then
    raise exception 'No quedan plazas suficientes (disponibles: %)', greatest(v_left, 0);
  end if;

  insert into public.class_holds (class_id, cart_token, held_until)
  select p_class_id, p_cart_token, v_until from generate_series(1, p_qty);

  return v_until;
end;
$$;

-- ------------------------------------------------------------
-- release_class_holds — libera las plazas de UNA clase para un token
-- ------------------------------------------------------------
create or replace function public.release_class_holds(
  p_class_id   uuid,
  p_cart_token text,
  p_qty        int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qty is null then
    delete from public.class_holds
    where cart_token = p_cart_token and class_id = p_class_id;
  else
    delete from public.class_holds
    where id in (
      select id from public.class_holds
      where cart_token = p_cart_token and class_id = p_class_id
      limit p_qty
    );
  end if;
end;
$$;

-- ------------------------------------------------------------
-- release_holds — libera TODAS las plazas de un token
-- ------------------------------------------------------------
create or replace function public.release_holds(p_cart_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.class_holds where cart_token = p_cart_token;
$$;

-- ------------------------------------------------------------
-- Grants: anon + authenticated
-- ------------------------------------------------------------
grant execute on function public.fetch_class_availability(date, text, text) to anon, authenticated;
grant execute on function public.create_hold(uuid, text, int)               to anon, authenticated;
grant execute on function public.release_class_holds(uuid, text, int)        to anon, authenticated;
grant execute on function public.release_holds(text)                         to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

-- ▼▼▼ 0019_rpc_commerce.sql ▼▼▼
-- ============================================================
-- 0019_rpc_commerce.sql
-- Propósito: RPCs de comercio (stock, alquiler, cupones) — versiones FINALES.
--   * decrement_product_stock - descuenta stock atómico de la variante exacta
--                               (color×talla) o del stock simple. FOR UPDATE.
--                               service_role ONLY (lo llama el webhook).
--   * assign_rental_unit       - auto-asigna una inventory_unit 'disponible' de
--                               la talla pedida sin solape de fechas. FOR UPDATE
--                               OF u SKIP LOCKED. service_role ONLY.
--   * get_rental_stock         - conteo público de unidades disponibles por
--                               (equipo, talla), sin PII. anon + authenticated.
--   * get_coupon               - devuelve un cupón SOLO si el código exacto está
--                               activo (evita listar todos los códigos). anon+auth.
--   * increment_coupon_usage   - +1 a used_count. authenticated + service_role.
-- Portado literalmente de Entreolas (versión final de cada objeto).
-- ============================================================

-- ------------------------------------------------------------
-- decrement_product_stock — descuento atómico de stock (service_role ONLY)
-- ------------------------------------------------------------
create or replace function public.decrement_product_stock(
  p_id uuid,
  p_color text,
  p_size text,
  p_qty int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ss jsonb; has_color bool; has_size bool; done bool := false;
  new_ss jsonb := '[]'::jsonb; elem jsonb; total int := 0;
begin
  select sizes_stock into ss from public.products where id = p_id for update;
  if ss is null or jsonb_array_length(ss) = 0 then
    update public.products set stock = greatest(coalesce(stock, 0) - p_qty, 0) where id = p_id;
    return;
  end if;
  select bool_or(coalesce(e->>'color','') <> ''), bool_or(coalesce(e->>'size','') <> '')
    into has_color, has_size from jsonb_array_elements(ss) e;
  for elem in select * from jsonb_array_elements(ss) loop
    if not done
       and (not coalesce(has_color, false) or coalesce(elem->>'color','') = coalesce(p_color,''))
       and (not coalesce(has_size, false)  or coalesce(elem->>'size','')  = coalesce(p_size,'')) then
      elem := jsonb_set(elem, '{stock}', to_jsonb(greatest(coalesce((elem->>'stock')::int, 0) - p_qty, 0)));
      done := true;
    end if;
    new_ss := new_ss || elem;
    total := total + coalesce((elem->>'stock')::int, 0);
  end loop;
  update public.products set sizes_stock = new_ss, stock = total where id = p_id;
end;
$$;

revoke all on function public.decrement_product_stock(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.decrement_product_stock(uuid, text, text, int) to service_role;

-- ------------------------------------------------------------
-- assign_rental_unit — auto-asignación de unidad física (service_role ONLY)
-- ------------------------------------------------------------
create or replace function public.assign_rental_unit(p_reservation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eq uuid; v_size text; v_ds date; v_de date; v_assigned uuid; v_unit uuid;
begin
  select equipment_id, size, date_start, date_end, assigned_unit_id
    into v_eq, v_size, v_ds, v_de, v_assigned
  from public.equipment_reservations where id = p_reservation_id;
  if not found or v_eq is null then return null; end if;
  if v_assigned is not null then return v_assigned; end if;

  select u.id into v_unit
  from public.inventory_units u
  where u.equipment_id = v_eq
    and u.estado = 'disponible'
    and ( v_size is null
          or coalesce(
               case when u.category = 'tabla' and u.pies is not null
                    then trunc(u.pies)::int::text || '''' || round((u.pies - trunc(u.pies))*10)::int::text
                    else u.talla end, '') = coalesce(v_size, '') )
    and not exists (
      select 1 from public.equipment_reservations r2
      where r2.assigned_unit_id = u.id
        and r2.id <> p_reservation_id
        and r2.status in ('pending','confirmed','active')
        and r2.date_start <= v_de and r2.date_end >= v_ds )
  order by random()
  limit 1
  for update of u skip locked;

  if v_unit is null then return null; end if;
  update public.equipment_reservations
    set assigned_unit_id = v_unit, updated_at = now()
    where id = p_reservation_id;
  return v_unit;
end;
$$;

revoke all on function public.assign_rental_unit(uuid) from public, anon, authenticated;
grant execute on function public.assign_rental_unit(uuid) to service_role;

-- ------------------------------------------------------------
-- get_rental_stock — conteo público de unidades disponibles (sin PII)
-- ------------------------------------------------------------
create or replace function public.get_rental_stock()
returns table(equipment_id uuid, size text, available int)
language sql
stable
security definer
set search_path = public
as $$
  select equipment_id,
         case when category='tabla' and pies is not null
              then trunc(pies)::int::text || '''' || round((pies - trunc(pies))*10)::int::text
              else talla end as size,
         count(*)::int as available
  from public.inventory_units
  where equipment_id is not null and estado = 'disponible'
  group by 1, 2;
$$;

grant execute on function public.get_rental_stock() to anon, authenticated;

-- ------------------------------------------------------------
-- get_coupon — valida el código server-side (no lista todos los cupones)
-- ------------------------------------------------------------
create or replace function public.get_coupon(p_code text)
returns setof public.coupons
language sql
stable
security definer
set search_path = public
as $$
  select * from public.coupons
  where upper(code) = upper(p_code) and active = true
  limit 1;
$$;

revoke all on function public.get_coupon(text) from public, anon, authenticated;
grant execute on function public.get_coupon(text) to anon, authenticated;

-- ------------------------------------------------------------
-- increment_coupon_usage — +1 a used_count
-- ------------------------------------------------------------
create or replace function public.increment_coupon_usage(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coupons
  set used_count = used_count + 1, updated_at = now()
  where id = p_coupon_id;
end;
$$;

revoke all on function public.increment_coupon_usage(uuid) from public, anon;
grant execute on function public.increment_coupon_usage(uuid) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

-- ▼▼▼ 0020_rpc_admin.sql ▼▼▼
-- ============================================================
-- 0020_rpc_admin.sql
-- Propósito: RPCs de administración / contabilidad (versiones FINALES).
--   * get_user_email    - email de un usuario; gate propio o is_admin().
--   * get_user_payments - historial de pagos de un usuario (enrollments/rentals/
--                         bookings/bonos/orders + custom sobre el propio user).
--                         Gate propio o is_admin() (staff que registra pagos vía
--                         la política enc_can de payments en 0021 — CONTRATO §3.1).
--   * get_bono_payments - pagos de un bono. FIX WAYA: filtra
--                         reservation_type IN ('bono','enrollment') (Entreolas
--                         solo miraba 'enrollment' y perdía los cobros de bono
--                         unificados). Gate dueño del bono o is_admin().
--   * delete_user       - borra un usuario (cascade auth.users). No self-delete;
--                         requiere is_strict_admin() (cambio WAYA respecto a
--                         is_admin de Entreolas).
-- Portado de Entreolas (versión final de cada objeto) con los fixes WAYA marcados.
-- ============================================================

-- ------------------------------------------------------------
-- get_user_email — email propio o de cualquiera si is_admin()
-- ------------------------------------------------------------
create or replace function public.get_user_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email from auth.users u
  where u.id = p_user_id
    and (p_user_id = auth.uid() or public.is_admin());
$$;

revoke all on function public.get_user_email(uuid) from public, anon;
grant execute on function public.get_user_email(uuid) to authenticated;

-- ------------------------------------------------------------
-- get_user_payments — pagos propios o de cualquiera si is_admin()
-- (staff que gestiona pagos; coherente con la política enc_can de payments)
-- ------------------------------------------------------------
create or replace function public.get_user_payments(p_user_id uuid)
returns setof public.payments
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.payments p
  where (p_user_id = auth.uid() or public.is_admin())
    and (
      p.reference_id in (
        select id from public.class_enrollments      where user_id = p_user_id
        union all select id from public.equipment_reservations where user_id = p_user_id
        union all select id from public.bookings      where user_id = p_user_id
        union all select id from public.bonos         where user_id = p_user_id
        union all select id from public.orders        where user_id = p_user_id
      )
      or (p.reservation_type = 'custom' and p.reference_id = p_user_id)
    )
  order by p.payment_date desc;
$$;

revoke all on function public.get_user_payments(uuid) from public, anon;
grant execute on function public.get_user_payments(uuid) to authenticated;

-- ------------------------------------------------------------
-- get_bono_payments — pagos de un bono. FIX WAYA: 'bono' + 'enrollment'
-- ------------------------------------------------------------
create or replace function public.get_bono_payments(p_bono_id uuid)
returns setof public.payments
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.payments p
  where p.reservation_type in ('bono','enrollment')   -- FIX WAYA (Entreolas: solo 'enrollment')
    and (
      -- cobros de bono: reference_id = bono.id
      (p.reservation_type = 'bono' and p.reference_id = p_bono_id)
      -- cobros de clase sueltos: reference_id = enrollment ligado al bono
      or (p.reservation_type = 'enrollment'
          and p.reference_id in (select id from public.class_enrollments where bono_id = p_bono_id))
    )
    and (
      public.is_admin()
      or exists (select 1 from public.bonos b where b.id = p_bono_id and b.user_id = auth.uid())
    )
  order by p.payment_date desc;
$$;

revoke all on function public.get_bono_payments(uuid) from public, anon;
grant execute on function public.get_bono_payments(uuid) to authenticated;

-- ------------------------------------------------------------
-- delete_user — borra usuario (cascade). No self-delete; is_strict_admin() (WAYA)
-- ------------------------------------------------------------
create or replace function public.delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Prevent self-deletion
  if p_user_id = auth.uid() then
    raise exception 'No puedes eliminarte a ti mismo';
  end if;

  -- Verify caller is strict admin (solo admin; el encargado no borra usuarios)
  if not public.is_strict_admin() then
    raise exception 'Solo administradores pueden eliminar usuarios';
  end if;

  -- Delete from auth.users (cascades to profiles and all related tables)
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.delete_user(uuid) from public, anon;
grant execute on function public.delete_user(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

-- ▼▼▼ 0021_rls_policies.sql ▼▼▼
-- ============================================================
-- 0021_rls_policies.sql
-- Propósito: estado FINAL y autoritativo de las políticas RLS de TODAS las
-- tablas de reservas de Waya. Redefine (drop-if-exists + create) las políticas
-- creadas inline en 0002–0015 para dejarlas en su forma final:
--   * Escritura del staff vía enc_can([...]) (admin siempre pasa; encargado
--     según allowed_sections). Facturación (payments) incluye a encargado.
--   * Lectura pública (using true) solo en catálogo público.
--   * Lectura/gestión propia por auth.uid() en tablas con PII.
--   * Guest checkout: INSERT anónimo cuando hay guest_email.
--   * bonos: SIN política de INSERT de cliente (solo webhook service_role / staff).
--   * coupons: SIN lectura pública (se sirve por get_coupon); gestión is_strict_admin.
--   * class_holds: RLS activa SIN políticas (solo vía RPC SECURITY DEFINER) — no se toca aquí.
--   * profiles: sus políticas + trigger de protección viven en 0004 (no se redefinen aquí).
-- Portado literal de Entreolas (versión final: encargado-section-rls +
-- security-hardening + guest-checkout + payments-encargado + coupons hardening).
-- Idempotente: drop policy if exists antes de create.
-- ============================================================

-- ============================================================
-- SURF CAMPS (catálogo público · escritura staff camps/reservas) — latente
-- ============================================================
alter table public.surf_camps enable row level security;
drop policy if exists "Anyone can read camps" on public.surf_camps;
create policy "Anyone can read camps" on public.surf_camps
  for select using (true);
drop policy if exists "Admins manage camps" on public.surf_camps;
drop policy if exists "Staff manage camps" on public.surf_camps;
create policy "Staff manage camps" on public.surf_camps
  for all using (public.enc_can(array['camps','reservas']))
  with check (public.enc_can(array['camps','reservas']));

-- CAMP_PHOTOS / CAMP_TESTIMONIALS / CAMP_FAQS (público lectura · staff escritura)
alter table public.camp_photos enable row level security;
drop policy if exists "Public read camp_photos" on public.camp_photos;
create policy "Public read camp_photos" on public.camp_photos
  for select using (true);
drop policy if exists "Admin manage camp_photos" on public.camp_photos;
drop policy if exists "Staff manage camp_photos" on public.camp_photos;
create policy "Staff manage camp_photos" on public.camp_photos
  for all using (public.enc_can(array['camps','reservas']))
  with check (public.enc_can(array['camps','reservas']));

alter table public.camp_testimonials enable row level security;
drop policy if exists "Public read camp_testimonials" on public.camp_testimonials;
create policy "Public read camp_testimonials" on public.camp_testimonials
  for select using (true);
drop policy if exists "Admin manage camp_testimonials" on public.camp_testimonials;
drop policy if exists "Staff manage camp_testimonials" on public.camp_testimonials;
create policy "Staff manage camp_testimonials" on public.camp_testimonials
  for all using (public.enc_can(array['camps','reservas']))
  with check (public.enc_can(array['camps','reservas']));

alter table public.camp_faqs enable row level security;
drop policy if exists "Public read camp_faqs" on public.camp_faqs;
create policy "Public read camp_faqs" on public.camp_faqs
  for select using (true);
drop policy if exists "Admin manage camp_faqs" on public.camp_faqs;
drop policy if exists "Staff manage camp_faqs" on public.camp_faqs;
create policy "Staff manage camp_faqs" on public.camp_faqs
  for all using (public.enc_can(array['camps','reservas']))
  with check (public.enc_can(array['camps','reservas']));

-- ============================================================
-- SURF CLASSES (catálogo público · escritura staff calendario/reserva-clases)
-- ============================================================
alter table public.surf_classes enable row level security;
drop policy if exists "Anyone can read classes" on public.surf_classes;
create policy "Anyone can read classes" on public.surf_classes
  for select using (true);
drop policy if exists "Admins manage classes" on public.surf_classes;
drop policy if exists "Staff manage classes" on public.surf_classes;
create policy "Staff manage classes" on public.surf_classes
  for all using (public.enc_can(array['calendario','reserva-clases']))
  with check (public.enc_can(array['calendario','reserva-clases']));

-- ============================================================
-- PRODUCTS (catálogo público · escritura staff productos) — latente
-- ============================================================
alter table public.products enable row level security;
drop policy if exists "Anyone can read products" on public.products;
create policy "Anyone can read products" on public.products
  for select using (true);
drop policy if exists "Admins manage products" on public.products;
drop policy if exists "Staff manage products" on public.products;
create policy "Staff manage products" on public.products
  for all using (public.enc_can(array['productos']))
  with check (public.enc_can(array['productos']));

-- ============================================================
-- ORDERS (PII · dueño/guest · escritura staff pedidos) — backbone checkout
-- ============================================================
alter table public.orders enable row level security;
drop policy if exists "Users read own orders" on public.orders;
create policy "Users read own orders" on public.orders
  for select using (user_id = auth.uid() or public.enc_can(array['pedidos']));
drop policy if exists "Users create own orders" on public.orders;
drop policy if exists "Allow guest order insert" on public.orders;
create policy "Allow guest order insert" on public.orders
  for insert with check (user_id is not null or guest_email is not null);
drop policy if exists "Admins manage all orders" on public.orders;
drop policy if exists "Staff manage orders" on public.orders;
create policy "Staff manage orders" on public.orders
  for all using (public.enc_can(array['pedidos']))
  with check (public.enc_can(array['pedidos']));

-- ORDER ITEMS
alter table public.order_items enable row level security;
drop policy if exists "Users read own order items" on public.order_items;
create policy "Users read own order items" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (o.user_id = auth.uid() or public.enc_can(array['pedidos']))
    )
  );
drop policy if exists "Users create order items" on public.order_items;
drop policy if exists "Allow order items insert" on public.order_items;
create policy "Allow order items insert" on public.order_items
  for insert with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (o.user_id = auth.uid() or o.guest_email is not null)
    )
  );
drop policy if exists "Admins manage all order items" on public.order_items;
drop policy if exists "Staff manage order items" on public.order_items;
create policy "Staff manage order items" on public.order_items
  for all using (public.enc_can(array['pedidos']))
  with check (public.enc_can(array['pedidos']));

-- ============================================================
-- FAMILY MEMBERS (dueño gestiona · staff clientes/calendario/reserva-clases)
-- ============================================================
alter table public.family_members enable row level security;
drop policy if exists "Users manage own family members" on public.family_members;
create policy "Users manage own family members" on public.family_members
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Admins read all family members" on public.family_members;
drop policy if exists "Admins manage all family members" on public.family_members;
drop policy if exists "Staff manage family members" on public.family_members;
create policy "Staff manage family members" on public.family_members
  for all using (public.enc_can(array['clientes','calendario','reserva-clases']))
  with check (public.enc_can(array['clientes','calendario','reserva-clases']));

-- ============================================================
-- ACTIVITIES + hijas (catálogo público)
-- ============================================================
alter table public.activities enable row level security;
drop policy if exists "act_sel" on public.activities;
create policy "act_sel" on public.activities for select using (true);
drop policy if exists "act_admin" on public.activities;
drop policy if exists "act_staff" on public.activities;
create policy "act_staff" on public.activities
  for all using (public.enc_can(array['actividades']))
  with check (public.enc_can(array['actividades']));

alter table public.activity_packs enable row level security;
drop policy if exists "pk_sel" on public.activity_packs;
create policy "pk_sel" on public.activity_packs for select using (true);
drop policy if exists "pk_admin" on public.activity_packs;
drop policy if exists "pk_staff" on public.activity_packs;
create policy "pk_staff" on public.activity_packs
  for all using (public.enc_can(array['actividades']))
  with check (public.enc_can(array['actividades']));

-- activity_photos / testimonials / faqs: gestión enc_can(['actividades']) — mismo
-- modelo de secciones que la tabla padre activities/activity_packs (coherencia de permisos)
alter table public.activity_photos enable row level security;
drop policy if exists "ph_sel" on public.activity_photos;
create policy "ph_sel" on public.activity_photos for select using (true);
drop policy if exists "ph_admin" on public.activity_photos;
create policy "ph_admin" on public.activity_photos
  for all using (public.enc_can(array['actividades']))
  with check (public.enc_can(array['actividades']));

alter table public.activity_testimonials enable row level security;
drop policy if exists "ts_sel" on public.activity_testimonials;
create policy "ts_sel" on public.activity_testimonials for select using (true);
drop policy if exists "ts_admin" on public.activity_testimonials;
create policy "ts_admin" on public.activity_testimonials
  for all using (public.enc_can(array['actividades']))
  with check (public.enc_can(array['actividades']));

alter table public.activity_faqs enable row level security;
drop policy if exists "fq_sel" on public.activity_faqs;
create policy "fq_sel" on public.activity_faqs for select using (true);
drop policy if exists "fq_admin" on public.activity_faqs;
create policy "fq_admin" on public.activity_faqs
  for all using (public.enc_can(array['actividades']))
  with check (public.enc_can(array['actividades']));

-- ============================================================
-- BONOS (PII · dueño lectura · staff gestiona · SIN insert de cliente)
--   El INSERT lo hace SOLO el webhook (service_role, bypass RLS) o el staff.
-- ============================================================
alter table public.bonos enable row level security;
drop policy if exists "Users cannot directly insert bonos" on public.bonos;  -- eliminada: sin alta de cliente
drop policy if exists "Users read own bonos" on public.bonos;
create policy "Users read own bonos" on public.bonos
  for select using (user_id = auth.uid() or public.enc_can(array['calendario','reserva-clases','clientes']));
drop policy if exists "Admins manage all bonos" on public.bonos;
drop policy if exists "Staff manage bonos" on public.bonos;
create policy "Staff manage bonos" on public.bonos
  for all using (public.enc_can(array['calendario','reserva-clases','clientes']))
  with check (public.enc_can(array['calendario','reserva-clases','clientes']));

-- ============================================================
-- CLASS ENROLLMENTS (PII · dueño lectura · staff gestiona)
-- ============================================================
alter table public.class_enrollments enable row level security;
drop policy if exists "Admin full access" on public.class_enrollments;
drop policy if exists "Admins manage all enrollments" on public.class_enrollments;
drop policy if exists "Admins insert enrollments" on public.class_enrollments;
drop policy if exists "Users read own enrollments" on public.class_enrollments;
drop policy if exists "Staff manage enrollments" on public.class_enrollments;
create policy "Staff manage enrollments" on public.class_enrollments
  for all using (public.enc_can(array['calendario','reserva-clases','clientes']))
  with check (public.enc_can(array['calendario','reserva-clases','clientes']));
create policy "Users read own enrollments" on public.class_enrollments
  for select using (user_id = auth.uid() or public.enc_can(array['calendario','reserva-clases','clientes']));

-- ============================================================
-- CLASS HOLDS: RLS activa SIN políticas (solo vía RPC SECURITY DEFINER).
--   No se crea ninguna política aquí — es intencional. Ver 0012.
-- ============================================================
alter table public.class_holds enable row level security;

-- ============================================================
-- BOOKINGS (PII · dueño/guest · staff reservas/camps) — latente
-- ============================================================
alter table public.bookings enable row level security;
drop policy if exists "Users read own bookings" on public.bookings;
create policy "Users read own bookings" on public.bookings
  for select using (user_id = auth.uid() or public.enc_can(array['reservas','camps']));
drop policy if exists "Users create own bookings" on public.bookings;
drop policy if exists "Allow guest booking insert" on public.bookings;
create policy "Allow guest booking insert" on public.bookings
  for insert with check (user_id is not null or guest_email is not null);
drop policy if exists "Admins manage all bookings" on public.bookings;
drop policy if exists "Staff manage bookings" on public.bookings;
create policy "Staff manage bookings" on public.bookings
  for all using (public.enc_can(array['reservas','camps']))
  with check (public.enc_can(array['reservas','camps']));

-- ============================================================
-- RENTAL EQUIPMENT (catálogo público · staff material)
-- ============================================================
alter table public.rental_equipment enable row level security;
drop policy if exists "Anyone can read equipment" on public.rental_equipment;
create policy "Anyone can read equipment" on public.rental_equipment
  for select using (true);
drop policy if exists "Admins manage equipment" on public.rental_equipment;
drop policy if exists "Staff manage equipment" on public.rental_equipment;
create policy "Staff manage equipment" on public.rental_equipment
  for all using (public.enc_can(array['material']))
  with check (public.enc_can(array['material']));

-- EQUIPMENT RESERVATIONS (PII · dueño/guest · staff material/calendario)
alter table public.equipment_reservations enable row level security;
drop policy if exists "Users read own equipment reservations" on public.equipment_reservations;
create policy "Users read own equipment reservations" on public.equipment_reservations
  for select using (user_id = auth.uid() or public.enc_can(array['material','calendario']));
drop policy if exists "Anyone can create equipment reservations" on public.equipment_reservations;
create policy "Anyone can create equipment reservations" on public.equipment_reservations
  for insert with check (user_id = auth.uid() or guest_email is not null);
drop policy if exists "Admins manage all equipment reservations" on public.equipment_reservations;
drop policy if exists "Staff manage equipment reservations" on public.equipment_reservations;
create policy "Staff manage equipment reservations" on public.equipment_reservations
  for all using (public.enc_can(array['material','calendario']))
  with check (public.enc_can(array['material','calendario']));

-- INVENTORY UNITS (sin lectura pública · staff material)
alter table public.inventory_units enable row level security;
drop policy if exists "Staff manage inventory units" on public.inventory_units;
create policy "Staff manage inventory units" on public.inventory_units
  for all using (public.enc_can(array['material']))
  with check (public.enc_can(array['material']));

-- ============================================================
-- PAYMENTS (contabilidad · staff con acceso a secciones donde se cobra;
--   enc_can también cubre a admin — el encargado SÍ registra pagos)
-- ============================================================
alter table public.payments enable row level security;
drop policy if exists "Admins manage payments" on public.payments;
drop policy if exists "Strict admins manage payments" on public.payments;
drop policy if exists "Staff manage payments" on public.payments;
create policy "Staff manage payments" on public.payments
  for all using (public.enc_can(array['calendario','clientes','material','reservas','pedidos']))
  with check (public.enc_can(array['calendario','clientes','material','reservas','pedidos']));

-- ============================================================
-- COUPONS (SIN lectura pública — se sirve por get_coupon; gestión is_strict_admin)
-- ============================================================
alter table public.coupons enable row level security;
drop policy if exists "Public read active coupons" on public.coupons;  -- eliminada: no listar códigos
drop policy if exists "Admin manage coupons" on public.coupons;
drop policy if exists "Strict admins manage coupons" on public.coupons;
create policy "Strict admins manage coupons" on public.coupons
  for all using (public.is_strict_admin())
  with check (public.is_strict_admin());

-- ============================================================
-- DELETED ITEMS / papelera (staff con cualquier sección operativa)
-- ============================================================
alter table public.deleted_items enable row level security;
drop policy if exists "Staff manage trash" on public.deleted_items;
create policy "Staff manage trash" on public.deleted_items
  for all using (public.enc_can(array['clientes','reservas','calendario','material','reserva-clases','camps']))
  with check (public.enc_can(array['clientes','reservas','calendario','material','reserva-clases','camps']));

select pg_notify('pgrst', 'reload schema');

-- ▼▼▼ 0022_indexes.sql ▼▼▼
-- ============================================================
-- 0022_indexes.sql
-- Propósito: índices de rendimiento restantes (portados de Entreolas
-- migration-audit-fixes.sql + migration-payment-channel.sql) que no se crean
-- inline en las migraciones de tabla, o que se aseguran aquí de forma
-- idempotente para dashboards/reportes. Todos con IF NOT EXISTS: seguros de
-- reejecutar aunque alguno ya exista inline.
-- ============================================================

-- PROFILES: búsqueda rápida por rol (listar admins/encargados)
create index if not exists idx_profiles_role
  on public.profiles(role);

-- ORDERS: filtrar/ordenar por estado + fecha (dashboard, reportes)
create index if not exists idx_orders_status_created
  on public.orders(status, created_at);

-- CLASS ENROLLMENTS: filtrar por estado, buscar por clase o usuario
create index if not exists idx_class_enrollments_status
  on public.class_enrollments(status);
create index if not exists idx_class_enrollments_class_id
  on public.class_enrollments(class_id);
create index if not exists idx_class_enrollments_user_id
  on public.class_enrollments(user_id);

-- BONOS: bonos activos por usuario, filtro por actividad
create index if not exists idx_bonos_user_id_status
  on public.bonos(user_id, status);
create index if not exists idx_bonos_activity_id
  on public.bonos(activity_id);

-- PAYMENTS: búsqueda por referencia (order/bono/enrollment id) y por canal/fecha
create index if not exists idx_payments_reference_id
  on public.payments(reference_id);
create index if not exists idx_payments_channel
  on public.payments(channel, payment_date desc);

-- COUPONS: lookup por código y por activo
create index if not exists idx_coupons_code
  on public.coupons(code);
create index if not exists idx_coupons_active
  on public.coupons(active);

-- ACTIVIDADES (hijas): join por activity_id
create index if not exists idx_activity_packs_aid
  on public.activity_packs(activity_id);
create index if not exists idx_activity_photos_aid
  on public.activity_photos(activity_id);
create index if not exists idx_activity_test_aid
  on public.activity_testimonials(activity_id);
create index if not exists idx_activity_faqs_aid
  on public.activity_faqs(activity_id);

-- PAPELERA: pendientes de restaurar (restored_at NULL) por fecha
create index if not exists idx_deleted_items_pending
  on public.deleted_items(restored_at, deleted_at desc);

select pg_notify('pgrst', 'reload schema');

-- ▼▼▼ 0023_seed_waya.sql ▼▼▼
-- ============================================================
-- 0023_seed_waya.sql
-- Propósito: seed canónico de Waya desde docs/reservas/catalog.json.
--   * 6 activities (grupal, privada, semiprivada, familiar, residente, kids)
--     con deposit / pack_validity / extra_class_price / per_person.
--   * activity_packs con los precios EXACTOS de la web de Waya.
--   * 3 rental_equipment (soft, fiber, wetsuit).
-- NO se poblan camps ni products (latentes).
-- Idempotente: upsert de activities por type_key (unique) y de rental_equipment
-- por slug (unique); los packs se regeneran (delete + insert) para las 6 actividades.
--
-- -- TODO Waya: TODOS los defaults de gaps (deposit 15€, pack_validity, fianza de
--    alquiler 5€, extra_class_price) son EDITABLES desde el admin como en Entreolas.
--    La verificación de residencia (residente/kids) es honor system + nota, con
--    verificación manual del admin — NO se bloquea en SQL. El refer-a-friend −10%
--    de residente se implementa como fila en `coupons`, no aquí.
-- ============================================================

-- ------------------------------------------------------------
-- 1) ACTIVITIES  (type_key · nombre · duracion min · per_person · deposit · pack_validity)
--    -- TODO Waya: revisar deposit (15€) y pack_validity (días) en admin.
-- ------------------------------------------------------------
insert into public.activities
  (slug, type_key, nombre, descripcion, duracion, per_person, deposit, pack_validity, extra_class_price, hero_image, ubicacion, color, activo, sort_order)
values
  ('clases-grupales',      'grupal',      'Clases Grupales',    'Aprende surf en un ambiente dinámico y motivador. Grupos reducidos de máximo 8 personas, con instructores certificados FES.', 120, false, 15, 180, 0, 'images/carousel-grupales.jpg',     'Las Canteras', '#1a1a1a', true, 1),
  ('clases-privadas',      'privada',     'Clases Privadas',    'Premium 1:1 — aprendizaje intensivo con atención 100% personalizada. Incluye videoanálisis a partir del pack de 3 días.',        120, false, 15, 180, 0, 'images/carousel-privadas.jpg',     'Las Canteras', '#1a1a1a', true, 2),
  ('clases-semiprivadas',  'semiprivada', 'Clases Semi-Privadas','Atención semi-personalizada para 2 personas con instructor dedicado. Ideal para parejas o amigos. Precio por persona.',        120, true,  15, 180, 0, 'images/carousel-semiprivadas.jpg', 'Las Canteras', '#1a1a1a', true, 3),
  ('clases-familiares',    'familiar',    'Surf en Familia',    'Clases diseñadas para padres e hijos: seguridad y juegos adaptados a cada edad, con un instructor paciente y atento.',           120, false, 15, 180, 0, 'images/carousel-familiar.jpg',     'Las Canteras', '#1a1a1a', true, 4),
  ('bono-residente',       'residente',   'Bono Residentes',    'Bono para adultos residentes en Canarias. Tarifa reducida, horario flexible y sin compromisos fijos.',                          120, false, 15, 365, 0, 'images/bono-hero.jpg',             'Las Canteras', '#1a1a1a', true, 5),
  ('waya-kids',            'kids',        'Waya Kids',          'Programa infantil con clases semanales de 1,5h. Grupos reducidos por edades, metodología lúdica. Para niños residentes en Canarias.', 90, false, 15, 60, 0, 'images/stock-kids.png',          'Las Canteras', '#1a1a1a', true, 6)
on conflict (type_key) do update set
  slug             = excluded.slug,
  nombre           = excluded.nombre,
  descripcion      = excluded.descripcion,
  duracion         = excluded.duracion,
  per_person       = excluded.per_person,
  deposit          = excluded.deposit,
  pack_validity    = excluded.pack_validity,
  extra_class_price= excluded.extra_class_price,
  hero_image       = excluded.hero_image,
  ubicacion        = excluded.ubicacion,
  color            = excluded.color,
  activo           = excluded.activo,
  sort_order       = excluded.sort_order,
  updated_at       = now();

-- ------------------------------------------------------------
-- 2) ACTIVITY PACKS  (sessions · price EUR · featured) — precios EXACTOS de la web
--    Regeneración idempotente: se borran y reinsertan los packs de las 6 actividades.
--    Semi-privada: precio POR PERSONA (per_person=true) — 1 crédito por asistente.
--    Familiar: SIN pack público — precio a medida fijado por el admin (custom_total).
-- ------------------------------------------------------------
delete from public.activity_packs
  where activity_id in (
    select id from public.activities
    where type_key in ('grupal','privada','semiprivada','familiar','residente','kids')
  );

insert into public.activity_packs (activity_id, sessions, price, featured, public, sort_order)
select a.id, v.sessions, v.price, v.featured, true, v.sort_order
from public.activities a
join (values
  -- grupal (2h)
  ('grupal',      1, 40::numeric,  false, 1),
  ('grupal',      3, 105::numeric, true,  2),
  ('grupal',      5, 165::numeric, false, 3),
  -- privada (2h)
  ('privada',     1, 90::numeric,  false, 1),
  ('privada',     3, 255::numeric, true,  2),
  ('privada',     5, 415::numeric, false, 3),
  -- semiprivada (2h, POR PERSONA)
  ('semiprivada', 1, 70::numeric,  false, 1),
  ('semiprivada', 3, 195::numeric, true,  2),
  ('semiprivada', 5, 315::numeric, false, 3),
  -- familiar: SIN pack público (precio a medida). El admin crea el bono con custom_total
  -- manualmente (mín. de personas y precio/persona NO se fijan en la web, decisión de Victor).
  -- residente (2h)
  ('residente',   4, 80::numeric,  false, 1),
  ('residente',   8, 150::numeric, true,  2),
  -- kids (1,5h / 90min)
  ('kids',        4, 80::numeric,  false, 1),
  ('kids',        8, 150::numeric, true,  2)
) as v(type_key, sessions, price, featured, sort_order)
  on v.type_key = a.type_key;

-- ------------------------------------------------------------
-- 3) RENTAL EQUIPMENT  (slug · name · type · pricing {"1d": €/día} · deposit)
--    -- TODO Waya: fianza/depósito de alquiler (5€) editable en admin.
-- ------------------------------------------------------------
insert into public.rental_equipment (slug, name, type, description, pricing, deposit, stock, active)
values
  ('rental-soft',    'Tabla Soft (espuma)',  'con_talla', 'Tablas Soft (Softech / Flysurf), medidas 5''6" a 8''2". Más de 30 tablas disponibles.', '{"1d": 20}'::jsonb, 5, 30, true),
  ('rental-fiber',   'Tabla Fibra', 'con_talla', 'Tablas de Fibra Premium (Pukas, FullandCas, JS Industries). Shortboards / Funboards 5''6" a 7''6".', '{"1d": 30}'::jsonb, 5, 10, true),
  ('rental-wetsuit', 'Neopreno',    'con_talla', 'Neoprenos 3/2mm de alta calidad (Xcel, Seland, Wyrd). Todas las tallas (Hombre, Mujer, Niño).', '{"1d": 5}'::jsonb, 5, 40, true)
on conflict (slug) do update set
  name        = excluded.name,
  type        = excluded.type,
  description = excluded.description,
  pricing     = excluded.pricing,
  deposit     = excluded.deposit,
  active      = excluded.active,
  updated_at  = now();

-- Recargar el cache de esquema de PostgREST
select pg_notify('pgrst', 'reload schema');

commit;
