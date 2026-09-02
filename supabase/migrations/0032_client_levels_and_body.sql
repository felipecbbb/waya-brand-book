-- ============================================================
-- 0032_client_levels_and_body.sql
--
-- 1) NIVELES REALES DE WAYA para las personas (cliente y familiares).
--    Hasta ahora el selector solo ofrecía principiante/intermedio/avanzado,
--    pero la web (niveles.html) trabaja con la escala 0–5:
--
--      Nivel 0  Tus Primeros Pasos      ┐ Principiantes
--      Nivel 1  Consolidando Básicos    ┘
--      Nivel 2  Hacia la Ola Verde      ┐ Intermedio
--      Nivel 3  Autonomía en el Pico    ┘
--      Nivel 4  Maniobras y Velocidad   ┐ Avanzado
--      Nivel 5+ Alto Rendimiento        ┘
--
--    Los tres valores antiguos SE MANTIENEN en el CHECK: hay clientes ya
--    guardados con ellos y quitarlos rompería esas filas. El panel ofrecerá
--    los nuevos; los viejos siguen siendo válidos hasta que se reetiqueten.
--
--    OJO: surf_classes.level NO se toca. Ahí 'principiante' describe a qué
--    público va dirigida una CLASE, no el nivel de una persona concreta.
--
-- 2) PESO Y ALTURA en lugar de pedir la talla de neopreno al cliente.
--    El cliente no suele saber su talla; con peso y altura la escuela deduce
--    el neopreno correcto. wetsuit_size SE MANTIENE en la tabla — sigue
--    siendo útil como dato interno una vez la escuela lo determina, y las
--    reservas de material ya guardadas lo usan.
-- ============================================================

-- ---------- 1. Niveles ----------
alter table public.family_members
  drop constraint if exists family_members_level_check;

alter table public.family_members
  add constraint family_members_level_check
  check (level is null or level in (
    -- escala Waya 0–5
    'nivel_0', 'nivel_1', 'nivel_2', 'nivel_3', 'nivel_4', 'nivel_5',
    -- legacy: filas ya guardadas con la escala genérica
    'principiante', 'intermedio', 'avanzado', 'todos'
  ));

-- profiles.level es text libre (sin CHECK), así que admite los nuevos valores
-- sin cambios de esquema.

-- ---------- 2. Peso y altura ----------
alter table public.profiles
  add column if not exists weight_kg numeric(5,1),
  add column if not exists height_cm numeric(5,1);

alter table public.family_members
  add column if not exists weight_kg numeric(5,1),
  add column if not exists height_cm numeric(5,1);

comment on column public.profiles.weight_kg is
  'Peso en kg. Junto con height_cm permite a la escuela deducir la talla de neopreno.';
comment on column public.profiles.height_cm is
  'Altura en cm. Junto con weight_kg permite a la escuela deducir la talla de neopreno.';

-- Rangos defensivos: evitan que un dedazo (700 kg, 20 cm) entre en la ficha.
alter table public.profiles
  drop constraint if exists profiles_weight_kg_check,
  drop constraint if exists profiles_height_cm_check;
alter table public.profiles
  add constraint profiles_weight_kg_check check (weight_kg is null or (weight_kg > 0 and weight_kg < 300)),
  add constraint profiles_height_cm_check check (height_cm is null or (height_cm > 30 and height_cm < 260));

alter table public.family_members
  drop constraint if exists family_members_weight_kg_check,
  drop constraint if exists family_members_height_cm_check;
alter table public.family_members
  add constraint family_members_weight_kg_check check (weight_kg is null or (weight_kg > 0 and weight_kg < 300)),
  add constraint family_members_height_cm_check check (height_cm is null or (height_cm > 30 and height_cm < 260));
