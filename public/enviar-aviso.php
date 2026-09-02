<?php
/**
 * Avisos por correo desde el panel.
 *
 * Sustituye a la Edge Function 'send-email', que el panel lleva invocando
 * desde siempre pero que NUNCA se desplegó: devolvía 404 y, como las llamadas
 * van dentro de try/catch, fallaba en silencio. Ni la escuela ni los clientes
 * han recibido nunca esos correos.
 *
 * Mantiene el mismo contrato { to, type, data } para no tener que reescribir
 * las cinco llamadas repartidas por el panel.
 *
 * Permisos: el staff puede escribir a cualquier cliente; un cliente normal
 * solo puede dispararse avisos a sí mismo o a la escuela (la confirmación de
 * su propia reserva).
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

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') salir(405, ['error' => 'Método no permitido']);

// ---- Solo staff ----
// El token va en Authorization; se pregunta a Supabase de quién es y qué rol
// tiene. Sin esto, cualquiera podría usar esto para mandar correos como Waya.
$cabeceras = function_exists('getallheaders') ? getallheaders() : [];
$auth = '';
foreach ($cabeceras as $k => $v) {
    if (strtolower($k) === 'authorization') { $auth = $v; break; }
}
if ($auth === '') salir(401, ['error' => 'Falta la sesión']);

$ch = curl_init(WAYA_SUPABASE_URL . '/auth/v1/user');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => ['apikey: ' . WAYA_SERVICE_KEY, 'Authorization: ' . $auth],
]);
$usuario = json_decode((string) curl_exec($ch), true);
curl_close($ch);
$uid = $usuario['id'] ?? null;
if (!$uid) salir(401, ['error' => 'Sesión no válida']);

$ch = curl_init(WAYA_SUPABASE_URL . '/rest/v1/profiles?select=role&id=eq.' . rawurlencode($uid));
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        'apikey: ' . WAYA_SERVICE_KEY,
        'Authorization: Bearer ' . WAYA_SERVICE_KEY,
    ],
]);
$perfil = json_decode((string) curl_exec($ch), true);
curl_close($ch);
$rol       = $perfil[0]['role'] ?? '';
$esStaff   = in_array($rol, ['admin', 'encargado'], true);
$miCorreo  = strtolower(trim((string) ($usuario['email'] ?? '')));

// ---- Contenido ----
$entrada = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$para    = trim((string) ($entrada['to'] ?? ''));
$tipo    = (string) ($entrada['type'] ?? 'basico');
$datos   = is_array($entrada['data'] ?? null) ? $entrada['data'] : [];

if (!filter_var($para, FILTER_VALIDATE_EMAIL)) salir(400, ['error' => 'Destinatario no válido']);

// El staff puede escribir a cualquier cliente. Un cliente normal solo puede
// dispararse avisos A SÍ MISMO o a la escuela (la confirmación de su propia
// reserva). Sin esto, cualquiera con cuenta podría mandar correos como Waya.
if (!$esStaff) {
    $destino = strtolower($para);
    if ($destino !== $miCorreo && $destino !== strtolower(ADMIN_EMAIL)) {
        salir(403, ['error' => 'Solo puedes enviarte avisos a ti mismo']);
    }
}

$nombre = trim((string) ($datos['customerName'] ?? '')) ?: 'surfista';

/**
 * Cada tipo tiene su asunto y su texto. Los que no estén contemplados caen en
 * un mensaje genérico en vez de fallar: mejor un correo sobrio que ninguno.
 */
$plantillas = [
    'camp_reservation'  => ['Tu plaza en el surfcamp',        'Hemos guardado tu plaza en el surfcamp. En breve te contamos los detalles.'],
    'camp_booked'       => ['Tu plaza en el surfcamp',        'Hemos guardado tu plaza en el surfcamp. En breve te contamos los detalles.'],
    'camp_cancelled'    => ['Tu reserva ha sido cancelada',   'Hemos cancelado tu reserva del surfcamp. Si crees que es un error, respóndenos a este correo.'],
    'class_reservation' => ['Tu clase está reservada',        'Tu clase queda reservada. Recuerda llegar 10 minutos antes.'],
    'class_booked'      => ['Tu clase está reservada',        'Tu clase queda reservada. Recuerda llegar 10 minutos antes.'],
    'rental_booked'     => ['Tu alquiler está confirmado',    'Tu material queda reservado. Puedes recogerlo en la escuela el día indicado.'],
    'booking'           => ['Tu reserva está confirmada',     'Tu reserva queda confirmada. Cualquier duda, respóndenos a este correo.'],
    'bono'              => ['Tu bono está activo',            'Tu bono ya está activo. Puedes usarlo cuando quieras desde tu cuenta.'],
    'enrollment'        => ['Tu inscripción está confirmada', 'Tu inscripción queda confirmada. ¡Nos vemos en el agua!'],
];

[$asunto, $texto] = $plantillas[$tipo] ?? ['Novedades de tu reserva', 'Tenemos novedades sobre tu reserva en Waya Surf School.'];

// Un mensaje escrito a mano desde el panel manda sobre la plantilla.
if (!empty($datos['message'])) $texto = (string) $datos['message'];
if (!empty($datos['subject'])) $asunto = (string) $datos['subject'];

$filas = '';
foreach ([
    'orderId'     => 'Referencia',
    'campName'    => 'Surfcamp',
    'className'   => 'Clase',
    'date'        => 'Fecha',
    'time'        => 'Hora',
    'amount'      => 'Importe',
] as $clave => $etiqueta) {
    if (!empty($datos[$clave])) $filas .= waya_dato($etiqueta, (string) $datos[$clave]);
}

$html = waya_plantilla(
    'Hola, ' . $nombre,
    '<p style="margin:0 0 8px">' . nl2br(htmlspecialchars($texto)) . '</p>'
    . ($filas ? waya_tabla($filas) : ''),
    ['url' => WEB . '/mi-cuenta/#reservas', 'texto' => 'Ver mis reservas']
);

[$ok, $err] = waya_enviar_email($para, $asunto, $html);

if (!$ok) salir(502, ['error' => $err]);
salir(200, ['ok' => true]);
