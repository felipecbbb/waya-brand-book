-- ============================================================
-- 0036_packs_en_pasarela.sql
-- LOS PACKS DE CLASES PASAN POR LA PASARELA.
--
-- Hasta ahora el calendario de clases llamaba a reservar_pack_offline: creaba
-- el bono sin cobrar nada. Peor: si el cliente no llegaba a asignar clases, el
-- bono se creaba con 0 inscripciones y daba la sensación de que "no se había
-- guardado la reserva" — que es justo lo que pasó (dos bonos a 0/3 créditos y
-- cero clases asociadas).
--
-- Ahora el pack se paga primero y el bono + las inscripciones se crean cuando
-- el cobro está confirmado. Un pago = un bono con sus clases dentro.
--
-- El precio sale de activity_packs (sesiones + tipo de clase), nunca del
-- navegador.
-- ============================================================

-- ---------- 1. Precio de un pack en el cálculo del carrito ----------
create or replace function public.calcular_importe_carrito(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item     jsonb;
  v_tipo     text;
  v_id       uuid;
  v_qty      int;
  v_precio   numeric(10,2);
  v_total    numeric(10,2) := 0;
  v_dur      text;
  v_out      jsonb := '[]'::jsonb;
  v_camp     public.surf_camps%rowtype;
  v_eq       public.rental_equipment%rowtype;
  v_ctype    text;
  v_sess     int;
  v_act      text;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_tipo := v_item->>'type';
    v_qty  := greatest(coalesce(nullif(v_item->>'quantity','')::int, 1), 1);

    if v_tipo = 'camp' then
      v_id := nullif(v_item->'metadata'->>'campId','')::uuid;
      select * into v_camp from public.surf_camps where id = v_id;
      if not found then raise exception 'Surfcamp no encontrado'; end if;
      if v_camp.status = 'closed' or v_camp.sold_out then
        raise exception 'El surfcamp "%" ya no admite reservas', v_camp.title;
      end if;
      v_precio := coalesce(v_camp.deposit, 0);
      if v_precio <= 0 then
        raise exception 'El surfcamp "%" no tiene señal configurada', v_camp.title;
      end if;
      v_out := v_out || jsonb_build_object(
        'type','camp','campId',v_id,'qty',1,
        'unit',v_precio,'subtotal',v_precio,
        'total_amount', coalesce(v_camp.price, v_precio),
        'name', v_camp.title);
      v_total := v_total + v_precio;

    elsif v_tipo = 'rental' then
      v_id  := nullif(v_item->'metadata'->>'equipmentId','')::uuid;
      v_dur := nullif(v_item->'metadata'->>'duration','');
      select * into v_eq from public.rental_equipment where id = v_id;
      if not found then raise exception 'Material de alquiler no encontrado'; end if;
      if v_dur is null then raise exception 'Falta la duración del alquiler'; end if;
      v_precio := nullif(v_eq.pricing->>v_dur, '')::numeric;
      if v_precio is null or v_precio <= 0 then
        raise exception 'No hay precio para "%" con duración %', v_eq.name, v_dur;
      end if;
      v_out := v_out || jsonb_build_object(
        'type','rental','equipmentId',v_id,'qty',v_qty,'duration',v_dur,
        'unit',v_precio,'subtotal',v_precio * v_qty,
        'dateStart', nullif(v_item->'metadata'->>'dateStart',''),
        'dateEnd',   nullif(v_item->'metadata'->>'dateEnd',''),
        'size',      nullif(v_item->'metadata'->>'size',''),
        'name', v_eq.name);
      v_total := v_total + v_precio * v_qty;

    elsif v_tipo = 'pack' then
      -- Pack de clases: el precio lo fija activity_packs por (tipo, sesiones).
      v_ctype := nullif(v_item->'metadata'->>'classType','');
      v_sess  := nullif(v_item->'metadata'->>'sessions','')::int;
      if v_ctype is null or v_sess is null or v_sess < 1 then
        raise exception 'Pack de clases incompleto';
      end if;

      select p.price, a.nombre into v_precio, v_act
        from public.activity_packs p
        join public.activities a on a.id = p.activity_id
       where a.type_key = v_ctype
         and p.sessions = v_sess
         and p.public is true
       order by p.sort_order
       limit 1;

      if v_precio is null then
        raise exception 'No hay pack publicado de % con % sesiones', v_ctype, v_sess;
      end if;

      v_out := v_out || jsonb_build_object(
        'type','pack','classType',v_ctype,'sessions',v_sess,'qty',1,
        'unit',v_precio,'subtotal',v_precio,
        -- Las clases elegidas se arrastran para inscribirlas tras el cobro.
        'bookings', coalesce(v_item->'metadata'->'bookings', '[]'::jsonb),
        'name', coalesce(v_act, 'Pack de clases') || ' · ' || v_sess || ' sesión' ||
                case when v_sess > 1 then 'es' else '' end);
      v_total := v_total + v_precio;

    else
      raise exception 'Tipo de artículo no admitido: %', coalesce(v_tipo,'(vacío)');
    end if;
  end loop;

  if v_total <= 0 then raise exception 'El carrito está vacío'; end if;
  return jsonb_build_object('total', v_total, 'items', v_out);
end;
$$;

revoke all on function public.calcular_importe_carrito(jsonb) from public, anon;
grant execute on function public.calcular_importe_carrito(jsonb) to authenticated;

-- ---------- 2. Crear el bono y las inscripciones al confirmar el pago ----------
-- Se apoya en reservar_pack_offline, que ya sabe crear bono + inscripciones,
-- validar aforo y respetar los holds. Aquí solo se invoca una vez cobrado, y
-- se marca el bono como pagado.
create or replace function public.crear_pack_pagado(
  p_user      uuid,
  p_classType text,
  p_sessions  int,
  p_bookings  jsonb,
  p_importe   numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bono uuid;
  v_validity int;
begin
  -- La columna es pack_validity (no bono_validity_days), igual que en 0026.
  select coalesce(pack_validity, 180) into v_validity
    from public.activities where type_key = p_classType and activo = true limit 1;
  if v_validity is null then v_validity := 180; end if;

  insert into public.bonos (user_id, class_type, total_credits, used_credits,
                            total_paid, status, expires_at)
  values (p_user, p_classType, p_sessions, 0, p_importe, 'active',
          now() + (v_validity || ' days')::interval)
  returning id into v_bono;

  -- Inscribir las clases elegidas. Se reutiliza la lógica de validación de
  -- aforo insertando aquí mismo: una clase llena o despublicada se salta y el
  -- crédito queda disponible en el bono.
  insert into public.class_enrollments (class_id, user_id, family_member_id, bono_id, status)
  select (b->>'classId')::uuid,
         p_user,
         nullif(b->'attendee'->>'family_member_id','')::uuid,
         v_bono,
         'confirmed'
    from jsonb_array_elements(coalesce(p_bookings, '[]'::jsonb)) b
    join public.surf_classes c on c.id = (b->>'classId')::uuid
   where c.published is true
     and c.status = 'scheduled'
     and c.type = p_classType;

  update public.bonos
     set used_credits = (select count(*) from public.class_enrollments where bono_id = v_bono)
   where id = v_bono;

  return v_bono;
end;
$$;

revoke all on function public.crear_pack_pagado(uuid, text, int, jsonb, numeric) from public, anon, authenticated;

-- ---------- 3. Enlazarlo en la confirmación del pago ----------
create or replace function public.confirmar_pago_sumup(p_referencia uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row     public.pending_checkouts%rowtype;
  v_key     text;
  v_resp    extensions.http_response;
  v_json    jsonb;
  v_estado  text;
  v_item    jsonb;
  v_creadas int := 0;
begin
  select * into v_row from public.pending_checkouts where id = p_referencia;
  if not found then raise exception 'Checkout no encontrado'; end if;

  if v_row.status = 'paid' then
    return jsonb_build_object('ok', true, 'ya_procesado', true, 'importe', v_row.amount);
  end if;

  select valor into v_key from public.app_secrets where clave = 'sumup_api_key';
  if coalesce(v_key,'') = '' then raise exception 'Falta la clave de SumUp'; end if;

  select * into v_resp from extensions.http((
    'GET',
    'https://api.sumup.com/v0.1/checkouts/' || v_row.sumup_checkout_id,
    array[extensions.http_header('Authorization', 'Bearer ' || v_key)],
    NULL, NULL
  )::extensions.http_request);

  if v_resp.status <> 200 then
    raise exception 'SumUp devolvió % al consultar el checkout', v_resp.status;
  end if;

  v_json   := v_resp.content::jsonb;
  v_estado := upper(coalesce(v_json->>'status',''));
  update public.pending_checkouts set sumup_status = v_estado where id = v_row.id;

  if v_estado <> 'PAID' then
    if v_estado = 'FAILED' then
      update public.pending_checkouts set status = 'failed' where id = v_row.id;
    end if;
    return jsonb_build_object('ok', false, 'estado', v_estado);
  end if;

  for v_item in select * from jsonb_array_elements(v_row.items) loop
    if v_item->>'type' = 'camp' then
      insert into public.bookings
        (user_id, camp_id, status, deposit_amount, total_amount, payment_method)
      values
        (v_row.user_id, (v_item->>'campId')::uuid, 'deposit_paid',
         (v_item->>'subtotal')::numeric, (v_item->>'total_amount')::numeric, 'sumup');
      v_creadas := v_creadas + 1;

    elsif v_item->>'type' = 'rental' then
      insert into public.equipment_reservations
        (equipment_id, user_id, date_start, date_end, duration_key,
         quantity, status, total_amount, deposit_paid)
      values
        ((v_item->>'equipmentId')::uuid, v_row.user_id,
         coalesce((v_item->>'dateStart')::date, current_date),
         coalesce((v_item->>'dateEnd')::date, current_date),
         coalesce(v_item->>'duration','1d'),
         coalesce((v_item->>'qty')::int, 1),
         'confirmed',
         (v_item->>'subtotal')::numeric,
         (v_item->>'subtotal')::numeric);
      v_creadas := v_creadas + 1;

    elsif v_item->>'type' = 'pack' then
      perform public.crear_pack_pagado(
        v_row.user_id,
        v_item->>'classType',
        (v_item->>'sessions')::int,
        v_item->'bookings',
        (v_item->>'subtotal')::numeric);
      v_creadas := v_creadas + 1;
    end if;
  end loop;

  insert into public.payments
    (reservation_type, reference_id, amount, payment_method, channel, concept)
  values
    ('booking', v_row.id, v_row.amount, 'online', 'web',
     'Pago SumUp ' || coalesce(v_row.sumup_checkout_id,''));

  update public.pending_checkouts set status = 'paid', paid_at = now() where id = v_row.id;

  return jsonb_build_object('ok', true, 'reservas_creadas', v_creadas, 'importe', v_row.amount);
end;
$$;

revoke all on function public.confirmar_pago_sumup(uuid) from public, anon, authenticated;
