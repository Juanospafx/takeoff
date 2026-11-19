<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/auth/session.php';

$user = takeoff_guard_api_action('download', ['download'], []);

$scope = (string)($_GET['scope'] ?? '');
$relativePath = rawurldecode((string)($_GET['path'] ?? ''));
$roots = [
    'uploads' => dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads',
    'api_uploads' => __DIR__ . DIRECTORY_SEPARATOR . 'uploads',
];

if (!isset($roots[$scope]) || $relativePath === '' || str_contains($relativePath, "\0")) {
    http_response_code(400);
    exit('Invalid download request');
}

$base = realpath($roots[$scope]);
$candidate = $base !== false
    ? realpath($base . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $relativePath))
    : false;

if ($base === false || $candidate === false || !is_file($candidate)) {
    http_response_code(404);
    exit('File not found');
}

$basePrefix = rtrim($base, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
if (!str_starts_with(strtolower($candidate), strtolower($basePrefix))) {
    http_response_code(403);
    exit('Forbidden');
}

$mime = 'application/octet-stream';
if (class_exists('finfo')) {
    $detected = (new finfo(FILEINFO_MIME_TYPE))->file($candidate);
    if (is_string($detected) && $detected !== '') {
        $mime = $detected;
    }
}

$filename = str_replace(['"', "\r", "\n"], '', basename($candidate));
header('Content-Type: ' . $mime);
header('Content-Length: ' . (string)filesize($candidate));
header('Content-Disposition: inline; filename="' . $filename . '"');
header('Cache-Control: private, no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
readfile($candidate);
exit;
