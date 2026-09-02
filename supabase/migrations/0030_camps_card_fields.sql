-- ============================================================
-- 0030_camps_card_fields.sql
-- AÑADE LAS DOS COLUMNAS QUE EL PANEL YA INTENTABA GUARDAR.
--
-- El editor de surfcamps (admin/sections/camps.js) tiene desde el principio
-- los campos "VIBE / TAGS DE LA CARD" y "DURACIÓN (TEXTO DE LA CARD)", y al
-- guardar la pestaña General enviaba card_vibe y duration_label. Pero esas
-- columnas nunca se crearon en surf_camps, así que Postgres rechazaba el
-- UPDATE ENTERO con:
--
--     column surf_camps.card_vibe does not exist   (42703)
--
-- Como el upsert es atómico, no se guardaba NADA de esa pestaña: ni el
-- título, ni el kicker, ni la descripción, ni el color, ni las fechas. Por eso
-- description y kicker seguían a null por mucho que se rellenaran en el panel.
--
-- Ambas son overrides opcionales del texto de la tarjeta del listado: si se
-- dejan vacías, el frontend sigue calculando la duración desde las fechas.
-- ============================================================

alter table public.surf_camps
  add column if not exists card_vibe      text,
  add column if not exists duration_label text;

comment on column public.surf_camps.card_vibe is
  'Texto libre del tag ⚡ en la tarjeta del listado (ej: "SURF, SOCIAL"). Opcional.';

comment on column public.surf_camps.duration_label is
  'Sobrescribe el "N días / M noches" calculado desde las fechas (ej: "4 días / 3 noches"). Opcional.';
