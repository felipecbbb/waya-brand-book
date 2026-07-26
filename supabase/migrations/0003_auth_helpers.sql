-- ============================================================
-- 0003_auth_helpers.sql
-- Propósito: funciones auxiliares de autorización usadas por TODAS las políticas
--   RLS y RPCs. Crear ANTES de cualquier política que dependa de ellas.
--   - is_admin()          → staff operativo (role in admin|encargado). ~40 políticas.
--   - is_strict_admin()   → solo role='admin' (cupones, borrado usuario, cambio rol).
--   - enc_can(text[])     → admin siempre; encargado si allowed_sections NULL o ?| p_sections.
-- Fuente Entreolas (versión final): migration-role-encargado.sql,
--   migration-encargado-section-rls.sql, migration-security-hardening.sql.
-- ============================================================

-- is_admin(): staff operativo (admin OR encargado). El nombre se mantiene para
-- que las políticas RLS existentes funcionen sin tocarse.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'encargado')
  );
$$;

-- is_strict_admin(): solo role='admin' (operaciones sensibles).
create or replace function public.is_strict_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- enc_can(secciones[]): admin siempre true; encargado true si allowed_sections
-- es NULL (todas) o contiene alguna de las secciones pedidas (operador ?|).
create or replace function public.enc_can(p_sections text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and ( role = 'admin'
            or (role = 'encargado'
                and (allowed_sections is null or allowed_sections ?| p_sections)) )
  );
$function$;

grant execute on function public.enc_can(text[]) to anon, authenticated;
