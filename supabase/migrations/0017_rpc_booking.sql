-- ============================================================
-- 0017_rpc_booking.sql
-- Propósito: RPCs de reserva de clases (versiones FINALES de Entreolas).
--   * book_class        - inscripción atómica del cliente; respeta holds del
--                         picker, valida bono (dueño/activo/no expirado/con
--                         crédito), clase publicada/no pasada, tipo bono=clase,
--                         family_member del caller. FOR UPDATE sobre bono y clase.
--   * cancel_enrollment - cancela inscripciones confirmed/paid/partial con
--                         antelación > 2h; el crédito vuelve al bono vía trigger.
--   * upgrade_bono      - amplía total_credits del propio bono (activo).
--   * enroll_from_webhook - inscripción atómica del webhook de Stripe (service
--                         role); revalida aforo dentro de la tx, on conflict do
--                         nothing, devuelve false y registra warning si inválido/lleno.
-- Todas SECURITY DEFINER, search_path=public, con sus grants/revokes.
-- ============================================================

-- ------------------------------------------------------------
-- book_class — inscripción atómica del cliente (respeta holds del picker)
-- ------------------------------------------------------------
create or replace function public.book_class(
  p_class_id uuid,
  p_bono_id uuid,
  p_family_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bono record;
  v_class record;
  v_member record;
  v_user_id uuid;
  v_enrollment_id uuid;
  v_holds int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'No autenticado'; end if;

  -- Lock bono
  select * into v_bono from public.bonos where id = p_bono_id for update;
  if v_bono is null then raise exception 'Bono no encontrado'; end if;
  if v_bono.user_id != v_user_id then raise exception 'Este bono no te pertenece'; end if;
  if v_bono.status != 'active' then raise exception 'Bono no activo (estado: %)', v_bono.status; end if;
  if v_bono.expires_at < now() then raise exception 'Bono expirado'; end if;
  if v_bono.used_credits >= v_bono.total_credits then raise exception 'Sin créditos disponibles en este bono'; end if;

  -- Lock class
  select * into v_class from public.surf_classes where id = p_class_id for update;
  if v_class is null then raise exception 'Clase no encontrada'; end if;
  if v_class.published is not true or v_class.status <> 'scheduled' then
    raise exception 'Clase no disponible';
  end if;

  -- Aforo = inscripciones confirmadas (materializadas) + holds activos
  select count(*) into v_holds from public.class_holds
  where class_id = p_class_id and held_until > now();
  if (v_class.enrolled_count + v_holds) >= v_class.max_students then raise exception 'Clase completa'; end if;

  if v_class.type != v_bono.class_type then
    raise exception 'El tipo de bono (%) no coincide con la clase (%)', v_bono.class_type, v_class.type;
  end if;
  if (v_class.date + v_class.time_start) < now() then raise exception 'Esta clase ya ha pasado'; end if;

  -- Verificar miembro familiar
  if p_family_member_id is not null then
    select * into v_member from public.family_members where id = p_family_member_id and user_id = v_user_id;
    if v_member is null then raise exception 'Miembro familiar no encontrado o no te pertenece'; end if;
  end if;

  insert into public.class_enrollments (class_id, user_id, family_member_id, bono_id, status)
  values (p_class_id, v_user_id, p_family_member_id, p_bono_id, 'confirmed')
  returning id into v_enrollment_id;

  return v_enrollment_id;
end;
$$;

revoke all on function public.book_class(uuid, uuid, uuid) from public, anon;
grant execute on function public.book_class(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- cancel_enrollment — cancela confirmed/paid/partial con antelación > 2h
-- ------------------------------------------------------------
create or replace function public.cancel_enrollment(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment record;
  v_class record;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'No autenticado'; end if;

  select * into v_enrollment from public.class_enrollments
  where id = p_enrollment_id for update;

  if v_enrollment is null then raise exception 'Inscripción no encontrada'; end if;
  if v_enrollment.user_id != v_user_id then raise exception 'Esta inscripción no te pertenece'; end if;
  if v_enrollment.status not in ('confirmed','paid','partial') then
    raise exception 'Esta inscripción no se puede cancelar';
  end if;

  select * into v_class from public.surf_classes where id = v_enrollment.class_id;
  if (v_class.date + v_class.time_start) < (now() + interval '2 hours') then
    raise exception 'No se puede cancelar con menos de 2 horas de antelación';
  end if;

  update public.class_enrollments
  set status = 'cancelled', updated_at = now()
  where id = p_enrollment_id;
end;
$$;

revoke all on function public.cancel_enrollment(uuid) from public, anon;
grant execute on function public.cancel_enrollment(uuid) to authenticated;

-- ------------------------------------------------------------
-- upgrade_bono — amplía total_credits del propio bono (activo)
-- ------------------------------------------------------------
create or replace function public.upgrade_bono(
  p_bono_id uuid,
  p_new_total_credits int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bono record;
begin
  select * into v_bono from public.bonos where id = p_bono_id for update;
  if not found then raise exception 'Bono no encontrado'; end if;

  if v_bono.user_id != auth.uid() then
    raise exception 'No tienes permiso para modificar este bono';
  end if;
  if v_bono.status != 'active' then
    raise exception 'Solo se pueden ampliar bonos activos';
  end if;
  if p_new_total_credits <= v_bono.total_credits then
    raise exception 'El nuevo número de sesiones debe ser mayor al actual (%)', v_bono.total_credits;
  end if;
  if p_new_total_credits <= v_bono.used_credits then
    raise exception 'El nuevo total no puede ser menor que las sesiones ya usadas (%)', v_bono.used_credits;
  end if;

  update public.bonos
  set total_credits = p_new_total_credits,
      updated_at = now()
  where id = p_bono_id;
end;
$$;

revoke all on function public.upgrade_bono(uuid, integer) from public, anon;
grant execute on function public.upgrade_bono(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- enroll_from_webhook — inscripción atómica del webhook (service_role ONLY)
-- Revalida aforo dentro de la tx; nunca lanza (return false + warning).
-- ------------------------------------------------------------
create or replace function public.enroll_from_webhook(
  p_class_id uuid,
  p_user_id uuid,
  p_family_member_id uuid,
  p_bono_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class record;
  v_active int;
begin
  select * into v_class from public.surf_classes where id = p_class_id for update;
  if v_class is null or v_class.published is not true or v_class.status <> 'scheduled' then
    raise warning 'enroll_from_webhook: clase % no válida (null/no publicada/no scheduled)', p_class_id;
    return false;
  end if;

  select count(*) into v_active from public.class_enrollments
    where class_id = p_class_id and status <> 'cancelled';
  if v_active >= v_class.max_students then
    raise warning 'enroll_from_webhook: clase % LLENA (%/%) — user %, no se inscribe', p_class_id, v_active, v_class.max_students, p_user_id;
    return false;
  end if;

  insert into public.class_enrollments (class_id, user_id, family_member_id, bono_id, status)
  values (p_class_id, p_user_id, p_family_member_id, p_bono_id, 'confirmed')
  on conflict do nothing;
  return true;
exception when others then
  raise warning 'enroll_from_webhook ERROR (clase %, user %, bono %): %', p_class_id, p_user_id, p_bono_id, sqlerrm;
  return false;
end;
$$;

revoke all on function public.enroll_from_webhook(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.enroll_from_webhook(uuid, uuid, uuid, uuid) to service_role;

select pg_notify('pgrst', 'reload schema');
