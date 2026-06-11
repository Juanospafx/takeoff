<?php
declare(strict_types=1);

// API v1 configuration
return [
    'CLIENTS' => [
        // client_id => client_secret
        'crm' => 'supersecret...',
    ],
    // Optional client roles for authorization (e.g., admin-only actions)
    'CLIENT_ROLES' => [
        'crm' => 'admin',
    ],
    // Allowed clock skew in seconds
    'MAX_TIMESTAMP_SKEW' => 300,
];
