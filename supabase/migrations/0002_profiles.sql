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
