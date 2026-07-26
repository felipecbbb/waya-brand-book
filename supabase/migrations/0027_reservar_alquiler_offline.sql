-- ============================================================
-- 0027_reservar_alquiler_offline.sql
-- ALQUILER SIN PASARELA. Replica lo que hace stripe-webhook para los items
-- 'rental' del carrito, pero SIN pago: crea equipment_reservations PENDIENTES
-- (deposit_paid = 0) + asigna unidad física. El admin confirma el pago.
--   p_items = items del carrito (solo se procesan los type='rental'):
--     [{ type:'rental', quantity, price, metadata:{equipmentId, dateStart,
--        dateEnd, duration, size, totalAmount} }, ...]
-- ============================================================

create or replace function public.reservar_alquiler_offline(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_item  jsonb;
  v_md    jsonb;
  v_res_id uuid;
  v_count int := 0;
  v_ids   uuid[] := '{}';
begin
  if v_user is null then raise exception 'No autenticado'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if coalesce(v_item->>'type','') <> 'rental' then continue; end if;
    v_md := v_item->'metadata';
    if nullif(v_md->>'equipmentId','') is null then continue; end if;

    insert into public.equipment_reservations
      (equipment_id, user_id, date_start, date_end, duration_key, size, quantity,
       status, total_amount, deposit_paid)
    values (
      (v_md->>'equipmentId')::uuid,
      v_user,
      coalesce(nullif(v_md->>'dateStart','')::date, current_date),
      coalesce(nullif(v_md->>'dateEnd','')::date, current_date),
      coalesce(nullif(v_md->>'duration',''), '1d'),
      nullif(v_md->>'size',''),
      coalesce((v_item->>'quantity')::int, 1),
      'pending',
      coalesce((v_md->>'totalAmount')::numeric, (v_item->>'price')::numeric, 0),
      0
    ) returning id into v_res_id;

    -- Asignar unidad física (assign_rental_unit es service_role; esta función es
    -- SECURITY DEFINER, así que puede invocarla). Si falla, no rompe la reserva.
    begin
      perform public.assign_rental_unit(v_res_id);
    exception when others then
      raise warning 'assign_rental_unit fallo para %: %', v_res_id, sqlerrm;
    end;

    v_ids := array_append(v_ids, v_res_id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('reservations', v_count, 'ids', to_jsonb(v_ids));
end;
$$;

comment on function public.reservar_alquiler_offline is 'Alquiler sin pasarela: crea equipment_reservations pendientes + asigna unidad. Admin confirma pago.';

revoke execute on function public.reservar_alquiler_offline(jsonb) from anon, public;
grant execute on function public.reservar_alquiler_offline(jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
