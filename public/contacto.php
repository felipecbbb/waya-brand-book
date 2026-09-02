<?php
/**
 * Formulario de contacto de reservar.html.
 *
 * Sustituye al antiguo contact-submit.php, que llevaba la contraseña del buzón
 * escrita dentro y estaba versionado en un repo público. Aquí las credenciales
 * vienen de config-secreto.php, que no va a git.
 *
 * Además, aquel fichero nunca llegó a producción: Vite no copia los .php de la
 * raíz, así que el formulario respondía 404 y los mensajes se perdían.
 */

require_once __DIR__ . '/lib-email.php';

/** Vuelve a la página con un aviso, sin dejar al usuario en una pantalla en blanco. */
function volver(string $estado): void
{
    header('Location: /reservar.html?envio=' . $estado);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') volver('error');

$nombre   = trim($_POST['nombre']   ?? $_POST['name']    ?? '');
$email    = trim($_POST['email']    ?? '');
$telefono = trim($_POST['telefono'] ?? $_POST['phone']   ?? '');
$mensaje  = trim($_POST['mensaje']  ?? $_POST['message'] ?? '');

// Trampa antispam: un campo oculto que un humano nunca rellena.
if (!empty($_POST['website'])) volver('ok');

if ($nombre === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) volver('error');

$filas = waya_dato('Nombre', $nombre) . waya_dato('Email', $email);
if ($telefono !== '') $filas .= waya_dato('Teléfono', $telefono);

$html = waya_plantilla(
    'Nueva consulta desde la web',
    '<p style="margin:0 0 8px">Han escrito desde el formulario de reservas.</p>'
    . waya_tabla($filas)
    . '<p style="margin:0 0 6px;color:#666;font-size:13px">Mensaje:</p>'
    . '<p style="margin:0;white-space:pre-wrap">' . htmlspecialchars($mensaje) . '</p>'
);

// Reply-To del cliente: así se le responde directamente desde el correo.
[$ok] = waya_enviar_email(ADMIN_EMAIL, 'Consulta web · ' . $nombre, $html, $email);

volver($ok ? 'ok' : 'error');
