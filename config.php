<?php

declare(strict_types=1);

function env_value(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    if ($value === false || $value === '') {
        return $default;
    }

    return $value;
}

function app_config(?string $key = null)
{
    static $config = null;

    if ($config === null) {
        $config = [
            'app_name' => env_value('SHARE_APP_NAME', 'AList Share'),
            'alist_api_url' => rtrim(env_value('ALIST_API_URL', 'http://127.0.0.1:5244'), '/'),
            'alist_public_url' => rtrim(env_value('ALIST_PUBLIC_URL', 'http://127.0.0.1:5244'), '/'),
            'share_base_url' => rtrim(env_value('SHARE_BASE_URL', 'http://127.0.0.1:8080/s'), '/'),
            'db_path' => env_value('SHARE_DB_PATH', __DIR__ . DIRECTORY_SEPARATOR . 'db' . DIRECTORY_SEPARATOR . 'shares.db'),
            'cleanup_after_days' => max(1, (int) env_value('SHARE_CLEANUP_AFTER_DAYS', '30')),
            'max_proxy_size' => max(0, (int) env_value('SHARE_MAX_PROXY_SIZE', '5368709120')),
            'admin_token' => env_value('ALIST_ADMIN_TOKEN'),
            'admin_username' => env_value('ALIST_ADMIN_USERNAME'),
            'admin_password' => env_value('ALIST_ADMIN_PASSWORD'),
        ];
    }

    if ($key === null) {
        return $config;
    }

    return $config[$key] ?? null;
}
