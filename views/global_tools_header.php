<?php
require_once __DIR__ . '/company_tools_data.php';
$companyToolsCategories = company_tools_existing_categories();
$currentPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
?>
<header class="bt-global-header" data-global-tools-header>
    <div class="bt-global-left">
        <a class="bt-brand" href="/pages/index.php" aria-label="Brightronix home">
            <span class="bt-brand-mark">B</span>
            <span>Brightronix</span>
        </a>
        <button class="bt-selector" type="button" aria-label="Select project">
            <span>Brightronix LLC</span>
            <strong>Select a Project</strong>
            <i class="fas fa-chevron-down"></i>
        </button>
        <button class="bt-selector bt-company-tools-trigger" type="button" data-company-tools-toggle aria-expanded="false">
            <span>Company Tools</span>
            <strong>Portfolio</strong>
            <i class="fas fa-chevron-down"></i>
        </button>
        <a class="bt-favorites" href="/pages/company_tools.php">
            <i class="fas fa-star"></i>
            <span>Favorites</span>
        </a>
    </div>
    <div class="bt-global-right">
        <button class="bt-selector" type="button" aria-label="Select app">
            <span>Apps</span>
            <strong>Select an App</strong>
            <i class="fas fa-chevron-down"></i>
        </button>
        <a class="bt-icon" href="/pages/company_settings.php" aria-label="Help"><i class="far fa-circle-question"></i></a>
        <button class="bt-icon" type="button" aria-label="Notifications"><i class="far fa-bell"></i></button>
        <div class="bt-avatar" aria-label="User avatar">JE</div>
    </div>
    <div class="bt-tools-mega" data-company-tools-menu>
        <div class="bt-tools-eyebrow">Select a tool</div>
        <div class="bt-tools-grid">
            <?php foreach ($companyToolsCategories as $category): ?>
                <section class="bt-tools-col">
                    <h2><?= htmlspecialchars($category['title']) ?></h2>
                    <div class="bt-tools-rule"></div>
                    <nav>
                        <?php foreach ($category['links'] as $link): ?>
                            <?php $isActive = $currentPath === ($link['path'] ?? ''); ?>
                            <a class="<?= $isActive ? 'active' : '' ?>" href="<?= htmlspecialchars($link['path']) ?>">
                                <i class="<?= htmlspecialchars($link['icon'] ?? 'fas fa-circle') ?>"></i>
                                <span><?= htmlspecialchars($link['label']) ?></span>
                            </a>
                        <?php endforeach; ?>
                    </nav>
                </section>
            <?php endforeach; ?>
        </div>
    </div>
</header>
