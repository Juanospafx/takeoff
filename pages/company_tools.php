<?php
require_once __DIR__ . '/../views/company_tools_data.php';
$categories = company_tools_existing_categories();
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Company Tools | Brightronix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="../assets/global_tools.css">
    <style>
        body {
            margin: 0;
            min-height: 100vh;
            background: #151f2b;
            color: #f8fafc;
            font-family: 'Outfit', system-ui, sans-serif;
        }

        .tools-page {
            padding: 30px 42px 54px;
        }

        .tools-page .eyebrow {
            color: #a8b3c2;
            font-size: .86rem;
            font-weight: 800;
            margin-bottom: 24px;
        }

        .tools-page-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(170px, 1fr));
            gap: 52px;
            max-width: 1180px;
        }

        .tools-page-col h1 {
            margin: 0;
            font-size: 1rem;
            font-weight: 900;
        }

        .tools-page-rule {
            height: 1px;
            margin: 10px 0 10px;
            background: rgba(255,255,255,.22);
        }

        .tools-page-col nav {
            display: grid;
            gap: 2px;
        }

        .tools-page-col a {
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 32px;
            border-radius: 5px;
            padding: 5px 7px;
            color: #cbd5e1;
            text-decoration: none;
            font-weight: 700;
        }

        .tools-page-col a:hover {
            color: #fff;
            background: rgba(255,255,255,.07);
        }

        .tools-page-col a i {
            width: 16px;
            color: #94a3b8;
            font-size: .86rem;
        }

        @media (max-width: 900px) {
            .tools-page { padding: 22px; }
            .tools-page-grid { grid-template-columns: 1fr; gap: 26px; }
        }
    </style>
</head>
<body>
<?php include __DIR__ . '/../views/global_tools_header.php'; ?>
<main class="tools-page">
    <div class="eyebrow">Select a tool</div>
    <div class="tools-page-grid">
        <?php foreach ($categories as $category): ?>
            <section class="tools-page-col">
                <h1><?= htmlspecialchars($category['title']) ?></h1>
                <div class="tools-page-rule"></div>
                <nav>
                    <?php foreach ($category['links'] as $link): ?>
                        <a href="<?= htmlspecialchars($link['path']) ?>">
                            <i class="<?= htmlspecialchars($link['icon'] ?? 'fas fa-circle') ?>"></i>
                            <span><?= htmlspecialchars($link['label']) ?></span>
                        </a>
                    <?php endforeach; ?>
                </nav>
            </section>
        <?php endforeach; ?>
    </div>
</main>
<script src="../assets/global_tools.js"></script>
</body>
</html>
