-- ============================================================
-- 0034_traducir_camp_sql.sql
-- TRADUCCIÓN AUTOMÁTICA SIN EDGE FUNCTIONS.
--
-- El plan original era una Edge Function en Deno, pero desplegarla exige el
-- CLI de Supabase enlazado al proyecto y eso está bloqueado. Aquí lo mismo
-- resuelto solo con SQL: Postgres llama a DeepL con la extensión http.
--
-- Ventaja: se aplica pegando SQL, sin CLI ni Docker.
-- La clave de DeepL vive en app_secrets, que NO es legible por nadie desde
-- la API (sin políticas RLS = nadie pasa). Solo la alcanzan las funciones
-- security definer de este fichero.
--
-- Uso desde el panel:  supabase.rpc('traducir_camp', { p_camp_id: '...' })
-- ============================================================

create extension if not exists http with schema extensions;

-- ---------- 1. Almacén de la clave ----------
create table if not exists public.app_secrets (
  clave  text primary key,
  valor  text not null
);
comment on table public.app_secrets is
  'Claves de servicios externos. RLS activo y SIN políticas: inaccesible desde la API. Solo lo leen funciones security definer.';

alter table public.app_secrets enable row level security;
-- Deliberadamente sin políticas: ni anon ni authenticated pueden leerlo.

-- ---------- 2. Llamada a DeepL ----------
-- Traduce un lote de textos y los devuelve EN EL MISMO ORDEN.
create or replace function public.deepl_lote(p_textos text[], p_target text)
returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key   text;
  v_url   text;
  v_body  text;
  v_t     text;
  v_resp  extensions.http_response;
  v_json  jsonb;
begin
  if p_textos is null or array_length(p_textos, 1) is null then
    return array[]::text[];
  end if;

  select valor into v_key from public.app_secrets where clave = 'deepl_api_key';
  if v_key is null or v_key = '' then
    raise exception 'Falta la clave de DeepL: insértala en app_secrets (clave = deepl_api_key)';
  end if;

  -- La clave gratuita acaba en ":fx" y usa otro host que la de pago.
  v_url := case when v_key like '%:fx'
             then 'https://api-free.deepl.com/v2/translate'
             else 'https://api.deepl.com/v2/translate' end;

  v_body := 'target_lang=' || p_target
            || '&source_lang=ES&preserve_formatting=1';
  foreach v_t in array p_textos loop
    v_body := v_body || '&text=' || extensions.urlencode(v_t);
  end loop;

  select * into v_resp from extensions.http((
    'POST',
    v_url,
    array[extensions.http_header('Authorization', 'DeepL-Auth-Key ' || v_key)],
    'application/x-www-form-urlencoded',
    v_body
  )::extensions.http_request);

  if v_resp.status <> 200 then
    raise exception 'DeepL devolvió %: %', v_resp.status, left(v_resp.content, 200);
  end if;

  v_json := v_resp.content::jsonb;

  return array(
    select x.t ->> 'text'
    from jsonb_array_elements(v_json -> 'translations') with ordinality as x(t, ord)
    order by x.ord
  );
end;
$$;

revoke all on function public.deepl_lote(text[], text) from public, anon, authenticated;

-- ---------- 3. Traducir un camp entero ----------
create or replace function public.traducir_camp(p_camp_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Campos de texto simple, en orden fijo: la respuesta de DeepL vuelve en
  -- el mismo orden, así que se reconstruye por posición.
  SIMPLES constant text[] := array[
    'title', 'kicker', 'duration_label', 'card_vibe', 'description',
    'hero_kicker', 'hero_title', 'hero_subtitle',
    'whats_included_title', 'ideal_for_title', 'meta_title', 'meta_description'
  ];
  v_camp    public.surf_camps%rowtype;
  v_row     jsonb;
  v_lang    text;
  v_target  text;
  v_claves  text[];
  v_textos  text[];
  v_trad    text[];
  v_res     jsonb;
  v_out     jsonb := '{}'::jsonb;
  v_campo   text;
  v_val     text;
  i         int;
begin
  if not public.enc_can(array['camps']) then
    raise exception 'Sin permiso para traducir camps';
  end if;

  select * into v_camp from public.surf_camps where id = p_camp_id;
  if not found then raise exception 'Camp no encontrado'; end if;

  v_row := to_jsonb(v_camp);

  foreach v_lang in array array['en', 'de'] loop
    v_target := case v_lang when 'en' then 'EN-GB' else 'DE' end;
    v_res := '{}'::jsonb;

    -- (a) Campos simples: se mandan juntos y se recomponen por posición.
    v_claves := array[]::text[];
    v_textos := array[]::text[];
    foreach v_campo in array SIMPLES loop
      v_val := nullif(btrim(coalesce(v_row ->> v_campo, '')), '');
      if v_val is not null then
        v_claves := v_claves || v_campo;
        v_textos := v_textos || v_val;
      end if;
    end loop;

    if array_length(v_textos, 1) > 0 then
      v_trad := public.deepl_lote(v_textos, v_target);
      for i in 1 .. array_length(v_claves, 1) loop
        if v_trad[i] is not null then
          v_res := v_res || jsonb_build_object(v_claves[i], v_trad[i]);
        end if;
      end loop;
    end if;

    -- (b) Los tres campos que son listas, cada uno en su propia llamada
    --     para no mezclar posiciones.
    foreach v_campo in array array['hero_tags', 'whats_included', 'ideal_for'] loop
      v_textos := array(
        select btrim(e) from jsonb_array_elements_text(
          case when jsonb_typeof(v_row -> v_campo) = 'array'
               then v_row -> v_campo else '[]'::jsonb end
        ) as e where btrim(e) <> ''
      );
      if array_length(v_textos, 1) > 0 then
        v_trad := public.deepl_lote(v_textos, v_target);
        v_res := v_res || jsonb_build_object(v_campo, to_jsonb(v_trad));
      end if;
    end loop;

    v_out := v_out || jsonb_build_object(v_lang, v_res);
  end loop;

  update public.surf_camps set i18n = v_out, updated_at = now() where id = p_camp_id;
  return v_out;
end;
$$;

-- Solo usuarios autenticados; dentro, enc_can filtra a staff.
revoke all on function public.traducir_camp(uuid) from public, anon;
grant execute on function public.traducir_camp(uuid) to authenticated;
