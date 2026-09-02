-- ============================================================
-- 0029_products_public_catalog.sql
-- ACTIVA EL CATÁLOGO PÚBLICO (tienda.html).
--
-- La tabla public.products venía de 0007 marcada como "LATENTE en Waya v1":
-- existía con su CRUD en el panel, pero sin escaparate en la web. Al publicar
-- /tienda.html pasa a ser visible, así que hay que cerrar un agujero:
--
-- 0021 dejó la lectura como `for select using (true)`, es decir, CUALQUIERA
-- podía leer TODAS las filas por la API REST — incluidos los borradores
-- (status='draft'). Mientras no hubo tienda daba igual; con el catálogo
-- publicado, un producto a medio preparar (nombre provisional, precio de
-- prueba) sería consultable por cualquiera aunque la web no lo pinte.
--
-- Aquí la lectura anónima se limita a los productos publicados. El staff
-- sigue viendo y editando todo: las policies permisivas se combinan con OR,
-- así que "Staff manage products" (for all) le cubre el select completo.
-- ============================================================

alter table public.products enable row level security;

-- Fuera la lectura indiscriminada
drop policy if exists "Anyone can read products" on public.products;
drop policy if exists "Public reads active products" on public.products;

-- El público solo ve lo publicado.
-- 'out_of_stock' SÍ se muestra: el producto existe y se enseña agotado,
-- que es información útil para el cliente. 'draft' queda oculto.
create policy "Public reads active products" on public.products
  for select
  using (status in ('active', 'out_of_stock'));

-- Nota: "Staff manage products" (0021) se mantiene tal cual — da al staff
-- con permiso 'productos' acceso total (select incluido) sobre la tabla.

-- Índice para el filtrado del catálogo: la tienda pide por status y ordena
-- por categoría, y el panel filtra por status constantemente.
create index if not exists products_status_category_idx
  on public.products (status, category);
