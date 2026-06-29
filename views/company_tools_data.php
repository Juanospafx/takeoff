<?php
if (!function_exists('company_tools_bid_board_path')) {
    function company_tools_bid_board_path(): string
    {
        return '/pages/bid_board.php';
    }
}

if (!function_exists('company_tools_categories')) {
    function company_tools_categories(): array
    {
        $bidBoardPath = company_tools_bid_board_path();
        return [
            [
                'title' => 'Core Tools',
                'links' => [
                    ['label' => 'Portfolio', 'path' => '/pages/project_module.php', 'icon' => 'fas fa-briefcase'],
                    ['label' => 'Projects', 'path' => '/pages/projects.php', 'icon' => 'fas fa-folder-tree'],
                    ['label' => 'Project Module', 'path' => '/pages/project_module.php', 'icon' => 'fas fa-list-check'],
                    ['label' => 'Directory', 'path' => '/pages/directorio.php', 'icon' => 'fas fa-address-book'],
                    ['label' => '360 Reporting', 'path' => '/pages/timeline.php', 'icon' => 'fas fa-chart-pie'],
                    ['label' => 'Documents', 'path' => '/pages/archivos.php', 'icon' => 'fas fa-file-lines'],
                    ['label' => 'Workflows', 'path' => '/pages/timeline.php', 'icon' => 'fas fa-diagram-project'],
                    ['label' => 'Permissions', 'path' => '/pages/directorio.php', 'icon' => 'fas fa-user-shield'],
                    ['label' => 'Admin', 'path' => '/pages/company_settings.php', 'icon' => 'fas fa-gear'],
                    ['label' => 'Account Onboarding', 'path' => '/admin/settings.php', 'icon' => 'fas fa-user-plus'],
                ],
            ],
            [
                'title' => 'Resource Management',
                'links' => [
                    ['label' => 'Equipment', 'path' => '/pages/cost_catalog.php', 'icon' => 'fas fa-truck-ramp-box'],
                ],
            ],
            [
                'title' => 'Preconstruction',
                'links' => [
                    ['label' => 'Cost Catalog', 'path' => '/pages/cost_catalog.php', 'icon' => 'fas fa-book'],
                    ['label' => 'Bid Board', 'path' => $bidBoardPath, 'icon' => 'fas fa-table-columns'],
                    ['label' => 'Takeoff', 'path' => '/pages/takeoff.php', 'icon' => 'fas fa-ruler-combined'],
                    ['label' => 'Estimate', 'path' => '/pages/estimate_module.php', 'icon' => 'fas fa-calculator'],
                    ['label' => 'Project Create', 'path' => '/pages/project_create.php', 'icon' => 'fas fa-square-plus'],
                ],
            ],
            [
                'title' => 'Custom Tools',
                'links' => [
                    ['label' => 'Dashboard', 'path' => '/pages/index.php', 'icon' => 'fas fa-gauge-high'],
                    ['label' => 'Company Settings', 'path' => '/pages/company_settings.php', 'icon' => 'fas fa-sliders'],
                    ['label' => 'Uploads', 'path' => '/pages/takeoff.php', 'icon' => 'fas fa-cloud-arrow-up'],
                    ['label' => 'All PDFs', 'path' => '/pages/archivos.php', 'icon' => 'fas fa-file-pdf'],
                ],
            ],
        ];
    }
}

if (!function_exists('company_tools_existing_categories')) {
    function company_tools_existing_categories(): array
    {
        $categories = company_tools_categories();
        foreach ($categories as &$category) {
            $category['links'] = array_values(array_filter($category['links'], static function ($link) {
                $path = $link['path'] ?? '';
                if ($path === '' || strpos($path, 'http') === 0) return true;
                $relative = ltrim(preg_replace('~^/pages/~', 'pages/', $path), '/');
                if (strpos($path, '/admin/') === 0) {
                    $relative = ltrim($path, '/');
                }
                return file_exists(__DIR__ . '/../' . $relative);
            }));
        }
        return $categories;
    }
}

if (!function_exists('company_tool_find')) {
    function company_tool_find(string $label): ?array
    {
        foreach (company_tools_existing_categories() as $category) {
            foreach ($category['links'] as $link) {
                if (strcasecmp($link['label'] ?? '', $label) === 0) {
                    return $link;
                }
            }
        }
        return null;
    }
}

if (!function_exists('company_tools_favorites')) {
    function company_tools_favorites(): array
    {
        $favorites = [];
        foreach (['Bid Board', 'Cost Catalog', 'Dashboard'] as $label) {
            $link = company_tool_find($label);
            if ($link) {
                $favorites[] = $link;
            }
        }
        return $favorites;
    }
}
