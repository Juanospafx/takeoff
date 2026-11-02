<?php
declare(strict_types=1);

require_once __DIR__ . '/../core/auth/session.php';

$authRedirect = takeoff_require_page_auth($_SESSION ?? null);
if ($authRedirect !== null) {
    return;
}

// Bid Board is the canonical entry point. Project Takeoff remains available
// inside each project's workspace.
header('Location: /pages/bid_board.php', true, 302);
exit;
