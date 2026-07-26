-- ============================================================
-- 0020_rpc_admin.sql
-- Propósito: RPCs de administración / contabilidad (versiones FINALES).
--   * get_user_email    - email de un usuario; gate propio o is_admin().
--   * get_user_payments - historial de pagos de un usuario (enrollments/rentals/
--                         bookings/bonos/orders + custom sobre el propio user).
--                         Gate propio o is_admin() (staff que registra pagos vía
--                         la política enc_can de payments en 0021 — CONTRATO §3.1).
--   * get_bono_payments - pagos de un bono. FIX WAYA: filtra
--                         reservation_type IN ('bono','enrollment') (Entreolas
--                         solo miraba 'enrollment' y perdía los cobros de bono
--                         unificados). Gate dueño del bono o is_admin().
--   * delete_user       - borra un usuario (cascade auth.users). No self-delete;
--                         requiere is_strict_admin() (cambio WAYA respecto a
--                         is_admin de Entreolas).
-- Portado de Entreolas (versión final de cada objeto) con los fixes WAYA marcados.
-- ============================================================

-- ------------------------------------------------------------
-- get_user_email — email propio o de cualquiera si is_admin()
-- ------------------------------------------------------------
create or replace function public.get_user_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email from auth.users u
  where u.id = p_user_id
    and (p_user_id = auth.uid() or public.is_admin());
$$;

revoke all on function public.get_user_email(uuid) from public, anon;
grant execute on function public.get_user_email(uuid) to authenticated;

-- ------------------------------------------------------------
-- get_user_payments — pagos propios o de cualquiera si is_admin()
-- (staff que gestiona pagos; coherente con la política enc_can de payments)
-- ------------------------------------------------------------
create or replace function public.get_user_payments(p_user_id uuid)
returns setof public.payments
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.payments p
  where (p_user_id = auth.uid() or public.is_admin())
    and (
      p.reference_id in (
        select id from public.class_enrollments      where user_id = p_user_id
        union all select id from public.equipment_reservations where user_id = p_user_id
        union all select id from public.bookings      where user_id = p_user_id
        union all select id from public.bonos         where user_id = p_user_id
        union all select id from public.orders        where user_id = p_user_id
      )
      or (p.reservation_type = 'custom' and p.reference_id = p_user_id)
    )
  order by p.payment_date desc;
$$;

revoke all on function public.get_user_payments(uuid) from public, anon;
grant execute on function public.get_user_payments(uuid) to authenticated;

-- ------------------------------------------------------------
-- get_bono_payments — pagos de un bono. FIX WAYA: 'bono' + 'enrollment'
-- ------------------------------------------------------------
create or replace function public.get_bono_payments(p_bono_id uuid)
returns setof public.payments
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.payments p
  where p.reservation_type in ('bono','enrollment')   -- FIX WAYA (Entreolas: solo 'enrollment')
    and (
      -- cobros de bono: reference_id = bono.id
      (p.reservation_type = 'bono' and p.reference_id = p_bono_id)
      -- cobros de clase sueltos: reference_id = enrollment ligado al bono
      or (p.reservation_type = 'enrollment'
          and p.reference_id in (select id from public.class_enrollments where bono_id = p_bono_id))
    )
    and (
      public.is_admin()
      or exists (select 1 from public.bonos b where b.id = p_bono_id and b.user_id = auth.uid())
    )
  order by p.payment_date desc;
$$;

revoke all on function public.get_bono_payments(uuid) from public, anon;
grant execute on function public.get_bono_payments(uuid) to authenticated;

-- ------------------------------------------------------------
-- delete_user — borra usuario (cascade). No self-delete; is_strict_admin() (WAYA)
-- ------------------------------------------------------------
create or replace function public.delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Prevent self-deletion
  if p_user_id = auth.uid() then
    raise exception 'No puedes eliminarte a ti mismo';
  end if;

  -- Verify caller is strict admin (solo admin; el encargado no borra usuarios)
  if not public.is_strict_admin() then
    raise exception 'Solo administradores pueden eliminar usuarios';
  end if;

  -- Delete from auth.users (cascades to profiles and all related tables)
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.delete_user(uuid) from public, anon;
grant execute on function public.delete_user(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
