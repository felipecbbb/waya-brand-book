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
