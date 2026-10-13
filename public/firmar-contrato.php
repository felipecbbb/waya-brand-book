<?php
/**
 * Registro de la firma del contrato de clases (Términos y Condiciones).
 *
 * Sustituye al formulario de Google "SURF LESSON BOOKING" que la escuela
 * hacía rellenar a mano: ahora se firma en la web, al reservar, antes de pagar.
 *
 * Evidencia que se guarda por cada firma (bucket PRIVADO "contratos" de
 * Supabase Storage, sin acceso público):
 *   - el texto EXACTO que se mostró (HTML) y su versión
 *   - nombre, documento, fecha/hora del servidor, IP y navegador
 *   - cuenta que firma y qué se reservaba (clases, asistentes)
 * Y se manda una copia por email al cliente y a la escuela (soporte duradero).
 *
 * Solo usuarios con sesión (la reserva ya exige cuenta).
 */

require_once __DIR__ . '/lib-email.php';
require_once __DIR__ . '/config-secreto.php';

header('Content-Type: application/json; charset=utf-8');

function salir(int $codigo, array $cuerpo): void
{
    http_response_code($codigo);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Petición a Supabase con la service_role. Devuelve [código, json]. */
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
    return [$codigo, json_decode($respuesta, true)];
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') salir(405, ['error' => 'Método no permitido']);

// ---- Sesión ----
$cabeceras = function_exists('getallheaders') ? getallheaders() : [];
$auth = '';
foreach ($cabeceras as $k => $v) {
    if (strtolower($k) === 'authorization') { $auth = $v; break; }
}
if ($auth === '') salir(401, ['error' => 'Falta la sesión']);
[, $usuario] = sb('GET', '/auth/v1/user', null, [], $auth);
$uid = $usuario['id'] ?? null;
$correo = (string) ($usuario['email'] ?? '');
if (!$uid) salir(401, ['error' => 'Sesión no válida']);

// ---- Datos de la firma ----
$e = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$nombre    = trim((string) ($e['nombre'] ?? ''));
$documento = trim((string) ($e['documento'] ?? ''));
$version   = preg_replace('/[^0-9A-Za-z._-]/', '', (string) ($e['version'] ?? ''));
$idioma    = in_array($e['idioma'] ?? '', ['es', 'en', 'de'], true) ? $e['idioma'] : 'en';
// Solo etiquetas de texto: lo manda el navegador y acaba en un email de la escuela.
$texto     = strip_tags((string) ($e['contrato_html'] ?? ''), '<h3><p><ol><li><br><strong>');
$texto     = preg_replace('/<(\w+)\s[^>]*>/', '<$1>', $texto);   // sin atributos
$reserva   = is_array($e['reserva'] ?? null) ? $e['reserva'] : [];

if (mb_strlen($nombre) < 3)    salir(400, ['error' => 'Falta el nombre completo']);
if (mb_strlen($documento) < 4) salir(400, ['error' => 'Falta el DNI / pasaporte']);
if ($version === '' || $texto === '' || empty($e['acepta'])) salir(400, ['error' => 'Falta aceptar el contrato']);

$ahora = gmdate('c');
$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
$registro = [
    'firmado_en'   => $ahora,
    'version'      => $version,
    'idioma'       => $idioma,
    'nombre'       => $nombre,
    'documento'    => $documento,
    'cuenta'       => ['id' => $uid, 'email' => $correo],
    'ip'           => trim(explode(',', $ip)[0]),
    'navegador'    => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300),
    'reserva'      => $reserva,
    'contrato_html'=> $texto,
];

// ---- Guardar en el bucket privado (se crea la primera vez) ----
sb('POST', '/storage/v1/bucket', json_encode(['id' => 'contratos', 'name' => 'contratos', 'public' => false]), ['Content-Type: application/json']);
$ruta = gmdate('Y-m') . '/' . gmdate('Ymd-His') . '-' . substr($uid, 0, 8) . '-' . bin2hex(random_bytes(3)) . '.json';
[$codigo, $res] = sb('POST', '/storage/v1/object/contratos/' . $ruta,
    json_encode($registro, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), ['Content-Type: application/json']);
if ($codigo >= 300) salir(502, ['error' => 'No se pudo registrar la firma: ' . ($res['message'] ?? $codigo)]);

// ---- Copia por email (cliente + escuela) ----
$fechaLegible = (new DateTime('now', new DateTimeZone('Atlantic/Canary')))->format('d/m/Y H:i');
$firma = waya_tabla(
    waya_dato('Firmado por / Signed by', $nombre)
    . waya_dato('DNI / ID', $documento)
    . waya_dato('Fecha / Date', $fechaLegible . ' (Canarias)')
    . waya_dato('Versión / Version', $version)
);
$cuerpo = '<div style="font-size:13px;line-height:1.5;color:#333">' . $texto . '</div>' . $firma;
$asuntos = [
    'es' => 'Tu contrato firmado — Waya Surf School',
    'en' => 'Your signed contract — Waya Surf School',
    'de' => 'Dein unterschriebener Vertrag — Waya Surf School',
];
if (filter_var($correo, FILTER_VALIDATE_EMAIL)) {
    waya_enviar_email($correo, $asuntos[$idioma], waya_plantilla('Waya Surf School', $cuerpo));
}
waya_enviar_email(ADMIN_EMAIL, 'Contrato firmado · ' . $nombre, waya_plantilla('Contrato firmado', $cuerpo));

salir(200, ['ok' => true, 'registro' => $ruta]);
