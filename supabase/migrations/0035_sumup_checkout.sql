-- ============================================================
-- 0035_sumup_checkout.sql
-- PASARELA DE PAGO SUMUP (hosted checkout).
--
-- Flujo:
--   1. El navegador manda QUÉ compra (ids), nunca CUÁNTO cuesta.
--   2. Esta función recalcula el importe leyendo los precios de la BD,
--      crea el checkout en SumUp y devuelve la URL de pago alojada.
--   3. El cliente paga en checkout.sumup.com (los datos de tarjeta no pasan
--      por nuestra web).
--   4. El webhook (webhook-sumup.php) confirma y llama a confirmar_pago_sumup.
--
-- POR QUÉ SE RECALCULA EL PRECIO:
-- Las RPC reservar_*_offline toman el importe del carrito del navegador
-- (`v_item->>'price'`). Con pago presencial da igual, porque la escuela ve el
-- importe. Cobrando con tarjeta NO: cualquiera edita el localStorage y paga
-- 1€ por una plaza de 600€. Aquí el precio SIEMPRE sale de la base de datos.
-- ============================================================

-- ---------- 1. Checkouts pendientes ----------
create table if not exists public.pending_checkouts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.profiles(id) on delete set null,
  items              jsonb not null,
  amount             numeric(10,2) not null check (amount > 0),
  currency           text not null default 'EUR',
  sumup_checkout_id  text unique,
  sumup_status       text,
  status             text not null default 'pending'
                       check (status in ('pending','paid','failed','expired')),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);

comment on table public.pending_checkouts is
  'Intentos de pago con SumUp. amount lo calcula el servidor, nunca el cliente.';

create index if not exists idx_pending_checkouts_user on public.pending_checkouts(user_id, created_at desc);
create index if not exists idx_pending_checkouts_sumup on public.pending_checkouts(sumup_checkout_id);

alter table public.pending_checkouts enable row level security;

-- El cliente solo ve los suyos (para la pantalla de "pago correcto").
drop policy if exists "Users read own checkouts" on public.pending_checkouts;
create policy "Users read own checkouts" on public.pending_checkouts
  for select using (user_id = auth.uid() or public.enc_can(array['reservas','camps']));

-- ---------- 2. Precio real de un carrito ----------
-- Devuelve { total, items } con el precio de CADA item leído de la BD.
-- Si un item no se puede validar, se rechaza entero: mejor fallar que cobrar mal.
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
      -- Se cobra la SEÑAL, igual que el flujo actual. El resto se abona luego.
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
      -- Las fechas y la talla vienen del cliente porque son una ELECCIÓN suya,
      -- no un precio: no hay nada que revalidar contra la BD. Se arrastran
      -- aquí porque confirmar_pago_sumup las necesita al crear la reserva.
      v_out := v_out || jsonb_build_object(
        'type','rental','equipmentId',v_id,'qty',v_qty,'duration',v_dur,
        'unit',v_precio,'subtotal',v_precio * v_qty,
        'dateStart', nullif(v_item->'metadata'->>'dateStart',''),
        'dateEnd',   nullif(v_item->'metadata'->>'dateEnd',''),
        'size',      nullif(v_item->'metadata'->>'size',''),
        'name', v_eq.name);
      v_total := v_total + v_precio * v_qty;

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

-- ---------- 3. Crear el checkout en SumUp ----------
create or replace function public.crear_checkout_sumup(
  p_items      jsonb,
  p_return_url text default 'https://wayasurf.com/pago-ok.html'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user     uuid := auth.uid();
  v_key      text;
  v_merchant text;
  v_calc     jsonb;
  v_total    numeric(10,2);
  v_row      public.pending_checkouts%rowtype;
  v_body     jsonb;
  v_resp     extensions.http_response;
  v_json     jsonb;
begin
  if v_user is null then raise exception 'Debes iniciar sesión para pagar'; end if;

  select valor into v_key      from public.app_secrets where clave = 'sumup_api_key';
  select valor into v_merchant from public.app_secrets where clave = 'sumup_merchant_code';
  if coalesce(v_key,'') = '' or coalesce(v_merchant,'') = '' then
    raise exception 'Faltan las credenciales de SumUp en app_secrets';
  end if;

  -- El precio SIEMPRE desde la base de datos.
  v_calc  := public.calcular_importe_carrito(p_items);
  v_total := (v_calc->>'total')::numeric;

  insert into public.pending_checkouts (user_id, items, amount)
  values (v_user, v_calc->'items', v_total)
  returning * into v_row;

  v_body := jsonb_build_object(
    'checkout_reference', v_row.id::text,
    'amount',             v_total,
    'currency',           'EUR',
    'merchant_code',      v_merchant,
    'description',        'Waya Surf School',
    'return_url',         p_return_url,
    'redirect_url',       p_return_url || '?ref=' || v_row.id::text,
    'hosted_checkout',    jsonb_build_object('enabled', true)
  );

  select * into v_resp from extensions.http((
    'POST',
    'https://api.sumup.com/v0.1/checkouts',
    array[extensions.http_header('Authorization', 'Bearer ' || v_key)],
    'application/json',
    v_body::text
  )::extensions.http_request);

  if v_resp.status not in (200, 201) then
    update public.pending_checkouts set status = 'failed' where id = v_row.id;
    raise exception 'SumUp devolvió %: %', v_resp.status, left(v_resp.content, 300);
  end if;

  v_json := v_resp.content::jsonb;

  update public.pending_checkouts
     set sumup_checkout_id = v_json->>'id',
         sumup_status      = v_json->>'status'
   where id = v_row.id;

  -- SumUp devuelve la URL como `hosted_checkout_url` en la raíz (comprobado
  -- contra la API real), no dentro del objeto `hosted_checkout`.
  if coalesce(v_json->>'hosted_checkout_url','') = '' then
    update public.pending_checkouts set status = 'failed' where id = v_row.id;
    raise exception 'SumUp no devolvió URL de pago: %', left(v_resp.content, 300);
  end if;

  return jsonb_build_object(
    'referencia',  v_row.id,
    'importe',     v_total,
    'url',         v_json->>'hosted_checkout_url',
    'checkout_id', v_json->>'id'
  );
end;
$$;

revoke all on function public.crear_checkout_sumup(jsonb, text) from public, anon;
grant execute on function public.crear_checkout_sumup(jsonb, text) to authenticated;

-- ---------- 4. Confirmar el pago y crear las reservas ----------
-- La llama el webhook (webhook-sumup.php) con la service_role key.
-- Consulta el estado REAL a SumUp antes de dar nada por pagado: no se fía del
-- cuerpo del webhook, que cualquiera podría falsificar conociendo la URL.
--
-- Es IDEMPOTENTE: SumUp puede reintentar el webhook varias veces y las
-- reservas deben crearse una sola vez.
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
  v_camp    public.surf_camps%rowtype;
  v_eq      public.rental_equipment%rowtype;
  v_creadas int := 0;
begin
  select * into v_row from public.pending_checkouts where id = p_referencia;
  if not found then raise exception 'Checkout no encontrado'; end if;

  -- Ya procesado: se devuelve igual (idempotencia ante reintentos del webhook).
  if v_row.status = 'paid' then
    return jsonb_build_object('ok', true, 'ya_procesado', true, 'importe', v_row.amount);
  end if;

  select valor into v_key from public.app_secrets where clave = 'sumup_api_key';
  if coalesce(v_key,'') = '' then raise exception 'Falta la clave de SumUp'; end if;

  -- Preguntar a SumUp cuál es el estado de verdad.
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

  -- Pagado de verdad: se crean las reservas ya cobradas.
  for v_item in select * from jsonb_array_elements(v_row.items) loop
    if v_item->>'type' = 'camp' then
      select * into v_camp from public.surf_camps where id = (v_item->>'campId')::uuid;
      insert into public.bookings
        (user_id, camp_id, status, deposit_amount, total_amount, payment_method)
      values
        (v_row.user_id, (v_item->>'campId')::uuid, 'deposit_paid',
         (v_item->>'subtotal')::numeric, (v_item->>'total_amount')::numeric, 'sumup');
      v_creadas := v_creadas + 1;

    elsif v_item->>'type' = 'rental' then
      select * into v_eq from public.rental_equipment where id = (v_item->>'equipmentId')::uuid;
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
    end if;
  end loop;

  -- Registro contable del cobro (tabla payments ya existente).
  insert into public.payments
    (reservation_type, reference_id, amount, payment_method, channel, concept)
  values
    ('booking', v_row.id, v_row.amount, 'online', 'web',
     'Pago SumUp ' || coalesce(v_row.sumup_checkout_id,''));

  update public.pending_checkouts
     set status = 'paid', paid_at = now()
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'reservas_creadas', v_creadas, 'importe', v_row.amount);
end;
$$;

-- Solo el backend (service_role). Nunca desde el navegador.
revoke all on function public.confirmar_pago_sumup(uuid) from public, anon, authenticated;
