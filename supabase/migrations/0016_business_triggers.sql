-- ============================================================
-- 0016_business_triggers.sql
-- Propósito: versiones FINALES de las funciones-trigger de negocio y sus
-- triggers. Materializan contadores derivados:
--   * surf_classes.enrolled_count  <- update_enrolled_count()  (cuenta toda
--     inscripción NO cancelada; en un "move" recalcula clase vieja Y nueva).
--   * bonos.used_credits / status  <- update_bono_credits()    (cuenta toda
--     inscripción NO cancelada; status -> 'exhausted' si used>=total,
--     preserva 'cancelled'/'expired').
--   * surf_camps.spots_taken / status <- update_spots_on_booking() (ocupante =
--     status in ('deposit_paid','fully_paid'); simétrico INSERT/UPDATE/DELETE;
--     alterna 'full' <-> 'open').
-- Se crean LOS DOS triggers de class_enrollments (aforo de clase + créditos de
-- bono) además del de bookings. Las funciones-trigger no son invocables como RPC.
-- Portado literalmente de Entreolas (versión final de cada objeto).
-- ============================================================

-- ------------------------------------------------------------
-- 1) enrolled_count de la clase: contar inscripciones no canceladas.
--    En UPDATE con cambio de class_id recalcula la clase vieja y la nueva.
-- ------------------------------------------------------------
create or replace function public.update_enrolled_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    update public.surf_classes
    set enrolled_count = (
      select count(*) from public.class_enrollments
      where class_id = OLD.class_id and status <> 'cancelled'
    )
    where id = OLD.class_id;
    return OLD;

  elsif TG_OP = 'UPDATE' then
    update public.surf_classes
    set enrolled_count = (
      select count(*) from public.class_enrollments
      where class_id = NEW.class_id and status <> 'cancelled'
    )
    where id = NEW.class_id;

    if OLD.class_id is distinct from NEW.class_id then
      update public.surf_classes
      set enrolled_count = (
        select count(*) from public.class_enrollments
        where class_id = OLD.class_id and status <> 'cancelled'
      )
      where id = OLD.class_id;
    end if;
    return NEW;

  else -- INSERT
    update public.surf_classes
    set enrolled_count = (
      select count(*) from public.class_enrollments
      where class_id = NEW.class_id and status <> 'cancelled'
    )
    where id = NEW.class_id;
    return NEW;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 2) used_credits / status del bono: contar inscripciones no canceladas.
--    Preserva estados terminales 'cancelled'/'expired'.
-- ------------------------------------------------------------
create or replace function public.update_bono_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
begin
  if TG_OP = 'DELETE' then
    select count(*) into v_used from public.class_enrollments
    where bono_id = OLD.bono_id and status <> 'cancelled';
    update public.bonos
    set used_credits = v_used,
        status = case
          when status in ('cancelled','expired') then status
          when v_used >= total_credits then 'exhausted'
          else 'active'
        end,
        updated_at = now()
    where id = OLD.bono_id;
    return OLD;
  else
    select count(*) into v_used from public.class_enrollments
    where bono_id = NEW.bono_id and status <> 'cancelled';
    update public.bonos
    set used_credits = v_used,
        status = case
          when status in ('cancelled','expired') then status
          when v_used >= total_credits then 'exhausted'
          else 'active'
        end,
        updated_at = now()
    where id = NEW.bono_id;
    return NEW;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3) spots_taken / status del camp: simétrico y completo (INSERT/UPDATE/DELETE).
--    Ocupante = reserva en ('deposit_paid','fully_paid').
-- ------------------------------------------------------------
create or replace function public.update_spots_on_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_occ boolean := (TG_OP <> 'INSERT') and (OLD.status in ('deposit_paid','fully_paid'));
  v_new_occ boolean := (TG_OP <> 'DELETE') and (NEW.status in ('deposit_paid','fully_paid'));
  v_camp uuid := case when TG_OP = 'DELETE' then OLD.camp_id else NEW.camp_id end;
begin
  if v_camp is null then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if v_new_occ and not v_old_occ then
    update public.surf_camps
    set spots_taken = spots_taken + 1,
        status = case when status <> 'closed' and spots_taken + 1 >= max_spots then 'full' else status end
    where id = v_camp;
  elsif v_old_occ and not v_new_occ then
    update public.surf_camps
    set spots_taken = greatest(spots_taken - 1, 0),
        status = case when status = 'full' and greatest(spots_taken - 1, 0) < max_spots then 'open' else status end
    where id = v_camp;
  end if;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

-- ------------------------------------------------------------
-- 4) Triggers (idempotentes)
-- ------------------------------------------------------------
drop trigger if exists on_enrollment_change on public.class_enrollments;
create trigger on_enrollment_change
  after insert or update or delete on public.class_enrollments
  for each row execute function public.update_enrolled_count();

drop trigger if exists on_enrollment_bono_change on public.class_enrollments;
create trigger on_enrollment_bono_change
  after insert or update or delete on public.class_enrollments
  for each row execute function public.update_bono_credits();

drop trigger if exists on_booking_status_change on public.bookings;
create trigger on_booking_status_change
  after insert or update or delete on public.bookings
  for each row execute function public.update_spots_on_booking();

-- ------------------------------------------------------------
-- 5) Hardening: las funciones-trigger no deben ser invocables como RPC
-- ------------------------------------------------------------
revoke execute on function public.update_enrolled_count()  from anon, authenticated, public;
revoke execute on function public.update_bono_credits()    from anon, authenticated, public;
revoke execute on function public.update_spots_on_booking() from anon, authenticated, public;

select pg_notify('pgrst', 'reload schema');
