<?php
/**
 * Manda a un cliente el acceso a su cuenta desde el panel (Clientes →
 * "Enviar acceso").
 *
 * Las cuentas que la escuela crea a mano (cliente-sync.php) nacen SIN
 * contraseña utilizable, así que el cliente no puede entrar. Este correo le
 * lleva un enlace para crear la suya.
 *
 * Antes el botón hacía window.open('mailto:…'): Safari lo bloqueaba como
 * ventana emergente y, al permitirlo, abría la app Mail del Mac — que ni
 * siquiera tenía configurada la cuenta de la escuela. Nunca llegó nada.
 *
 * El enlace NO pasa por la redirección de Supabase (que exige tener la URL en
 * la lista de "Redirect URLs" del proyecto): se genera el token de
 * recuperación y el enlace apunta directo a /mi-cuenta/, que lo canjea con
 * verifyOtp() y pide la contraseña nueva.
 *
 * Solo staff.
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
function sb(string $metodo, string $ruta, ?array $cuerpo = null, string $auth = ''): array
{
    $ch = curl_init(WAYA_SUPABASE_URL . $ruta);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CUSTOMREQUEST  => $metodo,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'apikey: ' . WAYA_SERVICE_KEY,
            'Authorization: ' . ($auth !== '' ? $auth : 'Bearer ' . WAYA_SERVICE_KEY),
        ],
    ]);
    if ($cuerpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($cuerpo));
    $respuesta = (string) curl_exec($ch);
    $codigo = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$codigo, json_decode($respuesta, true)];
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') salir(405, ['error' => 'Método no permitido']);

// ---- Solo staff ----
$cabeceras = function_exists('getallheaders') ? getallheaders() : [];
$auth = '';
foreach ($cabeceras as $k => $v) {
    if (strtolower($k) === 'authorization') { $auth = $v; break; }
}
if ($auth === '') salir(401, ['error' => 'Falta la sesión']);

[, $usuario] = sb('GET', '/auth/v1/user', null, $auth);
$uid = $usuario['id'] ?? null;
if (!$uid) salir(401, ['error' => 'Sesión no válida']);

[, $perfil] = sb('GET', '/rest/v1/profiles?select=role&id=eq.' . rawurlencode($uid));
if (!in_array($perfil[0]['role'] ?? '', ['admin', 'encargado'], true)) {
    salir(403, ['error' => 'Solo el equipo de la escuela puede enviar accesos']);
}

// ---- Destinatario ----
$entrada = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$para    = strtolower(trim((string) ($entrada['email'] ?? '')));
$nombre  = trim((string) ($entrada['name'] ?? '')) ?: 'surfista';
if (!filter_var($para, FILTER_VALIDATE_EMAIL)) salir(400, ['error' => 'Email no válido']);

// ---- Token de recuperación (sin que Supabase mande su propio correo) ----
[$codigo, $enlace] = sb('POST', '/auth/v1/admin/generate_link', ['type' => 'recovery', 'email' => $para]);
$token = $enlace['hashed_token'] ?? ($enlace['properties']['hashed_token'] ?? '');
if ($codigo >= 400 || $token === '') {
    $msg = $enlace['msg'] ?? $enlace['error_description'] ?? $enlace['message'] ?? 'sin detalle';
    salir(502, ['error' => "No se pudo generar el enlace ($msg). ¿Tiene cuenta ese email?"]);
}

$url = WEB . '/mi-cuenta/?token_hash=' . rawurlencode($token) . '&type=recovery';

$html = waya_plantilla(
    'Hola, ' . $nombre,
    '<p style="margin:0 0 12px">Ya tienes tu cuenta en Waya Surf School. Desde ella puedes ver tus clases y tus bonos, y reservar cuando quieras.</p>'
    . '<p style="margin:0 0 12px">Para entrar, crea tu contraseña con el botón de abajo. Tu usuario es este email: <strong>' . htmlspecialchars($para) . '</strong></p>'
    . '<p style="margin:0;color:#666;font-size:13px">Por seguridad, el enlace caduca. Si ya no funciona, escríbenos y te mandamos otro.</p>',
    ['url' => $url, 'texto' => 'Crear mi contraseña']
);

[$ok, $err] = waya_enviar_email($para, 'Tu cuenta en Waya Surf School', $html);
if (!$ok) salir(502, ['error' => $err]);
salir(200, ['ok' => true]);
