-- ============================================================
-- 0031_storage_bucket.sql
-- CREA EL BUCKET DE IMÁGENES. Sin esto, TODA subida de foto falla con
-- "Bucket not found" (NoSuchBucket): el proyecto no tenía ningún bucket.
--
-- Un único bucket, 'activity-photos', es el que usan las tres funciones de
-- subida de admin/modules/api.js — el nombre viene de cuando solo había
-- actividades, pero hoy guarda también camps y productos, cada uno en su
-- carpeta (activities/…, camps/…, productos/…):
--
--   uploadActivityImage()  → fotos de actividades
--   uploadCampImage()      → fotos y hero de surfcamps
--   uploadProductImage()   → fotos y galería de la tienda
--
-- Público en lectura (las imágenes se sirven en la web con getPublicUrl) y
-- escritura restringida al staff que gestiona ese contenido.
-- ============================================================

-- 1. El bucket. `public = true` para que getPublicUrl() devuelva URLs
--    servibles sin firmar, que es como las consume el frontend.
insert into storage.buckets (id, name, public)
values ('activity-photos', 'activity-photos', true)
on conflict (id) do update set public = excluded.public;

-- 2. Lectura pública: las fotos salen en la web para visitantes anónimos.
drop policy if exists "Public read activity-photos" on storage.objects;
create policy "Public read activity-photos" on storage.objects
  for select
  using (bucket_id = 'activity-photos');

-- 3. Escritura solo para staff con permiso sobre alguna de las secciones que
--    usan el bucket. enc_can hace OR entre secciones, y los admin pasan
--    siempre — así un encargado de "camps" puede subir fotos de camps sin
--    necesitar permiso sobre productos.
drop policy if exists "Staff upload activity-photos" on storage.objects;
create policy "Staff upload activity-photos" on storage.objects
  for insert
  with check (
    bucket_id = 'activity-photos'
    and public.enc_can(array['actividades', 'camps', 'productos'])
  );

drop policy if exists "Staff update activity-photos" on storage.objects;
create policy "Staff update activity-photos" on storage.objects
  for update
  using (
    bucket_id = 'activity-photos'
    and public.enc_can(array['actividades', 'camps', 'productos'])
  );

drop policy if exists "Staff delete activity-photos" on storage.objects;
create policy "Staff delete activity-photos" on storage.objects
  for delete
  using (
    bucket_id = 'activity-photos'
    and public.enc_can(array['actividades', 'camps', 'productos'])
  );
