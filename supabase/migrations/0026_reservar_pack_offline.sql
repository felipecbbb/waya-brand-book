-- ============================================================
-- 0026_reservar_pack_offline.sql
-- RESERVA SIN PASARELA. Replica lo que hace stripe-webhook para un
-- class_reservation, pero SIN pago: el cliente reserva y el bono queda
-- PENDIENTE DE PAGO (total_paid = 0). El admin confirma el pago en el panel
-- (o, cuando esté SumUp, el webhook lo hará online).
--
-- Crea un bono para auth.uid() con total_credits = p_sessions, e inscribe a
-- cada asistente de p_bookings (revalidando aforo por class_enrollments, como
-- enroll_from_webhook). Libera los holds del cart_token al terminar.
--   p_bookings = [{ "classId": uuid, "attendee": {kind:'self'|'family'|'guest',
--                   family_member_id?, guest_data?} }, ...]
-- ============================================================

create or replace function public.reservar_pack_offline(
  p_class_type text,
  p_sessions   int,
  p_bookings   jsonb default '[]'::jsonb,
  p_cart_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_validity int;
  v_bono_id  uuid;
  v_booking  jsonb;
  v_att      jsonb;
  v_gd       jsonb;
  v_kind     text;
  v_fm_id    uuid;
  v_class_id uuid;
  v_class    record;
  v_active   int;
  v_enrolled int := 0;
begin
  if v_user is null then raise exception 'No autenticado'; end if;
  if p_sessions is null or p_sessions < 1 then raise exception 'Pack inválido'; end if;

  -- Validez del bono según la actividad (fallback 180 días)
  select coalesce(pack_validity, 180) into v_validity
    from public.activities where type_key = p_class_type and activo = true limit 1;
  if v_validity is null then v_validity := 180; end if;

  -- Crear el bono PENDIENTE DE PAGO (total_paid = 0)
  insert into public.bonos (user_id, class_type, total_credits, used_credits, total_paid, status, expires_at)
  values (v_user, p_class_type, p_sessions, 0, 0, 'active', now() + (v_validity || ' days')::interval)
  returning id into v_bono_id;

  -- Inscribir cada asistente (revalida aforo por enrollments, como el webhook)
  for v_booking in select * from jsonb_array_elements(coalesce(p_bookings, '[]'::jsonb))
  loop
    v_class_id := nullif(v_booking->>'classId','')::uuid;
    if v_class_id is null then continue; end if;
    v_att  := v_booking->'attendee';
    v_kind := coalesce(v_att->>'kind', 'self');
    v_fm_id := null;

    if v_kind = 'family' then
      v_fm_id := nullif(v_att->>'family_member_id','')::uuid;
      perform 1 from public.family_members where id = v_fm_id and user_id = v_user;
      if not found then continue; end if;  -- familiar no pertenece al usuario
    elsif v_kind = 'guest' then
      v_gd := v_att->'guest_data';
      insert into public.family_members
        (user_id, full_name, last_name, birth_date, level, wetsuit_size, can_swim, has_injury, injury_detail)
      values (
        v_user,
        coalesce(v_gd->>'full_name',''),
        nullif(v_gd->>'last_name',''),
        nullif(v_gd->>'birth_date','')::date,
        nullif(v_gd->>'level',''),
        nullif(v_gd->>'wetsuit_size',''),
        nullif(v_gd->>'can_swim','')::boolean,
        coalesce(nullif(v_gd->>'has_injury','')::boolean, false),
        nullif(v_gd->>'injury_detail','')
      ) returning id into v_fm_id;
    end if;  -- self → v_fm_id queda null

    -- Revalidar aforo e inscribir (espejo de enroll_from_webhook)
    select * into v_class from public.surf_classes where id = v_class_id for update;
    if v_class is null or v_class.published is not true or v_class.status <> 'scheduled' then continue; end if;
    if v_class.type <> p_class_type then continue; end if;
    select count(*) into v_active from public.class_enrollments
      where class_id = v_class_id and status <> 'cancelled';
    if v_active >= v_class.max_students then continue; end if;

    insert into public.class_enrollments (class_id, user_id, family_member_id, bono_id, status)
    values (v_class_id, v_user, v_fm_id, v_bono_id, 'confirmed')
    on conflict do nothing;
    v_enrolled := v_enrolled + 1;
  end loop;

  -- Liberar los holds del token
  if p_cart_token is not null and p_cart_token <> '' then
    delete from public.class_holds where cart_token = p_cart_token;
  end if;

  return jsonb_build_object('bono_id', v_bono_id, 'enrolled', v_enrolled, 'total_credits', p_sessions);
end;
$$;

comment on function public.reservar_pack_offline is 'Reserva sin pasarela: crea bono pendiente de pago + inscribe asistentes. Admin confirma pago.';

revoke execute on function public.reservar_pack_offline(text, int, jsonb, text) from anon, public;
grant execute on function public.reservar_pack_offline(text, int, jsonb, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
