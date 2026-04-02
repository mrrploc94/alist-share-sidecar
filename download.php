<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ShareDB.php';

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function alist_admin_headers(): array
{
    static $headers = null;
    if ($headers !== null) {
        return $headers;
    }

    $token = app_config('admin_token');
    if (is_string($token) && trim($token) !== '') {
        $headers = ['Authorization' => trim($token)];
        return $headers;
    }

    $username = app_config('admin_username');
    $password = app_config('admin_password');
    if (!$username || !$password) {
        throw new RuntimeException('Missing admin credentials for AList');
    }

    $curl = curl_init(app_config('alist_api_url') . '/api/auth/login/hash');
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode([
            'username' => $username,
            'password' => $password,
            'otpcode' => '',
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ]);

    $body = curl_exec($curl);
    $error = curl_error($curl);
    curl_close($curl);

    if ($body === false) {
        throw new RuntimeException($error ?: 'Unable to login to AList');
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded) || ($decoded['code'] ?? 500) !== 200 || empty($decoded['data']['token'])) {
        throw new RuntimeException('Unable to login to AList');
    }

    $headers = ['Authorization' => (string) $decoded['data']['token']];
    return $headers;
}

function alist_fs_get(string $filePath): array
{
    $curl = curl_init(app_config('alist_api_url') . '/api/fs/get');
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: ' . alist_admin_headers()['Authorization'],
        ],
        CURLOPT_POSTFIELDS => json_encode(['path' => $filePath], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ]);

    $body = curl_exec($curl);
    $error = curl_error($curl);
    curl_close($curl);

    if ($body === false) {
        throw new RuntimeException($error ?: 'Unable to resolve file from AList');
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded) || ($decoded['code'] ?? 500) !== 200 || empty($decoded['data'])) {
        $message = is_array($decoded) ? ($decoded['message'] ?? 'Unknown error') : 'Invalid AList response';
        throw new RuntimeException('File not found on AList: ' . $message);
    }

    return $decoded['data'];
}

function signed_download_url(string $filePath, array $alistData): ?string
{
    $sign = $alistData['sign'] ?? null;
    if (!is_string($sign) || trim($sign) === '') {
        return null;
    }

    return app_config('alist_public_url') . '/d' . $filePath . '?sign=' . rawurlencode($sign);
}

function render_page(string $title, string $content): void
{
    $appName = (string) app_config('app_name');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . h($title) . ' - ' . h($appName) . '</title>';
    echo '<style>
        body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#1f1d46;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
        .card{width:min(92vw,520px);background:#2c2858;border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:32px;box-shadow:0 30px 70px rgba(0,0,0,.35)}
        h1{margin:0 0 12px;font-size:32px}
        p{color:#cfd1ff;line-height:1.5}
        .meta{padding:16px;background:rgba(255,255,255,.05);border-radius:16px;margin:20px 0}
        .button{display:inline-block;background:linear-gradient(90deg,#6979f8,#9857d3);color:#fff;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:600;border:0;cursor:pointer}
        .input{width:100%;box-sizing:border-box;padding:14px 16px;border-radius:14px;border:1px solid #5162d3;background:#38356a;color:#fff;margin:12px 0 16px}
        .notice{padding:14px 16px;border-radius:14px;background:rgba(255,93,93,.14);color:#ffb0b0;margin:16px 0}
        .muted{font-size:14px;color:#aeb2ef}
    </style></head><body><main class="card">' . $content . '</main></body></html>';
    exit;
}

$db = new ShareDB();
$shareId = trim((string) ($_GET['id'] ?? ''));
$action = trim((string) ($_GET['action'] ?? ''));

if ($shareId === '' && preg_match('#/s/([A-Za-z0-9_-]+)#', $_SERVER['REQUEST_URI'] ?? '', $matches)) {
    $shareId = $matches[1];
}

if ($shareId === '') {
    http_response_code(404);
    render_page('Share not found', '<h1>Share not found</h1><p>No share id was provided.</p>');
}

$share = $db->getShare($shareId);
if ($share === null || (int) $share['is_active'] !== 1) {
    http_response_code(404);
    render_page('Share not found', '<h1>Share not found</h1><p>This share is missing or inactive.</p>');
}

if ($db->isExpired($share)) {
    http_response_code(410);
    render_page('Share expired', '<h1>Share expired</h1><p>This link is no longer available.</p>');
}

if ($db->isMaxDownloadsReached($share)) {
    http_response_code(410);
    render_page('Limit reached', '<h1>Download limit reached</h1><p>This share already used all available downloads.</p>');
}

$requiresPassword = !empty($share['password_hash']);
$password = $_POST['password'] ?? null;
$passwordOk = !$requiresPassword || $db->verifyPassword($share, is_string($password) ? $password : null);

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'download' && !$passwordOk) {
    render_page(
        'Protected file',
        '<h1>Protected file</h1><div class="notice">Incorrect password. Please try again.</div>' .
        '<form method="post" action="?id=' . h($shareId) . '&action=download">' .
        '<div class="meta"><strong>' . h((string) $share['file_name']) . '</strong></div>' .
        '<input class="input" type="password" name="password" placeholder="Enter password" autofocus>' .
        '<button class="button" type="submit">Continue</button></form>'
    );
}

if ($action === 'download') {
    try {
        $alistData = alist_fs_get((string) $share['file_path']);
        $downloadUrl = signed_download_url((string) $share['file_path'], $alistData);

        if ($downloadUrl === null) {
            $rawUrl = $alistData['raw_url'] ?? null;
            if (!is_string($rawUrl) || trim($rawUrl) === '') {
                throw new RuntimeException('AList did not return a signed URL or raw_url');
            }
            $downloadUrl = $rawUrl;
        }

        $db->incrementDownload($shareId);
        header('Location: ' . $downloadUrl, true, 302);
        exit;
    } catch (Throwable $exception) {
        http_response_code(502);
        render_page('Download failed', '<h1>Download failed</h1><div class="notice">' . h($exception->getMessage()) . '</div>');
    }
}

if ($requiresPassword && !$passwordOk) {
    render_page(
        'Protected file',
        '<h1>Protected file</h1><p>This share requires a password before download.</p>' .
        '<form method="post" action="?id=' . h($shareId) . '&action=download">' .
        '<div class="meta"><strong>' . h((string) $share['file_name']) . '</strong><div class="muted">Path: ' . h((string) $share['file_path']) . '</div></div>' .
        '<input class="input" type="password" name="password" placeholder="Enter password" autofocus>' .
        '<button class="button" type="submit">Unlock download</button></form>'
    );
}

$content = '<h1>' . h((string) $share['file_name']) . '</h1>';
$content .= '<p>Download this file through a signed AList link. Private storage stays protected by the sidecar.</p>';
$content .= '<div class="meta"><div><strong>Path</strong></div><div class="muted">' . h((string) $share['file_path']) . '</div></div>';
$content .= '<a class="button" href="?id=' . h($shareId) . '&action=download">Download</a>';

if (!empty($share['expires_at'])) {
    $content .= '<p class="muted">Expires at: ' . h((string) $share['expires_at']) . ' UTC</p>';
}

render_page('Download', $content);
