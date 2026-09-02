-- ============================================================
-- 0033_camps_i18n_and_settings.sql
--
-- 1) TRADUCCIONES DEL CONTENIDO DE LOS CAMPS.
--    El sitio tiene 3 idiomas (ES/EN/DE), pero la i18n solo cubría el texto
--    estático del HTML (data-i18n + translations.js). Todo lo que se escribe
--    en el panel — título, descripción, "qué incluye", "ideal para ti si…" —
--    salía siempre en español, aunque el visitante estuviera en EN o DE.
--
--    En vez de duplicar ~15 columnas por idioma, se guarda un único jsonb:
--
--      { "en": { "title": "...", "whats_included": ["...", "..."] },
--        "de": { "title": "...", ... } }
--
--    Solo se rellena lo que se traduce; el resto cae a español. Así añadir
--    un cuarto idioma no toca el esquema.
--
-- 2) AJUSTES DE PÁGINA (site_settings).
--    El hero del listado de surfcamps decía "Vive el surf en Gran Canaria",
--    escrito a fuego en surfcamps.html, con la imagen fijada en el CSS. Pero
--    los camps son por todo el mundo (Marruecos, etc.), así que el texto era
--    directamente incorrecto y no había manera de cambiarlo sin tocar código.
--
--    Tabla genérica clave→valor para textos e imágenes de cabecera editables
--    desde el panel. Vale para futuras páginas sin otra migración.
-- ============================================================

-- ---------- 1. Traducciones de camps ----------
alter table public.surf_camps
  add column if not exists i18n jsonb not null default '{}'::jsonb;

comment on column public.surf_camps.i18n is
  'Traducciones por idioma: {"en":{campo:valor},"de":{...}}. Lo que falte cae al español de las columnas base.';

-- ---------- 2. Ajustes de página ----------
create table if not exists public.site_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

comment on table public.site_settings is
  'Textos e imágenes editables de páginas estáticas (heros, etc.). value guarda también las traducciones.';

alter table public.site_settings enable row level security;

-- Lectura pública: el frontend pinta estos textos para cualquier visitante.
drop policy if exists "Anyone can read site_settings" on public.site_settings;
create policy "Anyone can read site_settings" on public.site_settings
  for select using (true);

-- Escritura: staff con permiso sobre camps (de momento el único que usa esto).
drop policy if exists "Staff manage site_settings" on public.site_settings;
create policy "Staff manage site_settings" on public.site_settings
  for all
  using (public.enc_can(array['camps', 'actividades']))
  with check (public.enc_can(array['camps', 'actividades']));

-- Valor inicial del hero de surfcamps, ya corregido: los camps no son solo
-- de Gran Canaria. Si la fila ya existe no se pisa lo que haya editado el staff.
insert into public.site_settings (key, value)
values (
  'surfcamps_hero',
  jsonb_build_object(
    'kicker',   'Surfcamps',
    'title',    'Vive el surf por el mundo',
    'subtitle', 'Viajes de surf con la familia Waya: olas nuevas, comunidad y desconexión. Elige tu próxima edición.',
    'image',    '',
    'i18n', jsonb_build_object(
      'en', jsonb_build_object(
        'kicker',   'Surfcamps',
        'title',    'Surf your way around the world',
        'subtitle', 'Surf trips with the Waya family: new waves, community and a proper disconnect. Pick your next edition.'
      ),
      'de', jsonb_build_object(
        'kicker',   'Surfcamps',
        'title',    'Surfe rund um die Welt',
        'subtitle', 'Surfreisen mit der Waya-Familie: neue Wellen, Gemeinschaft und echtes Abschalten. Wähle deine nächste Edition.'
      )
    )
  )
)
on conflict (key) do nothing;
