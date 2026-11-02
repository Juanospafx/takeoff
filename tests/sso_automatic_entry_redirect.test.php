<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$sessionSource = (string) file_get_contents($root . '/core/auth/session.php');
$entrySource = (string) file_get_contents($root . '/pages/takeoff.php');
$bidBoardSource = (string) file_get_contents($root . '/pages/bid_board.php');

$failures = [];
$assert = static function (bool $condition, string $message) use (&$failures): void {
    echo ($condition ? '[PASS] ' : '[FAIL] ') . $message . PHP_EOL;
    if (!$condition) {
        $failures[] = $message;
    }
};

$assert(
    str_contains($sessionSource, "'/pages/sso-login.php'"),
    'The page guard uses the fixed same-origin SSO initiation path.'
);
$assert(
    str_contains($sessionSource, 'function takeoff_require_page_auth'),
    'A reusable browser page authentication guard exists.'
);
$entryGuardPos = strpos($entrySource, 'takeoff_require_page_auth');
$entryRedirectPos = strpos($entrySource, "header('Location: /pages/bid_board.php'");
$assert(
    $entryGuardPos !== false
        && $entryRedirectPos !== false
        && $entryGuardPos < $entryRedirectPos,
    'The root entry authenticates before redirecting to Bid Board.'
);
$bidBoardGuardPos = strpos($bidBoardSource, 'takeoff_require_page_auth');
$bidBoardDoctypePos = stripos($bidBoardSource, '<!doctype html>');
$assert(
    $bidBoardGuardPos !== false
        && $bidBoardDoctypePos !== false
        && $bidBoardGuardPos < $bidBoardDoctypePos,
    'Bid Board authenticates before emitting application HTML.'
);
$assert(
    !preg_match('/(?:return|next|redirect_uri)\s*=\s*\$_(?:GET|POST|REQUEST)/i', $sessionSource . $entrySource),
    'The entry guard accepts no user-controlled redirect destination.'
);

require_once $root . '/core/auth/session.php';

$assert(
    takeoff_page_auth_redirect([]) === '/pages/sso-login.php',
    'An anonymous session resolves to the SSO initiation endpoint.'
);
$assert(
    takeoff_page_auth_redirect(['user_id' => 7, 'username' => 'Central User', 'role' => 'admin']) === null,
    'A valid authenticated session requires no SSO redirect.'
);
$assert(
    takeoff_page_auth_redirect(['user_id' => 7, 'username' => 'Central User', 'role' => 'unknown']) === '/pages/sso-login.php',
    'A malformed role fails closed into SSO.'
);

if ($failures !== []) {
    fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
    exit(1);
}

echo 'Takeoff automatic SSO entry contract: PASS' . PHP_EOL;

