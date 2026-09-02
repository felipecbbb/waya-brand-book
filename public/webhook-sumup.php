<?php
/**
 * Webhook de SumUp — confirma los pagos y crea las reservas.
 *
 * SumUp llama aquí cuando un pago llega a estado final. Es lo que hace que la
 * reserva se cree aunque el cliente cierre el navegador nada más pagar: sin
 * esto, un cobro real se quedaría sin reserva asociada.
 *
 * Vive en PHP (y no en una Edge Function) porque el CLI de Supabase no puede
 * enlazar con el proyecto, y una función SQL no sirve: sabe SALIR a internet,
 * pero no RECIBIR peticiones.
 *
 * No se fía del cuerpo que llega: solo saca la referencia y deja que
 * confirmar_pago_sumup() pregunte a SumUp cuál es el estado de verdad. Así, aun
 * si alguien descubre esta URL y la llama a mano, no puede fabricar un pago.
 *
 * Las credenciales viven en config-secreto.php, que NO va a git: el repo es
 * público y la service_role salta el RLS por completo.
 */

require_once __DIR__ . '/config-secreto.php';   // credenciales, fuera de git

define('SUPABASE_URL', WAYA_SUPABASE_URL);
define('SUPABASE_SERVICE_KEY', WAYA_SERVICE_KEY);

const LOG_FILE = __DIR__ . '/webhook-sumup.log';

require_once __DIR__ . '/lib-email.php';

/** Registro mínimo para poder auditar cobros después. */
function apuntar(string $msg): void {
    @file_put_contents(
        LOG_FILE,
        gmdate('c') . ' ' . $msg . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );
}

// SumUp solo manda POST. Cualquier otra cosa se ignora.
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit('Method Not Allowed');
}

$crudo = file_get_contents('php://input') ?: '';
$datos = json_decode($crudo, true);

// La referencia es el id de pending_checkouts, que pusimos como
// checkout_reference al crear el pago. SumUp la devuelve tal cual.
$referencia = $datos['checkout_reference'] ?? ($datos['reference'] ?? null);

// Algunos eventos traen solo el id del checkout; se acepta también.
$checkoutId = $datos['id'] ?? ($datos['checkout_id'] ?? null);

if (!$referencia && !$checkoutId) {
    apuntar('SIN REFERENCIA: ' . substr($crudo, 0, 300));
    http_response_code(200);   // 200 a propósito: que SumUp no reintente en bucle
    exit('ok');
}

/** Llama a una función RPC de Supabase con la service_role key. */
function rpc(string $funcion, array $cuerpo): array {
    $ch = curl_init(SUPABASE_URL . '/rest/v1/rpc/' . $funcion);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'apikey: ' . SUPABASE_SERVICE_KEY,
            'Authorization: Bearer ' . SUPABASE_SERVICE_KEY,
        ],
        CURLOPT_POSTFIELDS => json_encode($cuerpo),
    ]);
    $resp   = curl_exec($ch);
    $estado = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    return ['status' => $estado, 'body' => $resp === false ? $err : $resp];
}

// Si solo tenemos el id de SumUp, se busca la referencia correspondiente.
if (!$referencia && $checkoutId) {
    $ch = curl_init(SUPABASE_URL . '/rest/v1/pending_checkouts?select=id&sumup_checkout_id=eq.'
                    . rawurlencode($checkoutId));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . SUPABASE_SERVICE_KEY,
            'Authorization: Bearer ' . SUPABASE_SERVICE_KEY,
        ],
    ]);
    $filas = json_decode((string) curl_exec($ch), true);
    curl_close($ch);
    $referencia = $filas[0]['id'] ?? null;
}

if (!$referencia) {
    apuntar('NO SE PUDO RESOLVER LA REFERENCIA: ' . substr($crudo, 0, 300));
    http_response_code(200);
    exit('ok');
}

$res = rpc('confirmar_pago_sumup', ['p_referencia' => $referencia]);
apuntar("ref=$referencia status={$res['status']} resp=" . substr((string) $res['body'], 0, 300));

// ---- Correos de confirmación ----
// Solo cuando el pago se confirma DE VERDAD y no se había procesado antes:
// SumUp reintenta el webhook y no queremos mandar el correo dos veces.
$conf = json_decode((string) $res['body'], true);
if (($conf['ok'] ?? false) === true && ($conf['ya_procesado'] ?? false) !== true) {
    $datos = consultar_compra($referencia);
    if ($datos) {
        enviar_correos_compra($datos);
    } else {
        apuntar("ref=$referencia AVISO: pago ok pero no se pudieron leer los datos para el correo");
    }
}

// Siempre 200: si respondemos error, SumUp reintenta en bucle. La función es
// idempotente, así que un reintento legítimo tampoco duplicaría reservas.
http_response_code(200);
echo 'ok';


/* ============================================================
   Correos de confirmación
   ============================================================ */

/** Lee la compra y el email del cliente para componer los correos. */
function consultar_compra(string $referencia): ?array
{
    $url = SUPABASE_URL . '/rest/v1/pending_checkouts'
         . '?select=id,amount,items,paid_at,user_id,profiles(email,full_name)'
         . '&id=eq.' . rawurlencode($referencia);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . SUPABASE_SERVICE_KEY,
            'Authorization: Bearer ' . SUPABASE_SERVICE_KEY,
        ],
    ]);
    $filas = json_decode((string) curl_exec($ch), true);
    curl_close($ch);
    return $filas[0] ?? null;
}

/** Compone y envía los dos correos: al cliente y a la escuela. */
function enviar_correos_compra(array $c): void
{
    $email  = $c['profiles']['email'] ?? '';
    $nombre = trim((string) ($c['profiles']['full_name'] ?? '')) ?: 'surfista';
    $total  = number_format((float) ($c['amount'] ?? 0), 2, ',', '.') . '€';
    $items  = is_array($c['items'] ?? null) ? $c['items'] : [];

    // Detalle compartido por los dos correos
    $filas = '';
    foreach ($items as $i) {
        $nombreItem = (string) ($i['name'] ?? 'Reserva');
        $sub = number_format((float) ($i['subtotal'] ?? 0), 2, ',', '.') . '€';
        if (($i['type'] ?? '') === 'camp') {
            $filas .= waya_dato('Surfcamp · ' . $nombreItem, 'Señal ' . $sub);
        } else {
            $extra = ($i['dateStart'] ?? '') ? ' · ' . $i['dateStart'] : '';
            $filas .= waya_dato('Alquiler · ' . $nombreItem . $extra, $sub);
        }
    }
    $filas .= waya_dato('Total pagado', $total);
    $tabla = waya_tabla($filas);

    // ---- Cliente ----
    if ($email) {
        $html = waya_plantilla(
            '¡Reserva confirmada, ' . htmlspecialchars($nombre) . '!',
            '<p style="margin:0 0 8px">Hemos recibido tu pago y tu plaza ya está guardada. '
            . 'Aquí tienes el resumen:</p>' . $tabla
            . '<p style="margin:0">Si necesitas cambiar algo o tienes cualquier duda, '
            . 'respóndenos a este correo o escríbenos por WhatsApp. ¡Nos vemos en el agua!</p>',
            ['url' => WEB . '/mi-cuenta/#reservas', 'texto' => 'Ver mi reserva']
        );
        [$ok, $err] = waya_enviar_email($email, 'Tu reserva en Waya Surf School', $html);
        apuntar('correo cliente ' . $email . ': ' . ($ok ? 'enviado' : "FALLO ($err)"));
    }

    // ---- Escuela ----
    $htmlAdmin = waya_plantilla(
        'Nueva reserva pagada',
        '<p style="margin:0 0 8px">Entró un pago por la web.</p>'
        . waya_tabla(
            waya_dato('Cliente', $nombre)
            . waya_dato('Email', $email ?: '(sin email)')
            . $filas
          )
        . '<p style="margin:0">Ya está en el panel, en Reservas.</p>',
        ['url' => WEB . '/admin/#reservas', 'texto' => 'Abrir el panel']
    );
    [$ok2, $err2] = waya_enviar_email(ADMIN_EMAIL, 'Nueva reserva pagada · ' . $total, $htmlAdmin, $email ?: '');
    apuntar('correo escuela: ' . ($ok2 ? 'enviado' : "FALLO ($err2)"));
}
