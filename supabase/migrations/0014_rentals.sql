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
