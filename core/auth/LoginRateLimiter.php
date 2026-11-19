<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

/**
 * Small, dependency-free login throttle for the local fallback login.
 * Identifiers are hashed before they are written and records expire automatically.
 */
final class LoginRateLimiter
{
    private const WINDOW_SECONDS = 900;
    private const MAX_ATTEMPTS = 5;

    public static function isBlocked(string $clientAddress, string $username, ?int $now = null): bool
    {
        $record = self::readRecord($clientAddress, $username, $now ?? time());
        return count($record['attempts']) >= self::MAX_ATTEMPTS;
    }

    public static function registerFailure(string $clientAddress, string $username, ?int $now = null): void
    {
        $timestamp = $now ?? time();
        $path = self::recordPath($clientAddress, $username);
        $record = self::readRecord($clientAddress, $username, $timestamp);
        $record['attempts'][] = $timestamp;
        self::writeRecord($path, $record);
    }

    public static function clear(string $clientAddress, string $username): void
    {
        $path = self::recordPath($clientAddress, $username);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private static function readRecord(string $clientAddress, string $username, int $now): array
    {
        $path = self::recordPath($clientAddress, $username);
        $attempts = [];
        if (is_file($path)) {
            $decoded = json_decode((string)@file_get_contents($path), true);
            if (is_array($decoded['attempts'] ?? null)) {
                $attempts = $decoded['attempts'];
            }
        }

        $cutoff = $now - self::WINDOW_SECONDS;
        $attempts = array_values(array_filter($attempts, static function ($value) use ($cutoff): bool {
            return is_int($value) && $value > $cutoff;
        }));

        return ['attempts' => $attempts];
    }

    private static function recordPath(string $clientAddress, string $username): string
    {
        $directory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'takeoff-login-rate';
        if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new \RuntimeException('Unable to initialize login rate limiting.');
        }

        $key = hash('sha256', trim($clientAddress) . "\0" . strtolower(trim($username)));
        return $directory . DIRECTORY_SEPARATOR . $key . '.json';
    }

    private static function writeRecord(string $path, array $record): void
    {
        $encoded = json_encode($record, JSON_UNESCAPED_SLASHES);
        if ($encoded === false || @file_put_contents($path, $encoded, LOCK_EX) === false) {
            throw new \RuntimeException('Unable to persist login rate limiting.');
        }
        @chmod($path, 0600);
    }
}
