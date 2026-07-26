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
