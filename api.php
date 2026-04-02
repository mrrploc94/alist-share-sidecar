<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ShareDB.php';

header('Content-Type: application/json; charset=utf-8');

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function get_bearer_token(): ?string
{
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $header = $headers['Authorization'] ?? $headers['authorization'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? null;
    if (!is_string($header) || stripos($header, 'Bearer ') !== 0) {
        return null;
    }

    return trim(substr($header, 7));
}

function get_json_body(): array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function alist_request(string $path, array $payload = [], array $headers = [], string $method = 'POST'): array
{
    $url = app_config('alist_api_url') . $path;
    $curl = curl_init($url);
    $headerLines = ['Content-Type: application/json'];

    foreach ($headers as $name => $value) {
        $headerLines[] = $name . ': ' . $value;
    }

    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_HTTPHEADER => $headerLines,
        CURLOPT_TIMEOUT => 30,
    ]);

    if (strtoupper($method) !== 'GET') {
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    $body = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);

    if ($body === false) {
        throw new RuntimeException($error ?: 'AList request failed');
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Invalid JSON from AList');
    }

    $decoded['_http_status'] = $status;
    return $decoded;
}

function viewer_identity(): array
{
    $token = get_bearer_token();
    if ($token === null) {
        json_response(['ok' => false, 'message' => 'Missing viewer token'], 401);
    }

    $result = alist_request('/api/me', [], ['Authorization' => $token]);
    if (($result['code'] ?? 500) !== 200) {
        json_response(['ok' => false, 'message' => 'Viewer token is invalid'], 401);
    }

    return [
        'token' => $token,
        'profile' => $result['data'] ?? [],
    ];
}

function admin_auth_headers(): array
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
        throw new RuntimeException('Missing ALIST_ADMIN_TOKEN or ALIST_ADMIN_USERNAME/ALIST_ADMIN_PASSWORD');
    }

    $login = alist_request('/api/auth/login/hash', [
        'username' => $username,
        'password' => $password,
        'otpcode' => '',
    ]);

    if (($login['code'] ?? 500) !== 200 || empty($login['data']['token'])) {
        throw new RuntimeException('Unable to authenticate admin session');
    }

    $headers = ['Authorization' => (string) $login['data']['token']];
    return $headers;
}

function validate_days(int $days): void
{
    if ($days < 1 || $days > 365) {
        json_response(['ok' => false, 'message' => 'expires_days must be between 1 and 365'], 400);
    }
}

try {
    $db = new ShareDB();
    $action = $_GET['action'] ?? 'list';

    if ($action === 'create') {
        $viewer = viewer_identity();
        $payload = get_json_body();

        $filePath = trim((string) ($payload['file_path'] ?? ''));
        if ($filePath === '' || $filePath[0] !== '/') {
            json_response(['ok' => false, 'message' => 'file_path must be an absolute AList path'], 400);
        }

        $expiresDays = (int) ($payload['expires_days'] ?? 7);
        validate_days($expiresDays);

        $fsGet = alist_request('/api/fs/get', ['path' => $filePath], admin_auth_headers());
        if (($fsGet['code'] ?? 500) !== 200 || empty($fsGet['data']['name'])) {
            $message = $fsGet['message'] ?? 'failed to resolve file';
            json_response(['ok' => false, 'message' => 'File not found on AList: ' . $message], 404);
        }

        $fileName = (string) $fsGet['data']['name'];
        $share = $db->createShare([
            'file_path' => $filePath,
            'file_name' => $fileName,
            'password' => trim((string) ($payload['password'] ?? '')),
            'expires_at' => gmdate('Y-m-d H:i:s', time() + ($expiresDays * 86400)),
            'max_downloads' => max(0, (int) ($payload['max_downloads'] ?? 0)),
            'created_by' => $viewer['profile']['username'] ?? $viewer['profile']['id'] ?? 'viewer',
            'note' => trim((string) ($payload['note'] ?? '')),
        ]);

        json_response([
            'ok' => true,
            'share_id' => $share['share_id'],
            'share_url' => app_config('share_base_url') . '/' . $share['share_id'],
            'share' => $share,
        ]);
    }

    if ($action === 'list') {
        viewer_identity();
        json_response(['ok' => true, 'shares' => $db->listShares()]);
    }

    if ($action === 'delete') {
        viewer_identity();
        $payload = get_json_body();
        $shareId = trim((string) ($payload['share_id'] ?? ''));
        if ($shareId === '') {
            json_response(['ok' => false, 'message' => 'share_id is required'], 400);
        }

        $deleted = $db->deleteShare($shareId);
        json_response(['ok' => $deleted]);
    }

    if ($action === 'cleanup') {
        viewer_identity();
        $count = $db->cleanupExpired((int) app_config('cleanup_after_days'));
        json_response(['ok' => true, 'cleaned' => $count]);
    }

    json_response(['ok' => false, 'message' => 'Unknown action'], 404);
} catch (Throwable $exception) {
    json_response(['ok' => false, 'message' => $exception->getMessage()], 500);
}
