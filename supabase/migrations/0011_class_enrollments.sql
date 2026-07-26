-- ============================================================
-- 0011_class_enrollments.sql
-- Propósito: Tabla public.class_enrollments — inscripciones de usuarios/
-- familiares a clases programadas. Versión FINAL consolidada portada de
-- Entreolas (migration-reservation-system + admin-bookings[user_id/bono_id
-- nullable, guest_name] + attendance-column[attendance + CHECK 4 estados de pago]
-- + client-updates[cancelled_by] + audit-fixes[índices] +
-- enrollment-unique-titular[índice único parcial con coalesce]).
--
-- Notas de la versión final:
--   · user_id y bono_id son NULLABLE (walk-ins / reservas creadas por admin).
--   · attendance es INDEPENDIENTE del pago: null=sin marcar, true=asistió,
--     false=no se presentó. El color de pago se rige SOLO por status.
--   · status guarda solo pago/ciclo de vida: confirmed/cancelled/paid/partial.
-- enrolled_count (surf_classes) y used_credits (bonos) se materializan por
-- triggers definidos en 0016.
-- ============================================================

create table public.class_enrollments (
  id                uuid primary key default uuid_generate_v4(),
  class_id          uuid not null references public.surf_classes(id) on delete cascade,
  user_id           uuid references public.profiles(id) on delete cascade,
  family_member_id  uuid references public.family_members(id) on delete set null,
  bono_id           uuid references public.bonos(id) on delete cascade,
  guest_name        text,
  status            text not null default 'confirmed'
                      check (status in ('confirmed','cancelled','paid','partial')),
  attendance        boolean,
  cancelled_by      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.class_enrollments is 'Inscripciones de usuarios/familiares a clases programadas';
comment on column public.class_enrollments.attendance is
  'Asistencia a la clase, independiente del pago: null=sin marcar, true=asistió, false=no se presentó';

-- Índices
create index idx_enrollments_class            on public.class_enrollments(class_id);
create index idx_enrollments_user             on public.class_enrollments(user_id);
create index idx_enrollments_bono             on public.class_enrollments(bono_id);
create index idx_class_enrollments_status     on public.class_enrollments(status);
create index idx_class_enrollments_class_id   on public.class_enrollments(class_id);
create index idx_class_enrollments_user_id    on public.class_enrollments(user_id);

-- Índice único parcial (versión final "enrollment-unique-titular"):
-- un mismo titular/familiar no puede inscribirse dos veces en la misma clase
-- salvo que la inscripción previa esté cancelada. El coalesce cierra el hueco
-- de los NULL (Postgres trata los NULL como distintos) para el titular.
drop index if exists idx_unique_enrollment;
create unique index idx_unique_enrollment
  on public.class_enrollments
    (class_id, user_id, coalesce(family_member_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'cancelled';

-- RLS
alter table public.class_enrollments enable row level security;

drop policy if exists "Users read own enrollments" on public.class_enrollments;
create policy "Users read own enrollments"
  on public.class_enrollments for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins manage all enrollments" on public.class_enrollments;
create policy "Admins manage all enrollments"
  on public.class_enrollments for all
  using (public.is_admin());

drop policy if exists "Admins insert enrollments" on public.class_enrollments;
create policy "Admins insert enrollments"
  on public.class_enrollments for insert
  with check (public.is_admin());
