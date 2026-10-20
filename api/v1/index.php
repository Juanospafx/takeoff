<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../../core/auth/session.php';

$config = require __DIR__ . '/config.php';
$routes = require __DIR__ . '/routes.php';

$method = get_request_method();
$path = get_request_path();

// Basic router with path params
function match_route(array $route, string $method, string $path, array &$params): bool
{
    [$rm, $rp] = $route;
    if ($rm !== $method) return false;

    $regex = preg_replace('#\{[^/]+\}#', '([^/]+)', $rp);
    $regex = '#^' . $regex . '$#';

    if (!preg_match($regex, $path, $matches)) return false;

    // Extract param names
    preg_match_all('#\{([^/]+)\}#', $rp, $keys);
    $params = [];
    for ($i = 0; $i < count($keys[1]); $i++) {
        $params[$keys[1][$i]] = $matches[$i + 1];
    }

    return true;
}

// 1. Exact Route Matching
$matchedRoute = null;
$params = [];
foreach ($routes as $route) {
    $p = [];
    if (match_route($route, $method, $path, $p)) {
        $matchedRoute = $route;
        $params = $p;
        break;
    }
}

if ($matchedRoute === null) {
    error_response('NOT_FOUND', 'Route not found', null, 404);
}

// 2. Authorization Classification from exact matched method and route
[$rm, $rp, $handler, $authType] = $matchedRoute;
$isMutation = ($authType === 'mutation' || in_array($rm, ['POST', 'PATCH', 'PUT', 'DELETE'], true));
$routeAction = $rm . ' ' . $rp;
$readRoutes = $isMutation ? [] : [$routeAction];
$mutationRoutes = $isMutation ? [$routeAction] : [];

// Enforce viewer mutation protection before DB or controller construction
$user = takeoff_guard_api_action($routeAction, $readRoutes, $mutationRoutes);
$userId = (int)$user['user_id'];
set_client_context((string)$userId, $user['role']);

// 3. DB connection reuse (after authorization)
require_once __DIR__ . '/../../core/db/connection.php';

// 4. Controller binding and dispatch
[$controllerName, $action] = explode('@', $handler, 2);
$controllerFile = __DIR__ . '/controllers/' . $controllerName . '.php';

if (!file_exists($controllerFile)) {
    error_response('NOT_FOUND', 'Controller not found', null, 404);
}

require_once $controllerFile;

if (!class_exists($controllerName)) {
    error_response('NOT_FOUND', 'Controller class missing', null, 404);
}

$controller = new $controllerName($pdo);

if (!method_exists($controller, $action)) {
    error_response('NOT_FOUND', 'Action not found', null, 404);
}

// Call action
if (!empty($params)) {
    $controller->{$action}($params);
} else {
    $controller->{$action}();
}

exit;
