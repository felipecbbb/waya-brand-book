-- ============================================================
-- 0039_plural_sesiones.sql
-- El nombre del pack salía como "5 sesiónes": la tilde de "sesión" no se
-- pierde al pluralizar y el cliente lo ve en el checkout y en el correo de
-- confirmación. Se cambia por la palabra completa según el número.
--
-- Es la misma función de 0038 (con el bloqueo de alquileres ya dentro): solo
-- cambia la línea del nombre, al final del bloque 'pack'.
-- ============================================================
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
      if not public.alquileres_activos() then
        raise exception 'Los alquileres no están disponibles en este momento';
      end if;
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
        'name', coalesce(v_act, 'Pack de clases') || ' · ' || v_sess ||
                case when v_sess > 1 then ' sesiones' else ' sesión' end);
      v_total := v_total + v_precio;

    else
      raise exception 'Tipo de artículo no admitido: %', coalesce(v_tipo,'(vacío)');
    end if;
  end loop;

  if v_total <= 0 then raise exception 'El carrito está vacío'; end if;
  return jsonb_build_object('total', v_total, 'items', v_out);
end;
$$;
