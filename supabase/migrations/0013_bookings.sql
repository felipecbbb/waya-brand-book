-- ============================================================
-- 0013_bookings.sql
-- Propósito: Tabla public.bookings — reservas de Surf Camp. LATENTE: se crea
-- como backbone del checkout de camps pero sin UI en Waya. Versión FINAL
-- consolidada portada de Entreolas (schema.sql[bookings] +
-- guest-checkout[user_id nullable + guest cols + política de inserción guest]).
-- El trigger update_spots_on_booking (surf_camps.spots_taken) se define en 0016.
--
-- ⚠ WAYA: user_id NULLABLE (reservas de invitado). Estados de booking:
-- pending / deposit_paid / fully_paid / cancelled / refunded.
-- ============================================================

create table public.bookings (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references public.profiles(id) on delete cascade,
  camp_id         uuid not null references public.surf_camps(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending','deposit_paid','fully_paid','cancelled','refunded')),
  deposit_amount  numeric(8,2),
  total_amount    numeric(8,2) not null,
  payment_method  text,
  notes           text,
  guest_email     text,
  guest_name      text,
  guest_phone     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.bookings is 'Reservas de Surf Camp (latente: backbone de checkout sin UI en Waya)';

-- Índices
create index idx_bookings_user   on public.bookings(user_id);
create index idx_bookings_camp   on public.bookings(camp_id);
create index idx_bookings_status on public.bookings(status);

-- RLS
alter table public.bookings enable row level security;

drop policy if exists "Users read own bookings" on public.bookings;
create policy "Users read own bookings"
  on public.bookings for select
  using (user_id = auth.uid() or public.is_admin());

-- Inserción con soporte de invitado (guest checkout): permite fila sin user_id
-- siempre que se aporte guest_email.
drop policy if exists "Allow guest booking insert" on public.bookings;
create policy "Allow guest booking insert"
  on public.bookings for insert
  with check (user_id is not null or guest_email is not null);

drop policy if exists "Admins manage all bookings" on public.bookings;
create policy "Admins manage all bookings"
  on public.bookings for all
  using (public.is_admin());
