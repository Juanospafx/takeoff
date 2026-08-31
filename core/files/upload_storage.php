<?php

/**
 * Resolve a database upload path against the two storage roots used by older
 * and current installations. Only files contained by an approved root are
 * returned.
 */
function takeoff_resolve_stored_file(string $storedPath): ?array
{
    $storedPath = trim(str_replace('\\', '/', $storedPath));
    if ($storedPath === '' || strpos($storedPath, "\0") !== false || preg_match('~^[a-z]+://~i', $storedPath)) {
        return null;
    }

    if (preg_match('~(?:^|/)(api/uploads|uploads)/(.+)$~', $storedPath, $match)) {
        $relativeTail = $match[2];
    } else {
        $relativeTail = ltrim(preg_replace('~^(?:\.\./)+~', '', $storedPath), '/');
        if (strpos($relativeTail, 'api/uploads/') === 0) $relativeTail = substr($relativeTail, 12);
        elseif (strpos($relativeTail, 'uploads/') === 0) $relativeTail = substr($relativeTail, 8);
    }

    if ($relativeTail === '' || preg_match('~(?:^|/)\.\.(?:/|$)~', $relativeTail)) return null;

    $workspace = dirname(__DIR__, 2);
    $locations = [
        ['root' => $workspace . '/uploads', 'prefix' => 'uploads/'],
        ['root' => $workspace . '/api/uploads', 'prefix' => 'api/uploads/'],
    ];
    foreach ($locations as $location) {
        $root = realpath($location['root']);
        if (!$root) continue;
        $real = realpath($root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativeTail));
        if (!$real || !is_file($real)) continue;
        if ($real !== $root && strpos($real, $root . DIRECTORY_SEPARATOR) !== 0) continue;
        return [
            'real_path' => $real,
            'storage_path' => $location['prefix'] . $relativeTail,
            'public_path' => '../' . $location['prefix'] . $relativeTail,
        ];
    }
    return null;
}

