<?php
if (!function_exists('company_tools_bid_board_path')) {
    function company_tools_bid_board_path(): string
    {
        $script = $_SERVER['SCRIPT_NAME'] ?? '';
        if (strpos($script, '/pages/') !== false) {
            return 'bid_board.php';
        }
        if (preg_match('#^(.*?)/(pages|admin|views)/#', $script, $m)) {
            return $m[1] . '/pages/bid_board.php';
        }
        return 'bid_board.php';
    }
}

if (!function_exists('company_tools_categories')) {
    function company_tools_categories(): array
    {
        $bidBoardPath = company_tools_bid_board_path();
        return [
            [
                'title' => 'Preconstruction',
                'links' => [
                    ['id' => 'bid_board', 'label' => 'Bid Board', 'path' => $bidBoardPath, 'icon' => 'fas fa-table-columns'],
                    ['id' => 'cost_catalog', 'label' => 'Cost Catalog', 'path' => 'cost_catalog.php', 'icon' => 'fas fa-book-bookmark'],
                    ['id' => 'editor', 'label' => 'Plan Editor & Takeoff', 'path' => 'editor.php', 'icon' => 'fas fa-draw-polygon'],
                ],
            ],
            [
                'title' => 'Project Management',
                'links' => [
                    ['id' => 'projects', 'label' => 'Projects Portfolio', 'path' => 'projects.php', 'icon' => 'fas fa-briefcase'],
                    ['id' => 'archivos', 'label' => 'Documents', 'path' => 'archivos.php', 'icon' => 'fas fa-folder-tree'],
                    ['id' => 'timeline', 'label' => 'Schedule & Timeline', 'path' => 'timeline.php', 'icon' => 'fas fa-timeline'],
                    ['id' => 'directorio', 'label' => 'Directory', 'path' => 'directorio.php', 'icon' => 'fas fa-address-book'],
                ],
            ],
            [
                'title' => 'Administration',
                'links' => [
                    ['id' => 'company_settings', 'label' => 'Company Settings', 'path' => 'company_settings.php', 'icon' => 'fas fa-sliders'],
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
                $filename = basename($path);
                return file_exists(__DIR__ . '/../pages/' . $filename);
            }));
        }
        return $categories;
    }
}

if (!function_exists('company_tool_find')) {
    function company_tool_find(string $idOrLabel): ?array
    {
        foreach (company_tools_existing_categories() as $category) {
            foreach ($category['links'] as $link) {
                if (($link['id'] ?? '') === $idOrLabel || strcasecmp($link['label'] ?? '', $idOrLabel) === 0) {
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
        $defaultFavs = ['bid_board', 'cost_catalog', 'archivos'];
        $favorites = [];
        foreach ($defaultFavs as $favId) {
            $link = company_tool_find($favId);
            if ($link) {
                $favorites[] = $link;
            }
        }
        return $favorites;
    }
}
