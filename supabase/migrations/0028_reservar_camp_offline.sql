-- ============================================================
-- 0028_reservar_camp_offline.sql
-- RESERVA DE SURFCAMP SIN PASARELA. Procesa los items type='camp' del
-- carrito y crea una reserva (public.bookings) PENDIENTE de pago: el cliente
-- reserva su plaza con señal y el importe queda pendiente (se abona en la
-- escuela / antes del trip). El trigger update_spots_on_booking (0016)
-- incrementa surf_camps.spots_taken automáticamente. Cuando esté SumUp, el
-- cobro de la señal pasará a ser online sin cambiar este flujo.
--
--   p_items = items del carrito (solo se procesan los type='camp'):
--     [{ type:'camp', price:<señal>, metadata:{ campId:uuid, totalAmount:<precio> } }, ...]
-- ============================================================

create or replace function public.reservar_camp_offline(
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_item     jsonb;
  v_camp     uuid;
  v_deposit  numeric(8,2);
  v_total    numeric(8,2);
  v_camp_rec record;
  v_created  int := 0;
begin
  if v_user is null then raise exception 'No autenticado'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if coalesce(v_item->>'type','') <> 'camp' then continue; end if;

    v_camp := nullif(v_item->'metadata'->>'campId','')::uuid;
    if v_camp is null then continue; end if;

    v_deposit := coalesce(nullif(v_item->>'price','')::numeric, 0);
    v_total   := coalesce(nullif(v_item->'metadata'->>'totalAmount','')::numeric, v_deposit);

    -- Bloquea la fila del camp y valida disponibilidad
    select * into v_camp_rec from public.surf_camps where id = v_camp for update;
    if v_camp_rec is null then continue; end if;
    if v_camp_rec.status = 'closed' or v_camp_rec.sold_out
       or v_camp_rec.spots_taken >= v_camp_rec.max_spots then
      raise exception 'El surfcamp "%" ya no tiene plazas disponibles', v_camp_rec.title;
    end if;

    -- Evita duplicar una reserva activa del mismo usuario para el mismo camp
    perform 1 from public.bookings
      where camp_id = v_camp and user_id = v_user
        and status in ('pending','deposit_paid','fully_paid');
    if found then continue; end if;

    -- Crea la reserva PENDIENTE (el trigger 0016 sube spots_taken)
    insert into public.bookings (user_id, camp_id, status, deposit_amount, total_amount, payment_method)
    values (v_user, v_camp, 'pending', v_deposit, v_total, 'presencial');
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('bookings', v_created);
end;
$$;

comment on function public.reservar_camp_offline is 'Reserva de surfcamp sin pasarela: crea booking pendiente (señal) + el trigger sube spots_taken. Admin confirma pago.';

revoke execute on function public.reservar_camp_offline(jsonb) from anon, public;
grant  execute on function public.reservar_camp_offline(jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
