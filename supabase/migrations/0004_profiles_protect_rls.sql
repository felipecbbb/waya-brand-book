-- ============================================================
-- 0004_profiles_protect_rls.sql
-- Propósito: blindaje de privilegios de profiles + políticas RLS de profiles.
--   - protect_profile_privileges() + trigger trg_protect_profile_privileges:
--     bloquea cambios de role/allowed_sections salvo admin estricto o service_role
--     (auth.uid() IS NULL). Defensa a nivel de fila frente a la policy FOR ALL.
--   - Políticas RLS de profiles (versiones FINALES).
-- Fuente Entreolas (versión final): migration-protect-profile-privileges.sql,
--   migration-role-encargado.sql, schema.sql.
-- Depende de: 0002 (tabla profiles), 0003 (is_admin/is_strict_admin).
-- Idempotente: drop policy/trigger if exists antes de crear.
-- ============================================================

-- 1. Trigger de protección de rol/permisos
-- ------------------------------------------------------------
create or replace function public.protect_profile_privileges()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $function$
begin
  if (new.role is distinct from old.role
      or new.allowed_sections is distinct from old.allowed_sections)
     and auth.uid() is not null
     and not public.is_strict_admin() then
    raise exception 'No autorizado a cambiar rol o permisos';
  end if;
  return new;
end;
$function$;

-- Hardening: función SOLO trigger, no invocable vía /rpc
revoke execute on function public.protect_profile_privileges() from anon, authenticated, public;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- 2. Políticas RLS de profiles (versiones finales)
-- ------------------------------------------------------------

-- Lectura del propio perfil (o staff)
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

-- Update del propio perfil, sin poder auto-ascender el rol ni cambiar secciones
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (role = (select p.role from public.profiles p where p.id = auth.uid()) or public.is_strict_admin())
    and (allowed_sections is not distinct from (select p.allowed_sections from public.profiles p where p.id = auth.uid()) or public.is_strict_admin())
  );

-- Gestión total por staff (el trigger sigue blindando role/allowed_sections)
drop policy if exists "Admins manage all profiles" on public.profiles;
create policy "Admins manage all profiles"
  on public.profiles for all
  using (public.is_admin());
