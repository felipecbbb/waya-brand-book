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
