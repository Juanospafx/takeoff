<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/middleware_auth.php';

$config = require __DIR__ . '/config.php';

// DB connection reuse
require_once __DIR__ . '/../core/db/connection.php';

// Routes
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

foreach ($routes as $route) {
    $params = [];
    if (match_route($route, $method, $path, $params)) {
        $handler = $route[2];
        $authRequired = $route[3];

        if ($authRequired) {
            verify_hmac_auth($config);
        }

        // Controller binding
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
    }
}

error_response('NOT_FOUND', 'Route not found', null, 404);
