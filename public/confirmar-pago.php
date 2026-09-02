<?php
/**
 * Confirma un pago al volver de SumUp.
 *
 * SumUp no ofrece webhooks en esta cuenta (Ajustes de desarrollador solo tiene
 * entornos de prueba, claves API, OAuth2 y affiliate keys), así que no hay
 * quien nos avise del cobro. En su lugar:
 *
 *   1. Esta página la llama pago-ok.html en cuanto el cliente vuelve → la
 *      reserva se crea al instante, mientras mira la pantalla.
 *   2. Un cron cada pocos minutos recoge los que se quedaron atrás porque el
 *      cliente cerró el navegador antes de volver.
 *
 * No se fía de nada de lo que llega: confirmar_pago_sumup() pregunta a SumUp
 * cuál es el estado real antes de crear ninguna reserva. Y es idempotente, así
 * que da igual que la llamen las dos vías a la vez.
 *
 * Solo el dueño del checkout puede confirmarlo (o el staff).
 */

require_once __DIR__ . '/config-secreto.php';

header('Content-Type: application/json; charset=utf-8');

function fin(int $codigo, array $cuerpo): void
{
    http_response_code($codigo);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

function sb(string $metodo, string $ruta, ?array $cuerpo = null): array
{
    $ch = curl_init(WAYA_SUPABASE_URL . $ruta);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $metodo,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'apikey: ' . WAYA_SERVICE_KEY,
            'Authorization: Bearer ' . WAYA_SERVICE_KEY,
        ],
    ]);
    if ($cuerpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($cuerpo));
    $resp   = curl_exec($ch);
    $estado = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['status' => $estado, 'json' => json_decode((string) $resp, true)];
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fin(405, ['error' => 'Método no permitido']);

$in  = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$ref = trim((string) ($in['ref'] ?? ''));
if (!preg_match('/^[0-9a-f-]{36}$/i', $ref)) fin(400, ['error' => 'Referencia no válida']);

// ---- Quién llama ----
$cabeceras = function_exists('getallheaders') ? getallheaders() : [];
$auth = '';
foreach ($cabeceras as $k => $v) {
    if (strtolower($k) === 'authorization') { $auth = $v; break; }
}
if ($auth === '') fin(401, ['error' => 'Falta la sesión']);

$ch = curl_init(WAYA_SUPABASE_URL . '/auth/v1/user');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => ['apikey: ' . WAYA_SERVICE_KEY, 'Authorization: ' . $auth],
]);
$quien = json_decode((string) curl_exec($ch), true);
curl_close($ch);
$uid = $quien['id'] ?? null;
if (!$uid) fin(401, ['error' => 'Sesión no válida']);

// ---- El checkout tiene que ser suyo ----
$r = sb('GET', '/rest/v1/pending_checkouts?select=id,user_id,status&id=eq.' . rawurlencode($ref));
$fila = $r['json'][0] ?? null;
if (!$fila) fin(404, ['error' => 'Pago no encontrado']);

if ($fila['user_id'] !== $uid) {
    $p = sb('GET', '/rest/v1/profiles?select=role&id=eq.' . rawurlencode($uid));
    if (!in_array($p['json'][0]['role'] ?? '', ['admin', 'encargado'], true)) {
        fin(403, ['error' => 'Este pago no es tuyo']);
    }
}

// ---- Confirmar ----
$res  = sb('POST', '/rest/v1/rpc/confirmar_pago_sumup', ['p_referencia' => $ref]);
$conf = $res['json'] ?? [];

// Correos solo la primera vez que se confirma de verdad.
if (($conf['ok'] ?? false) === true && ($conf['ya_procesado'] ?? false) !== true) {
    require_once __DIR__ . '/lib-email.php';
    $c = sb('GET', '/rest/v1/pending_checkouts'
        . '?select=id,amount,items,user_id,profiles(email,full_name)&id=eq.' . rawurlencode($ref));
    $compra = $c['json'][0] ?? null;
    if ($compra) {
        $email  = $compra['profiles']['email'] ?? '';
        $nombre = trim((string) ($compra['profiles']['full_name'] ?? '')) ?: 'surfista';
        $total  = number_format((float) ($compra['amount'] ?? 0), 2, ',', '.') . '€';

        $filas = '';
        foreach ((array) ($compra['items'] ?? []) as $i) {
            $sub = number_format((float) ($i['subtotal'] ?? 0), 2, ',', '.') . '€';
            $etq = ($i['type'] ?? '') === 'camp' ? 'Surfcamp' : ((($i['type'] ?? '') === 'pack') ? 'Clases' : 'Alquiler');
            $filas .= waya_dato($etq . ' · ' . (string) ($i['name'] ?? ''), $sub);
        }
        $filas .= waya_dato('Total pagado', $total);

        if ($email) {
            waya_enviar_email($email, 'Tu reserva en Waya Surf School', waya_plantilla(
                '¡Reserva confirmada, ' . htmlspecialchars($nombre) . '!',
                '<p style="margin:0 0 8px">Hemos recibido tu pago y tu plaza ya está guardada.</p>'
                . waya_tabla($filas)
                . '<p style="margin:0">Cualquier duda, respóndenos a este correo. ¡Nos vemos en el agua!</p>',
                ['url' => WEB . '/mi-cuenta/#reservas', 'texto' => 'Ver mi reserva']));
        }
        waya_enviar_email(ADMIN_EMAIL, 'Nueva reserva pagada · ' . $total, waya_plantilla(
            'Nueva reserva pagada',
            '<p style="margin:0 0 8px">Entró un pago por la web.</p>'
            . waya_tabla(waya_dato('Cliente', $nombre) . waya_dato('Email', $email ?: '(sin email)') . $filas),
            ['url' => WEB . '/admin/#reservas', 'texto' => 'Abrir el panel']),
            $email ?: '');
    }
}

fin(200, $conf ?: ['ok' => false]);
