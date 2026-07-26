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
