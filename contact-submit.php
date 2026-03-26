<?php
declare(strict_types=1);

/**
 * Waya Surf - Contact/Booking mail sender (Hostinger SMTP)
 * Server-side only. Do not expose credentials in frontend JS.
 */

const SMTP_HOST = 'smtp.hostinger.com';
const SMTP_PORT = 465;
const SMTP_USER = 'info@wayasurf.com';
const SMTP_PASS = 'Waya@73:';
const MAIL_TO = 'info@wayasurf.com';
const MAIL_FROM = 'info@wayasurf.com';
const REDIRECT_URL = '/reservar.html';
const MAX_MESSAGE_LEN = 2500;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    redirectWithStatus('error');
}

if (!empty($_POST['website'] ?? '')) {
    // Honeypot triggered.
    redirectWithStatus('ok');
}

if (!isRateAllowed()) {
    redirectWithStatus('error');
}

$nombre = sanitizeText($_POST['nombre'] ?? '', 120);
$email = sanitizeEmail($_POST['email'] ?? '');
$telefono = sanitizeText($_POST['telefono'] ?? '', 60);
$tipoClase = sanitizeText($_POST['tipo_clase'] ?? '', 40);
$mensaje = sanitizeText($_POST['mensaje'] ?? '', MAX_MESSAGE_LEN);

$allowedTypes = ['Privada', 'Grupal', 'Familiar', 'Alquiler', 'Otro'];
if (!in_array($tipoClase, $allowedTypes, true)) {
    $tipoClase = 'Otro';
}

if ($nombre === '' || $email === '' || $telefono === '') {
    redirectWithStatus('error');
}

$subjectText = 'Nueva reserva web - ' . $tipoClase;
$subject = mimeHeader($subjectText);

$lines = [
    'Nueva solicitud desde wayasurf.com',
    'Fecha: ' . date('Y-m-d H:i:s'),
    '',
    'Nombre: ' . $nombre,
    'Email: ' . $email,
    'Telefono: ' . $telefono,
    'Curso: ' . $tipoClase,
    '',
    'Mensaje:',
    $mensaje !== '' ? $mensaje : '(sin mensaje)',
    '',
    'IP origen: ' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'),
];

$body = normalizeLineBreaks(implode("\n", $lines));

$headers = [
    'Date: ' . date(DATE_RFC2822),
    'From: Waya Surf <' . MAIL_FROM . '>',
    'To: ' . MAIL_TO,
    'Reply-To: ' . $email,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
];

try {
    smtpSendMail(MAIL_FROM, MAIL_TO, $subject, $body, $headers);
    redirectWithStatus('ok');
} catch (Throwable $e) {
    error_log('[Waya Contact] SMTP send error: ' . $e->getMessage());
    redirectWithStatus('error');
}

function redirectWithStatus(string $status): never
{
    $status = $status === 'ok' ? 'ok' : 'error';
    $target = REDIRECT_URL . '?status=' . urlencode($status);
    header('Location: ' . $target, true, 303);
    exit;
}

function sanitizeText(string $value, int $maxLen): string
{
    $value = trim($value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', ' ', $value) ?? '';
    return mb_substr($value, 0, $maxLen);
}

function sanitizeEmail(string $value): string
{
    $email = filter_var(trim($value), FILTER_VALIDATE_EMAIL);
    return $email ? mb_substr($email, 0, 180) : '';
}

function normalizeLineBreaks(string $value): string
{
    $value = str_replace(["\r\n", "\r"], "\n", $value);
    $value = str_replace("\0", '', $value);
    return preg_replace("/\n{3,}/", "\n\n", $value) ?? $value;
}

function mimeHeader(string $text): string
{
    return '=?UTF-8?B?' . base64_encode($text) . '?=';
}

function isRateAllowed(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $key = hash('sha256', $ip);
    $file = sys_get_temp_dir() . '/waya_form_rate_' . $key;
    $now = time();

    if (is_file($file)) {
        $last = (int)file_get_contents($file);
        if ($now - $last < 15) {
            return false;
        }
    }

    @file_put_contents($file, (string)$now, LOCK_EX);
    return true;
}

function smtpSendMail(string $from, string $to, string $subject, string $body, array $headers): void
{
    $errno = 0;
    $errstr = '';
    $timeout = 20;
    $conn = @stream_socket_client(
        'ssl://' . SMTP_HOST . ':' . SMTP_PORT,
        $errno,
        $errstr,
        $timeout,
        STREAM_CLIENT_CONNECT
    );

    if (!$conn) {
        throw new RuntimeException("SMTP connect failed: {$errstr} ({$errno})");
    }

    stream_set_timeout($conn, $timeout);

    try {
        smtpExpect($conn, [220]);
        smtpCommand($conn, 'EHLO wayasurf.com', [250]);
        smtpCommand($conn, 'AUTH LOGIN', [334]);
        smtpCommand($conn, base64_encode(SMTP_USER), [334]);
        smtpCommand($conn, base64_encode(SMTP_PASS), [235]);
        smtpCommand($conn, 'MAIL FROM:<' . $from . '>', [250]);
        smtpCommand($conn, 'RCPT TO:<' . $to . '>', [250, 251]);
        smtpCommand($conn, 'DATA', [354]);

        $message = implode("\r\n", $headers) . "\r\n";
        $message .= 'Subject: ' . $subject . "\r\n\r\n";
        $message .= dotStuff(normalizeLineBreaks($body)) . "\r\n.\r\n";
        fwrite($conn, $message);
        smtpExpect($conn, [250]);

        smtpCommand($conn, 'QUIT', [221]);
    } finally {
        fclose($conn);
    }
}

function dotStuff(string $body): string
{
    $lines = preg_split('/\n/', $body) ?: [];
    $safe = [];
    foreach ($lines as $line) {
        $line = rtrim($line, "\r");
        if (isset($line[0]) && $line[0] === '.') {
            $line = '.' . $line;
        }
        $safe[] = $line;
    }
    return implode("\r\n", $safe);
}

function smtpCommand($conn, string $command, array $expect): void
{
    fwrite($conn, $command . "\r\n");
    smtpExpect($conn, $expect);
}

function smtpExpect($conn, array $expectedCodes): void
{
    $response = smtpReadResponse($conn);
    $code = (int)substr($response, 0, 3);
    if (!in_array($code, $expectedCodes, true)) {
        throw new RuntimeException('SMTP unexpected response: ' . trim($response));
    }
}

function smtpReadResponse($conn): string
{
    $response = '';
    while (($line = fgets($conn, 515)) !== false) {
        $response .= $line;
        if (preg_match('/^\d{3}\s/', $line) === 1) {
            break;
        }
    }

    if ($response === '') {
        throw new RuntimeException('SMTP empty response');
    }
    return $response;
}
