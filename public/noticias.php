<?php
/**
 * Noticias desde el panel (sección "Noticias" de /admin/).
 *
 * La tabla posts tiene RLS que solo deja escribir a info@wayasurf.com
 * (SECURITY_HARDENING.sql), y el equipo entra al panel con su propio email.
 * En vez de abrir la tabla, se escribe aquí con la service_role tras
 * comprobar que quien llama es staff — igual que cliente-sync.php.
 *
 * Acciones (POST JSON, campo "accion"):
 *   - guardar: { id?, title, excerpt, content, category, image }  → crea o edita
 *   - borrar:  { id }
 *   - foto:    { data (base64), ext }  → sube a storage/news-images y devuelve la URL pública
 */

require_once __DIR__ . '/config-secreto.php';

header('Content-Type: application/json; charset=utf-8');

function salir(int $codigo, array $cuerpo): void
{
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

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') salir(405, ['error' => 'Método no permitido']);

// ---- Solo staff ----
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
if (!in_array($perfil[0]['role'] ?? '', ['admin', 'encargado'], true)) {
    salir(403, ['error' => 'Solo el equipo de la escuela puede publicar noticias']);
}

$entrada = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$accion  = (string) ($entrada['accion'] ?? '');
$json    = ['Content-Type: application/json'];

// ---- Subir foto ----
if ($accion === 'foto') {
    $ext = strtolower(preg_replace('/[^a-z]/i', '', (string) ($entrada['ext'] ?? 'jpg')));
    $tipos = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    if (!isset($tipos[$ext])) salir(400, ['error' => 'Formato de imagen no admitido (usa JPG, PNG o WebP)']);
    $bytes = base64_decode((string) ($entrada['data'] ?? ''), true);
    if ($bytes === false || $bytes === '') salir(400, ['error' => 'Imagen vacía o dañada']);
    if (strlen($bytes) > 5 * 1024 * 1024) salir(413, ['error' => 'La imagen pesa más de 5 MB']);

    $ruta = time() . '-' . bin2hex(random_bytes(3)) . '.' . $ext;
    [$codigo, $res] = sb('POST', '/storage/v1/object/news-images/' . $ruta, $bytes, ['Content-Type: ' . $tipos[$ext]]);
    if ($codigo >= 300) salir(502, ['error' => 'No se pudo subir la foto: ' . ($res['message'] ?? $res['error'] ?? $codigo)]);
    salir(200, ['url' => WAYA_SUPABASE_URL . '/storage/v1/object/public/news-images/' . $ruta]);
}

// ---- Borrar ----
if ($accion === 'borrar') {
    $id = (int) ($entrada['id'] ?? 0);
    if ($id <= 0) salir(400, ['error' => 'Falta la noticia']);
    [$codigo, $res] = sb('DELETE', '/rest/v1/posts?id=eq.' . $id);
    if ($codigo >= 300) salir(502, ['error' => $res['message'] ?? 'No se pudo borrar']);
    salir(200, ['ok' => true]);
}

// ---- Guardar (crear o editar) ----
if ($accion === 'guardar') {
    $titulo = trim((string) ($entrada['title'] ?? ''));
    $resumen = trim((string) ($entrada['excerpt'] ?? ''));
    $categoria = (string) ($entrada['category'] ?? 'THOUGHTS');
    // Mismas reglas que las restricciones de la tabla (SECURITY_HARDENING.sql),
    // para devolver un error legible en vez del de Postgres.
    $len = mb_strlen($titulo);
    if ($len < 3 || $len > 140) salir(400, ['error' => 'El título debe tener entre 3 y 140 caracteres']);
    if (mb_strlen($resumen) > 320) salir(400, ['error' => 'El resumen no puede pasar de 320 caracteres']);
    if (!in_array($categoria, ['CULTURE', 'PEOPLE', 'GEAR', 'TRAVEL', 'THOUGHTS'], true)) $categoria = 'THOUGHTS';

    $fila = [
        'title'        => $titulo,
        'excerpt'      => $resumen,
        'content'      => (string) ($entrada['content'] ?? ''),
        'category'     => $categoria,
        'image'        => trim((string) ($entrada['image'] ?? '')) ?: null,
        'is_text_only' => trim((string) ($entrada['image'] ?? '')) === '',
    ];

    $id = (int) ($entrada['id'] ?? 0);
    $ret = array_merge($json, ['Prefer: return=representation']);
    [$codigo, $res] = $id > 0
        ? sb('PATCH', '/rest/v1/posts?id=eq.' . $id, json_encode($fila), $ret)
        : sb('POST', '/rest/v1/posts', json_encode($fila), $ret);
    if ($codigo >= 300) salir(502, ['error' => $res['message'] ?? 'No se pudo guardar']);
    salir(200, ['ok' => true, 'post' => $res[0] ?? null]);
}

salir(400, ['error' => 'Acción desconocida']);
