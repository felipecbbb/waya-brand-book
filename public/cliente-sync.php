<?php
/**
 * Sincroniza la ficha de un cliente a partir de su email.
 *
 * Existe por una restricción del esquema: profiles.id es clave foránea de
 * auth.users, así que NO se puede tener ficha de cliente sin cuenta. Sin esto,
 * las reservas que la escuela mete a mano para alguien sin cuenta se quedaban
 * como "invitado" (guest_name/guest_email dentro de la reserva) y ese cliente
 * no aparecía en Clientes ni acumulaba historial.
 *
 * Qué hace:
 *   - Si ya hay perfil con ese email → devuelve su id y completa los huecos.
 *   - Si no → crea la cuenta y el perfil, y devuelve el id.
 *
 * La cuenta se crea SIN contraseña utilizable y sin mandar ningún correo: el
 * cliente no recibe nada ni se entera. Si algún día quiere entrar, usa
 * "he olvidado mi contraseña" y la activa. Es una ficha, no un alta.
 *
 * Solo staff.
 */

require_once __DIR__ . '/config-secreto.php';

header('Content-Type: application/json; charset=utf-8');

function fin(int $codigo, array $cuerpo): void
{
    http_response_code($codigo);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Petición a Supabase con la service_role. */
function sb(string $metodo, string $ruta, ?array $cuerpo = null, array $extra = []): array
{
    $ch = curl_init(WAYA_SUPABASE_URL . $ruta);
    $cabeceras = array_merge([
        'Content-Type: application/json',
        'apikey: ' . WAYA_SERVICE_KEY,
        'Authorization: Bearer ' . WAYA_SERVICE_KEY,
    ], $extra);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $metodo,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => $cabeceras,
    ]);
    if ($cuerpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($cuerpo));
    $resp   = curl_exec($ch);
    $estado = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['status' => $estado, 'json' => json_decode((string) $resp, true)];
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fin(405, ['error' => 'Método no permitido']);

// ---- Solo staff ----
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
if (empty($quien['id'])) fin(401, ['error' => 'Sesión no válida']);

$r = sb('GET', '/rest/v1/profiles?select=role&id=eq.' . rawurlencode($quien['id']));
$rol = $r['json'][0]['role'] ?? '';
if (!in_array($rol, ['admin', 'encargado'], true)) fin(403, ['error' => 'Sin permiso']);

// ---- Datos ----
$in        = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$email     = strtolower(trim((string) ($in['email'] ?? '')));
$nombre    = trim((string) ($in['full_name'] ?? ''));
$apellidos = trim((string) ($in['last_name'] ?? ''));
$telefono  = trim((string) ($in['phone'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fin(400, ['error' => 'Email no válido']);

// ---- ¿Ya existe ficha? ----
$r = sb('GET', '/rest/v1/profiles?select=id,full_name,last_name,phone&email=eq.' . rawurlencode($email));
$existente = $r['json'][0] ?? null;

if ($existente) {
    // Completar solo los huecos: nunca pisar datos que el cliente ya puso.
    $parche = [];
    if (empty($existente['last_name']) && $apellidos !== '') $parche['last_name'] = $apellidos;
    if (empty($existente['phone'])     && $telefono  !== '') $parche['phone']     = $telefono;
    if (empty($existente['full_name']) && $nombre    !== '') $parche['full_name'] = $nombre;
    if ($parche) {
        sb('PATCH', '/rest/v1/profiles?id=eq.' . rawurlencode($existente['id']), $parche,
           ['Prefer: return=minimal']);
    }
    fin(200, ['id' => $existente['id'], 'creado' => false, 'completado' => (bool) $parche]);
}

// ---- Crear cuenta + ficha ----
// email_confirm=true evita que Supabase mande el correo de verificación: esto
// es una ficha interna, el cliente no ha pedido registrarse.
$alta = sb('POST', '/auth/v1/admin/users', [
    'email'         => $email,
    'email_confirm' => true,
    'password'      => bin2hex(random_bytes(24)),   // aleatoria: nadie la conoce
    'user_metadata' => [
        'full_name'   => $nombre ?: $email,
        'last_name'   => $apellidos,
        'phone'       => $telefono,
        'alta_desde'  => 'panel',
    ],
]);

$uid = $alta['json']['id'] ?? null;
if (!$uid) {
    fin(502, ['error' => 'No se pudo crear la ficha: ' . json_encode($alta['json'])]);
}

// El trigger on_auth_user_created ya crea el perfil con el metadata. Se espera
// un instante y se completa por si acaso.
usleep(400000);
sb('PATCH', '/rest/v1/profiles?id=eq.' . rawurlencode($uid), array_filter([
    'full_name' => $nombre ?: null,
    'last_name' => $apellidos ?: null,
    'phone'     => $telefono ?: null,
    'email'     => $email,
]), ['Prefer: return=minimal']);

fin(200, ['id' => $uid, 'creado' => true]);
