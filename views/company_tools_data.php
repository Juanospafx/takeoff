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
                'title' => 'Preconstruction',
                'links' => [
                    ['label' => 'Cost Catalog', 'path' => '/pages/cost_catalog.php', 'icon' => 'fas fa-book'],
                    ['label' => 'Bid Board', 'path' => $bidBoardPath, 'icon' => 'fas fa-table-columns'],
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
        foreach (['Bid Board', 'Cost Catalog'] as $label) {
            $link = company_tool_find($label);
            if ($link) {
                $favorites[] = $link;
            }
        }
        return $favorites;
    }
}
