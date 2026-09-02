<?php
/**
 * Envío de correos de Waya Surf School.
 *
 * SMTP hablado a mano por sockets, sin PHPMailer ni Composer: Hostinger no
 * garantiza que estén disponibles y esto no necesita instalar nada.
 *
 * Se usa SMTP autenticado en vez de mail(): los correos enviados con mail()
 * desde hosting compartido acaban en spam casi siempre, y aquí van
 * confirmaciones de compra que el cliente TIENE que recibir.
 *
 * Configuración: rellenar SMTP_PASS con la contraseña del buzón
 * info@wayasurf.com (hPanel → Correos → Cuentas de correo).
 */

require_once __DIR__ . '/config-secreto.php';   // credenciales, fuera de git

const SMTP_HOST   = 'smtp.hostinger.com';
const SMTP_PORT   = 465;              // SSL directo
const SMTP_USER   = 'info@wayasurf.com';
define('SMTP_PASS', WAYA_SMTP_PASS);
const SMTP_FROM   = 'info@wayasurf.com';
const SMTP_NOMBRE = 'Waya Surf School';
const ADMIN_EMAIL = 'info@wayasurf.com';   // copia interna de cada reserva

const WEB = 'https://wayasurf.com';

/* ============================================================
   SMTP
   ============================================================ */

/** Diálogo SMTP mínimo. Devuelve [ok, mensajeDeError]. */
function waya_enviar_email(string $para, string $asunto, string $html, string $responder_a = ''): array
{
    if (SMTP_PASS === 'PENDIENTE' || SMTP_PASS === '') {
        return [false, 'Falta la contraseña del buzón en config-secreto.php'];
    }

    $socket = @fsockopen('ssl://' . SMTP_HOST, SMTP_PORT, $errno, $errstr, 20);
    if (!$socket) return [false, "No se pudo conectar al SMTP: $errstr ($errno)"];

    $leer = function () use ($socket): string {
        $out = '';
        while ($linea = fgets($socket, 515)) {
            $out .= $linea;
            // La última línea de una respuesta lleva espacio tras el código.
            if (isset($linea[3]) && $linea[3] === ' ') break;
        }
        return $out;
    };
    $decir = function (string $cmd) use ($socket, $leer): string {
        fwrite($socket, $cmd . "\r\n");
        return $leer();
    };

    $leer();                                   // saludo del servidor
    $decir('EHLO wayasurf.com');
    $decir('AUTH LOGIN');
    $decir(base64_encode(SMTP_USER));
    $r = $decir(base64_encode(SMTP_PASS));
    if (strpos($r, '235') === false) {
        fclose($socket);
        return [false, 'SMTP rechazó las credenciales: ' . trim($r)];
    }

    $decir('MAIL FROM:<' . SMTP_FROM . '>');
    $r = $decir('RCPT TO:<' . $para . '>');
    if ($r === '' || (strpos($r, '250') === false && strpos($r, '251') === false)) {
        fclose($socket);
        return [false, 'SMTP rechazó el destinatario: ' . trim($r)];
    }
    $decir('DATA');

    $limite  = 'waya' . bin2hex(random_bytes(8));
    $cabezas = [
        'From: ' . mb_encode_mimeheader(SMTP_NOMBRE, 'UTF-8') . ' <' . SMTP_FROM . '>',
        'To: <' . $para . '>',
        'Subject: ' . mb_encode_mimeheader($asunto, 'UTF-8'),
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $limite . '"',
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@wayasurf.com>',
    ];
    if ($responder_a) $cabezas[] = 'Reply-To: <' . $responder_a . '>';

    // Versión de texto plano para clientes que no pintan HTML (y mejora la
    // puntuación antispam).
    $texto = trim(html_entity_decode(strip_tags(preg_replace('/<(style|script)[^>]*>.*?<\/\1>/is', '', $html)), ENT_QUOTES, 'UTF-8'));
    $texto = preg_replace("/\n{3,}/", "\n\n", $texto);

    $cuerpo = implode("\r\n", $cabezas) . "\r\n\r\n"
        . "--$limite\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
        . $texto . "\r\n"
        . "--$limite\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
        . $html . "\r\n"
        . "--$limite--\r\n.";

    $r = $decir($cuerpo);
    $decir('QUIT');
    fclose($socket);

    if (strpos($r, '250') === false) return [false, 'SMTP no aceptó el mensaje: ' . trim($r)];
    return [true, ''];
}

/* ============================================================
   Plantilla — diseño de la web (amarillo #FDD802 sobre #1a1a1a)
   ============================================================ */

/**
 * Los correos se maquetan con tablas y estilos en línea a propósito: Gmail y
 * Outlook descartan las hojas de estilo y buena parte de flex/grid.
 *
 * El logo es un PNG con el fondo ya incrustado (logo-email.png), no el .webp
 * de la web: Outlook y parte de Gmail no pintan WebP, y la transparencia la
 * aplanan por su cuenta dejando un recuadro sucio. Va a 3x del tamaño de
 * visualización para que no pixele en pantallas retina.
 *
 * Lleva ?v=N a propósito: el .htaccess cachea las imágenes 30 días en el CDN
 * de Hostinger, así que al cambiar el logo hay que subir ese número o los
 * clientes seguirían viendo el anterior durante un mes.
 */
function waya_plantilla(string $titulo, string $contenido, array $cta = []): string
{
    $botón = '';
    if (!empty($cta['url'])) {
        $botón = '
        <tr><td align="center" style="padding:8px 0 32px">
          <a href="' . htmlspecialchars($cta['url']) . '"
             style="display:inline-block;background:#FDD802;color:#1a1a1a;text-decoration:none;
                    font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;
                    letter-spacing:.04em;text-transform:uppercase;padding:14px 32px;border-radius:50px">'
            . htmlspecialchars($cta['texto'] ?? 'Ver más') . '</a>
        </td></tr>';
    }

    return '<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>' . htmlspecialchars($titulo) . '</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px">
 <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">

   <tr><td style="background:#1a1a1a;padding:28px 32px;text-align:center">
     <img src="' . WEB . '/images/logo-email.png?v=2" alt="Waya Surf School"
          width="120" height="120"
          style="display:block;margin:0 auto;border:0;width:120px;height:120px">
   </td></tr>

   <tr><td style="padding:36px 32px 8px">
     <h1 style="margin:0 0 16px;font-family:Helvetica,Arial,sans-serif;font-size:24px;
                line-height:1.25;color:#1a1a1a;font-weight:800">' . htmlspecialchars($titulo) . '</h1>
     <div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#444">'
             . $contenido . '</div>
   </td></tr>
   ' . $botón . '

   <tr><td style="background:#1a1a1a;padding:24px 32px;text-align:center">
     <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#bbb">
       Waya Surf School · Playa del Hombre, Telde · Gran Canaria</p>
     <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px">
       <a href="https://wa.me/34636562448" style="color:#FDD802;text-decoration:none">+34 636 56 24 48</a>
       &nbsp;·&nbsp;
       <a href="mailto:info@wayasurf.com" style="color:#FDD802;text-decoration:none">info@wayasurf.com</a>
     </p>
   </td></tr>

  </table>
 </td></tr>
</table>
</body></html>';
}

/** Fila de la tabla de detalles. */
function waya_dato(string $etiqueta, string $valor): string
{
    return '<tr>
      <td style="padding:9px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#666">'
        . htmlspecialchars($etiqueta) . '</td>
      <td align="right" style="padding:9px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;
                               color:#1a1a1a;font-weight:700">' . htmlspecialchars($valor) . '</td>
    </tr>';
}

/** Envuelve varias filas de datos en su tabla. */
function waya_tabla(string $filas): string
{
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:20px 0;border-top:1px solid #eee;border-bottom:1px solid #eee">'
             . $filas . '</table>';
}
