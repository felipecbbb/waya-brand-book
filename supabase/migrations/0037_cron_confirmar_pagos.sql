-- ============================================================
-- 0037_cron_confirmar_pagos.sql
-- RED DE SEGURIDAD PARA LOS COBROS.
--
-- La cuenta de SumUp de Waya NO ofrece webhooks (Ajustes de desarrollador solo
-- tiene entornos de prueba, claves API, OAuth2 y affiliate keys), así que
-- nadie nos avisa cuando un pago se completa.
--
-- La confirmación normal la pide /pago-ok.html al volver de la pasarela. Pero
-- si el cliente cierra el navegador nada más pagar, esa llamada nunca ocurre y
-- el cobro se quedaría sin reserva. Este cron repesca esos casos.
--
-- Es seguro repetirlo: confirmar_pago_sumup() pregunta a SumUp el estado real
-- y no hace nada si el checkout ya está pagado.
-- ============================================================

create extension if not exists pg_cron;

-- ---------- Repescar los pagos sin confirmar ----------
create or replace function public.confirmar_pagos_pendientes()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila   record;
  v_hechos int := 0;
begin
  -- Solo los de las últimas 6 horas: más atrás, o se pagó y ya se confirmó,
  -- o el intento se abandonó. Y como mucho 20 por pasada, para no encadenar
  -- decenas de llamadas a SumUp en un solo tick.
  for v_fila in
    select id from public.pending_checkouts
     where status = 'pending'
       and sumup_checkout_id is not null
       and created_at > now() - interval '6 hours'
     order by created_at
     limit 20
  loop
    begin
      perform public.confirmar_pago_sumup(v_fila.id);
      v_hechos := v_hechos + 1;
    exception when others then
      -- Un checkout que falle no puede tumbar la pasada entera.
      raise warning 'confirmar_pagos_pendientes: % → %', v_fila.id, sqlerrm;
    end;
  end loop;

  -- Los que llevan más de un día colgados no se van a pagar ya.
  update public.pending_checkouts
     set status = 'expired'
   where status = 'pending'
     and created_at < now() - interval '24 hours';

  return v_hechos;
end;
$$;

revoke all on function public.confirmar_pagos_pendientes() from public, anon, authenticated;

-- ---------- Programarlo cada 2 minutos ----------
-- 2 minutos es el equilibrio: el cliente que sí vuelve ya tiene su reserva al
-- instante (lo hace pago-ok.html), y el que cerró el navegador espera como
-- mucho un par de minutos.
select cron.unschedule('waya-confirmar-pagos')
 where exists (select 1 from cron.job where jobname = 'waya-confirmar-pagos');

select cron.schedule(
  'waya-confirmar-pagos',
  '*/2 * * * *',
  $$select public.confirmar_pagos_pendientes();$$
);
