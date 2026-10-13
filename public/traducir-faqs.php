<?php
/**
 * Traduce las preguntas frecuentes (camp_faqs) de un surfcamp a EN y DE.
 *
 * traducir_camp (migración 0034) traduce el camp pero NO las FAQs, y la tabla
 * camp_faqs no tiene columna de traducciones (sin acceso DDL para añadirla).
 * Las traducciones se guardan dentro de surf_camps.i18n:
 *     i18n.en.faqs = { "<id de la faq>": { "question": "…", "answer": "…" } }
 * OJO: traducir_camp reescribe i18n entero, así que esto se llama SIEMPRE
 * después de él (el panel lo encadena en autoTraducir).
 *
 * DeepL: misma clave que usa traducir_camp (app_secrets.deepl_api_key), que
 * la service_role sí puede leer.
 *
 * Uso:
 *   - Panel (POST JSON { camp_id }, solo staff).
 *   - Terminal: php public/traducir-faqs.php <camp_id>   (para traducir a mano)
 */

require_once __DIR__ . '/config-secreto.php';

$esCli = PHP_SAPI === 'cli';
if (!$esCli) header('Content-Type: application/json; charset=utf-8');

function salir(int $codigo, array $cuerpo): void
{
    global $esCli;
    if ($esCli) { echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n"; exit($codigo >= 300 ? 1 : 0); }
    http_response_code($codigo);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Petición a Supabase. Devuelve [código, json]. */
function sb(string $metodo, string $ruta, $cuerpo = null, array $extra = [], string $auth = ''): array
{
    $ch = curl_init(WAYA_SUPABASE_URL . $ruta);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CUSTOMREQUEST  => $metodo,
        CURLOPT_HTTPHEADER     => array_merge([
            'apikey: ' . WAYA_SERVICE_KEY,
            'Authorization: ' . ($auth !== '' ? $auth : 'Bearer ' . WAYA_SERVICE_KEY),
        ], $extra),
    ]);
    if ($cuerpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $cuerpo);
    $respuesta = (string) curl_exec($ch);
    $codigo = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$codigo, json_decode($respuesta, true)];
}

/** Traduce un lote con DeepL; devuelve las traducciones en el mismo orden. */
function deepl(array $textos, string $destino, string $clave): array
{
    if (!$textos) return [];
    $url = str_ends_with($clave, ':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
    $cuerpo = 'target_lang=' . $destino . '&source_lang=ES&preserve_formatting=1';
    foreach ($textos as $t) $cuerpo .= '&text=' . rawurlencode($t);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $cuerpo,
        CURLOPT_HTTPHEADER     => ['Authorization: DeepL-Auth-Key ' . $clave, 'Content-Type: application/x-www-form-urlencoded'],
    ]);
    $res = json_decode((string) curl_exec($ch), true);
    $codigo = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($codigo !== 200 || !isset($res['translations'])) salir(502, ['error' => "DeepL devolvió $codigo"]);
    return array_map(fn($t) => $t['text'], $res['translations']);
}

// ---- Quién llama y qué camp ----
if ($esCli) {
    $campId = $argv[1] ?? '';
} else {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') salir(405, ['error' => 'Método no permitido']);
    $cabeceras = function_exists('getallheaders') ? getallheaders() : [];
    $auth = '';
    foreach ($cabeceras as $k => $v) {
        if (strtolower($k) === 'authorization') { $auth = $v; break; }
    }
    if ($auth === '') salir(401, ['error' => 'Falta la sesión']);
    [, $usuario] = sb('GET', '/auth/v1/user', null, [], $auth);
    $uid = $usuario['id'] ?? null;
    if (!$uid) salir(401, ['error' => 'Sesión no válida']);
    [, $perfil] = sb('GET', '/rest/v1/profiles?select=role&id=eq.' . rawurlencode($uid));
    if (!in_array($perfil[0]['role'] ?? '', ['admin', 'encargado'], true)) salir(403, ['error' => 'Solo el equipo de la escuela']);
    $entrada = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
    $campId = (string) ($entrada['camp_id'] ?? '');
}
if (!preg_match('/^[0-9a-f-]{36}$/i', $campId)) salir(400, ['error' => 'camp_id no válido']);

// ---- Datos ----
[, $secreto] = sb('GET', '/rest/v1/app_secrets?select=valor&clave=eq.deepl_api_key');
$clave = $secreto[0]['valor'] ?? '';
if ($clave === '') salir(500, ['error' => 'Falta la clave de DeepL en app_secrets']);

[, $camp] = sb('GET', '/rest/v1/surf_camps?select=i18n&id=eq.' . $campId);
if (!$camp) salir(404, ['error' => 'Camp no encontrado']);
$i18n = is_array($camp[0]['i18n'] ?? null) ? $camp[0]['i18n'] : [];

[, $faqs] = sb('GET', '/rest/v1/camp_faqs?select=id,question,answer&camp_id=eq.' . $campId . '&order=sort_order');
$faqs = array_values(array_filter($faqs ?: [], fn($f) => trim($f['question'] ?? '') !== ''));

// ---- Traducir: preguntas y respuestas en un solo lote por idioma ----
$textos = [];
foreach ($faqs as $f) { $textos[] = trim($f['question']); $textos[] = trim($f['answer'] ?? '') ?: ' '; }

foreach (['en' => 'EN-GB', 'de' => 'DE'] as $lang => $destino) {
    $trad = deepl($textos, $destino, $clave);
    $mapa = [];
    foreach ($faqs as $i => $f) {
        $mapa[$f['id']] = ['question' => $trad[$i * 2] ?? '', 'answer' => trim($trad[$i * 2 + 1] ?? '')];
    }
    if (!isset($i18n[$lang]) || !is_array($i18n[$lang])) $i18n[$lang] = [];
    $i18n[$lang]['faqs'] = (object) $mapa;
}

[$codigo, $res] = sb('PATCH', '/rest/v1/surf_camps?id=eq.' . $campId, json_encode(['i18n' => $i18n], JSON_UNESCAPED_UNICODE), ['Content-Type: application/json']);
if ($codigo >= 300) salir(502, ['error' => $res['message'] ?? 'No se pudo guardar']);
salir(200, ['ok' => true, 'faqs' => count($faqs)]);
