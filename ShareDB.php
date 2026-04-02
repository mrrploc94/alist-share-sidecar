<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';

final class ShareDB
{
    private PDO $pdo;

    public function __construct()
    {
        $dbPath = (string) app_config('db_path');
        $dbDir = dirname($dbPath);
        if (!is_dir($dbDir)) {
            mkdir($dbDir, 0775, true);
        }

        $this->pdo = new PDO('sqlite:' . $dbPath);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->init();
    }

    private function init(): void
    {
        $this->pdo->exec(
            'CREATE TABLE IF NOT EXISTS shares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                share_id TEXT NOT NULL UNIQUE,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                password_hash TEXT DEFAULT NULL,
                expires_at TEXT DEFAULT NULL,
                created_at TEXT NOT NULL,
                download_count INTEGER NOT NULL DEFAULT 0,
                max_downloads INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_by TEXT DEFAULT NULL,
                note TEXT DEFAULT NULL
            )'
        );
    }

    public function createShare(array $payload): array
    {
        $shareId = $payload['share_id'] ?? $this->generateShareId();
        $createdAt = gmdate('Y-m-d H:i:s');
        $passwordHash = null;

        if (!empty($payload['password'])) {
            $passwordHash = password_hash((string) $payload['password'], PASSWORD_DEFAULT);
        }

        $statement = $this->pdo->prepare(
            'INSERT INTO shares (
                share_id,
                file_path,
                file_name,
                password_hash,
                expires_at,
                created_at,
                max_downloads,
                created_by,
                note
            ) VALUES (
                :share_id,
                :file_path,
                :file_name,
                :password_hash,
                :expires_at,
                :created_at,
                :max_downloads,
                :created_by,
                :note
            )'
        );

        $statement->execute([
            ':share_id' => $shareId,
            ':file_path' => (string) $payload['file_path'],
            ':file_name' => (string) $payload['file_name'],
            ':password_hash' => $passwordHash,
            ':expires_at' => $payload['expires_at'] ?? null,
            ':created_at' => $createdAt,
            ':max_downloads' => max(0, (int) ($payload['max_downloads'] ?? 0)),
            ':created_by' => $payload['created_by'] ?? null,
            ':note' => $payload['note'] ?? null,
        ]);

        return $this->getShare($shareId) ?? [];
    }

    public function getShare(string $shareId): ?array
    {
        $statement = $this->pdo->prepare('SELECT * FROM shares WHERE share_id = :share_id LIMIT 1');
        $statement->execute([':share_id' => $shareId]);
        $share = $statement->fetch();

        return $share === false ? null : $share;
    }

    public function listShares(): array
    {
        $statement = $this->pdo->query('SELECT * FROM shares ORDER BY id DESC');
        return $statement->fetchAll() ?: [];
    }

    public function deleteShare(string $shareId): bool
    {
        $statement = $this->pdo->prepare('UPDATE shares SET is_active = 0 WHERE share_id = :share_id');
        $statement->execute([':share_id' => $shareId]);

        return $statement->rowCount() > 0;
    }

    public function cleanupExpired(int $olderThanDays): int
    {
        $threshold = gmdate('Y-m-d H:i:s', time() - ($olderThanDays * 86400));
        $statement = $this->pdo->prepare(
            'UPDATE shares
             SET is_active = 0
             WHERE is_active = 1
               AND (
                   (expires_at IS NOT NULL AND expires_at <= :now)
                   OR created_at <= :threshold
               )'
        );
        $statement->execute([
            ':now' => gmdate('Y-m-d H:i:s'),
            ':threshold' => $threshold,
        ]);

        return $statement->rowCount();
    }

    public function incrementDownload(string $shareId): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE shares SET download_count = download_count + 1 WHERE share_id = :share_id'
        );
        $statement->execute([':share_id' => $shareId]);
    }

    public function isExpired(array $share): bool
    {
        if (empty($share['expires_at'])) {
            return false;
        }

        return strtotime((string) $share['expires_at']) <= time();
    }

    public function isMaxDownloadsReached(array $share): bool
    {
        $maxDownloads = (int) ($share['max_downloads'] ?? 0);
        if ($maxDownloads <= 0) {
            return false;
        }

        return (int) ($share['download_count'] ?? 0) >= $maxDownloads;
    }

    public function verifyPassword(array $share, ?string $password): bool
    {
        $passwordHash = $share['password_hash'] ?? null;
        if (empty($passwordHash)) {
            return true;
        }

        return is_string($password) && password_verify($password, (string) $passwordHash);
    }

    private function generateShareId(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(6)), '+/', '-_'), '=');
    }
}
