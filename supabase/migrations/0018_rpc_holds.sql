-- ============================================================
-- 0018_rpc_holds.sql
-- Propósito: RPCs de holds (plazas apartadas 10 min) y disponibilidad de clases.
-- La tabla public.class_holds tiene RLS activa SIN políticas: solo accesible
-- vía estas funciones SECURITY DEFINER.
--   * create_hold           - aparta p_qty plazas para un cart_token (10 min).
--                             Cada hold caduca por sí mismo (versión final: NO
--                             reextiende los demás holds del token). Aforo =
--                             max_students - enrolled_count - holds activos.
--   * release_class_holds   - libera las plazas de UNA clase para un token.
--   * release_holds         - libera TODAS las plazas de un token.
--   * fetch_class_availability - clases publicadas+scheduled de un día con
--                             holds_count/confirmed_count/spots_taken/spots_left.
-- Grants: anon + authenticated (el picker público las usa sin login).
-- Portado literalmente de Entreolas (versión final de cada objeto).
-- ============================================================

-- ------------------------------------------------------------
-- fetch_class_availability — disponibilidad real por día (confirmadas + holds)
-- ------------------------------------------------------------
create or replace function public.fetch_class_availability(
  p_date  date,
  p_type  text default null,
  p_level text default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(c) || jsonb_build_object(
    'holds_count', coalesce(h.cnt, 0),
    'confirmed_count', c.enrolled_count,
    'spots_taken', c.enrolled_count + coalesce(h.cnt, 0),
    'spots_left', greatest(c.max_students - c.enrolled_count - coalesce(h.cnt, 0), 0)
  )
  from public.surf_classes c
  left join lateral (
    select count(*) as cnt
    from public.class_holds ch
    where ch.class_id = c.id and ch.held_until > now()
  ) h on true
  where c.date = p_date
    and c.published = true
    and c.status = 'scheduled'
    and (p_type is null or c.type = p_type)
    and (p_level is null or p_level = 'todos' or c.level = p_level or c.level = 'todos')
  order by c.time_start;
$$;

-- ------------------------------------------------------------
-- create_hold — aparta p_qty plazas para un cart_token (caducan a los 10 min)
-- ------------------------------------------------------------
create or replace function public.create_hold(
  p_class_id   uuid,
  p_cart_token text,
  p_qty        int default 1
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class   public.surf_classes%rowtype;
  v_active  int;
  v_left    int;
  v_until   timestamptz := now() + interval '10 minutes';
begin
  if p_cart_token is null or length(p_cart_token) < 8 then
    raise exception 'Token de carrito inválido';
  end if;
  if p_qty < 1 then
    raise exception 'Cantidad inválida';
  end if;

  -- Lock de la clase para evitar carreras
  select * into v_class from public.surf_classes where id = p_class_id for update;
  if not found then raise exception 'Clase no encontrada'; end if;
  if v_class.published is not true or v_class.status <> 'scheduled' then
    raise exception 'Clase no disponible';
  end if;

  -- Plazas ocupadas = inscripciones confirmadas + holds activos (cualquier token)
  select count(*) into v_active from public.class_holds
  where class_id = p_class_id and held_until > now();

  v_left := v_class.max_students - v_class.enrolled_count - v_active;
  if v_left < p_qty then
    raise exception 'No quedan plazas suficientes (disponibles: %)', greatest(v_left, 0);
  end if;

  insert into public.class_holds (class_id, cart_token, held_until)
  select p_class_id, p_cart_token, v_until from generate_series(1, p_qty);

  return v_until;
end;
$$;

-- ------------------------------------------------------------
-- release_class_holds — libera las plazas de UNA clase para un token
-- ------------------------------------------------------------
create or replace function public.release_class_holds(
  p_class_id   uuid,
  p_cart_token text,
  p_qty        int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qty is null then
    delete from public.class_holds
    where cart_token = p_cart_token and class_id = p_class_id;
  else
    delete from public.class_holds
    where id in (
      select id from public.class_holds
      where cart_token = p_cart_token and class_id = p_class_id
      limit p_qty
    );
  end if;
end;
$$;

-- ------------------------------------------------------------
-- release_holds — libera TODAS las plazas de un token
-- ------------------------------------------------------------
create or replace function public.release_holds(p_cart_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.class_holds where cart_token = p_cart_token;
$$;

-- ------------------------------------------------------------
-- Grants: anon + authenticated
-- ------------------------------------------------------------
grant execute on function public.fetch_class_availability(date, text, text) to anon, authenticated;
grant execute on function public.create_hold(uuid, text, int)               to anon, authenticated;
grant execute on function public.release_class_holds(uuid, text, int)        to anon, authenticated;
grant execute on function public.release_holds(text)                         to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
