-- ============================================================
-- 0019_rpc_commerce.sql
-- Propósito: RPCs de comercio (stock, alquiler, cupones) — versiones FINALES.
--   * decrement_product_stock - descuenta stock atómico de la variante exacta
--                               (color×talla) o del stock simple. FOR UPDATE.
--                               service_role ONLY (lo llama el webhook).
--   * assign_rental_unit       - auto-asigna una inventory_unit 'disponible' de
--                               la talla pedida sin solape de fechas. FOR UPDATE
--                               OF u SKIP LOCKED. service_role ONLY.
--   * get_rental_stock         - conteo público de unidades disponibles por
--                               (equipo, talla), sin PII. anon + authenticated.
--   * get_coupon               - devuelve un cupón SOLO si el código exacto está
--                               activo (evita listar todos los códigos). anon+auth.
--   * increment_coupon_usage   - +1 a used_count. authenticated + service_role.
-- Portado literalmente de Entreolas (versión final de cada objeto).
-- ============================================================

-- ------------------------------------------------------------
-- decrement_product_stock — descuento atómico de stock (service_role ONLY)
-- ------------------------------------------------------------
create or replace function public.decrement_product_stock(
  p_id uuid,
  p_color text,
  p_size text,
  p_qty int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ss jsonb; has_color bool; has_size bool; done bool := false;
  new_ss jsonb := '[]'::jsonb; elem jsonb; total int := 0;
begin
  select sizes_stock into ss from public.products where id = p_id for update;
  if ss is null or jsonb_array_length(ss) = 0 then
    update public.products set stock = greatest(coalesce(stock, 0) - p_qty, 0) where id = p_id;
    return;
  end if;
  select bool_or(coalesce(e->>'color','') <> ''), bool_or(coalesce(e->>'size','') <> '')
    into has_color, has_size from jsonb_array_elements(ss) e;
  for elem in select * from jsonb_array_elements(ss) loop
    if not done
       and (not coalesce(has_color, false) or coalesce(elem->>'color','') = coalesce(p_color,''))
       and (not coalesce(has_size, false)  or coalesce(elem->>'size','')  = coalesce(p_size,'')) then
      elem := jsonb_set(elem, '{stock}', to_jsonb(greatest(coalesce((elem->>'stock')::int, 0) - p_qty, 0)));
      done := true;
    end if;
    new_ss := new_ss || elem;
    total := total + coalesce((elem->>'stock')::int, 0);
  end loop;
  update public.products set sizes_stock = new_ss, stock = total where id = p_id;
end;
$$;

revoke all on function public.decrement_product_stock(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.decrement_product_stock(uuid, text, text, int) to service_role;

-- ------------------------------------------------------------
-- assign_rental_unit — auto-asignación de unidad física (service_role ONLY)
-- ------------------------------------------------------------
create or replace function public.assign_rental_unit(p_reservation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eq uuid; v_size text; v_ds date; v_de date; v_assigned uuid; v_unit uuid;
begin
  select equipment_id, size, date_start, date_end, assigned_unit_id
    into v_eq, v_size, v_ds, v_de, v_assigned
  from public.equipment_reservations where id = p_reservation_id;
  if not found or v_eq is null then return null; end if;
  if v_assigned is not null then return v_assigned; end if;

  select u.id into v_unit
  from public.inventory_units u
  where u.equipment_id = v_eq
    and u.estado = 'disponible'
    and ( v_size is null
          or coalesce(
               case when u.category = 'tabla' and u.pies is not null
                    then trunc(u.pies)::int::text || '''' || round((u.pies - trunc(u.pies))*10)::int::text
                    else u.talla end, '') = coalesce(v_size, '') )
    and not exists (
      select 1 from public.equipment_reservations r2
      where r2.assigned_unit_id = u.id
        and r2.id <> p_reservation_id
        and r2.status in ('pending','confirmed','active')
        and r2.date_start <= v_de and r2.date_end >= v_ds )
  order by random()
  limit 1
  for update of u skip locked;

  if v_unit is null then return null; end if;
  update public.equipment_reservations
    set assigned_unit_id = v_unit, updated_at = now()
    where id = p_reservation_id;
  return v_unit;
end;
$$;

revoke all on function public.assign_rental_unit(uuid) from public, anon, authenticated;
grant execute on function public.assign_rental_unit(uuid) to service_role;

-- ------------------------------------------------------------
-- get_rental_stock — conteo público de unidades disponibles (sin PII)
-- ------------------------------------------------------------
create or replace function public.get_rental_stock()
returns table(equipment_id uuid, size text, available int)
language sql
stable
security definer
set search_path = public
as $$
  select equipment_id,
         case when category='tabla' and pies is not null
              then trunc(pies)::int::text || '''' || round((pies - trunc(pies))*10)::int::text
              else talla end as size,
         count(*)::int as available
  from public.inventory_units
  where equipment_id is not null and estado = 'disponible'
  group by 1, 2;
$$;

grant execute on function public.get_rental_stock() to anon, authenticated;

-- ------------------------------------------------------------
-- get_coupon — valida el código server-side (no lista todos los cupones)
-- ------------------------------------------------------------
create or replace function public.get_coupon(p_code text)
returns setof public.coupons
language sql
stable
security definer
set search_path = public
as $$
  select * from public.coupons
  where upper(code) = upper(p_code) and active = true
  limit 1;
$$;

revoke all on function public.get_coupon(text) from public, anon, authenticated;
grant execute on function public.get_coupon(text) to anon, authenticated;

-- ------------------------------------------------------------
-- increment_coupon_usage — +1 a used_count
-- ------------------------------------------------------------
create or replace function public.increment_coupon_usage(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coupons
  set used_count = used_count + 1, updated_at = now()
  where id = p_coupon_id;
end;
$$;

revoke all on function public.increment_coupon_usage(uuid) from public, anon;
grant execute on function public.increment_coupon_usage(uuid) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
