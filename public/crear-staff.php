<?php
/**
 * Alta de personal (admin / encargado) desde el panel.
 *
 * Sustituye a la Edge Function 'create-staff', que nunca se desplegó: daba 404
 * y crear un miembro del equipo fallaba siempre.
 *
 * A diferencia de un cliente, aquí SÍ se fija una contraseña: la persona tiene
 * que poder entrar al panel. La elige quien da el alta y se la comunica.
 *
 * Solo un admin puede crear personal. Un encargado no: si no, cualquiera con
 * acceso al panel podría fabricarse un compañero con más permisos.
 */

require_once __DIR__ . '/config-secreto.php';

header('Content-Type: application/json; charset=utf-8');

function fin(int $codigo, array $cuerpo): void
{
    http_response_code($codigo);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

function sb(string $metodo, string $ruta, ?array $cuerpo = null, array $extra = []): array
{
    $ch = curl_init(WAYA_SUPABASE_URL . $ruta);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $metodo,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => array_merge([
            'Content-Type: application/json',
            'apikey: ' . WAYA_SERVICE_KEY,
            'Authorization: Bearer ' . WAYA_SERVICE_KEY,
        ], $extra),
    ]);
    if ($cuerpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($cuerpo));
    $resp   = curl_exec($ch);
    $estado = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['status' => $estado, 'json' => json_decode((string) $resp, true)];
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fin(405, ['error' => 'Método no permitido']);

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
if (empty($quien['id'])) fin(401, ['error' => 'Sesión no válida']);

$r = sb('GET', '/rest/v1/profiles?select=role&id=eq.' . rawurlencode($quien['id']));
if (($r['json'][0]['role'] ?? '') !== 'admin') {
    fin(403, ['error' => 'Solo un administrador puede dar de alta personal']);
}

// ---- Datos ----
$in       = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$email    = strtolower(trim((string) ($in['email'] ?? '')));
$password = (string) ($in['password'] ?? '');
$nombre   = trim((string) ($in['full_name'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fin(400, ['error' => 'Email no válido']);
if (strlen($password) < 8) fin(400, ['error' => 'La contraseña debe tener al menos 8 caracteres']);
if ($nombre === '') fin(400, ['error' => 'Falta el nombre']);

// ¿Ya existe alguien con ese correo?
$r = sb('GET', '/rest/v1/profiles?select=id,role&email=eq.' . rawurlencode($email));
if (!empty($r['json'][0]['id'])) {
    fin(409, ['error' => 'Ya existe una cuenta con ese email']);
}

// ---- Alta ----
$alta = sb('POST', '/auth/v1/admin/users', [
    'email'         => $email,
    'password'      => $password,
    'email_confirm' => true,          // puede entrar al panel de inmediato
    'user_metadata' => ['full_name' => $nombre],
]);
$uid = $alta['json']['id'] ?? null;
if (!$uid) fin(502, ['error' => 'No se pudo crear la cuenta: ' . json_encode($alta['json'])]);

// El trigger crea el perfil con rol 'client'; aquí se sube a encargado.
usleep(400000);
sb('PATCH', '/rest/v1/profiles?id=eq.' . rawurlencode($uid), [
    'role'      => 'encargado',
    'full_name' => $nombre,
    'email'     => $email,
], ['Prefer: return=minimal']);

fin(200, ['ok' => true, 'user_id' => $uid]);
