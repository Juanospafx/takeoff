<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$seedPath = $root . '/db/seed_assemblies_2027.php';
$seed = (string) file_get_contents($seedPath);
$failures = [];
$check = static function (bool $condition, string $message) use (&$failures): void {
    echo ($condition ? '[PASS] ' : '[FAIL] ') . $message . PHP_EOL;
    if (!$condition) $failures[] = $message;
};

$check(str_contains($seed, "PHP_SAPI !== 'cli'"), 'seed cannot execute through HTTP');
$check(str_contains($seed, "['--check', '--apply']"), 'seed requires an explicit safe mode');
$check(str_contains($seed, "2027 Brightronix Cost Catalog"), 'seed names the exact canonical target');
$check(!str_contains($seed, "LIKE '%2027 Brightronix%'") && !str_contains($seed, 'OR id = 1'), 'seed has no broad or fallback catalog selector');
$check(str_contains($seed, '$pdo->beginTransaction()') && str_contains($seed, '$pdo->commit()') && str_contains($seed, '$pdo->rollBack()'), 'seed is transaction protected');
$check(str_contains($seed, "WHERE assembly_catalog_item_id = ?"), 'component replacement delete is bounded to one assembly');
$check(str_contains($seed, 'SELECT id FROM catalog_items') && str_contains($seed, 'UPDATE catalog_items'), 'seed updates existing assemblies idempotently');
$check(str_contains($seed, 'Restore the pre-run database backup'), 'seed documents rollback after commit');

$deploy = (string) file_get_contents($root . '/.github/workflows/deploy.yml');
$check(str_contains($deploy, "--exclude '/db/'"), 'deployment excludes executable seed directory without excluding core/db runtime');
$check(str_contains($deploy, 'test -f "$ARTIFACT_DIR/core/db/connection.php"'), 'deployment requires the database runtime entrypoint');

exit($failures === [] ? 0 : 1);
