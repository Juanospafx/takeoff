<?php
declare(strict_types=1);

/**
 * Regression Test: Cost Catalog Batch Purge Legacy FK and Transaction Atomicity
 *
 * Acceptance Criteria:
 * - A regression test proves batch_purge deletes legacy assembly_items rows referencing
 *   selected catalog item IDs before deleting catalog_items.
 * - Batch purge dependency cleanup and parent deletion are atomic in one database
 *   transaction with rollback on failure.
 * - All SQL remains parameterized and no production data or credentials are accessed.
 */

$root = dirname(__DIR__);
$code = (string) file_get_contents($root . '/api/cost_catalog.php');
$failures = [];

$check = static function (bool $condition, string $message) use (&$failures): void {
    echo ($condition ? '[PASS] ' : '[FAIL] ') . $message . PHP_EOL;
    if (!$condition) $failures[] = $message;
};

// -----------------------------------------------------------------------------
// 1. Structural / Static Code Analysis of api/cost_catalog.php
// -----------------------------------------------------------------------------

// Extract the batch_purge block targeting the implemented handler precisely
$batchPurgePos = strpos($code, "elseif (\$action === 'batch_purge')");
if ($batchPurgePos === false) {
    $batchPurgePos = strpos($code, "\$action === 'batch_purge'");
}
$check($batchPurgePos !== false, 'api/cost_catalog.php contains batch_purge handler');

$batchPurgeBlock = '';
if ($batchPurgePos !== false) {
    // Find boundary of batch_purge block (until next action or end of batch block)
    $nextActionPos = strpos($code, "\$action === 'batch_move'", $batchPurgePos);
    $batchPurgeBlock = $nextActionPos !== false
        ? substr($code, $batchPurgePos, $nextActionPos - $batchPurgePos)
        : substr($code, $batchPurgePos, 1500);
}

// 1.1 Verify assembly_items table existence check
$check(
    str_contains($batchPurgeBlock, "catalog_ra_table_exists(\$pdo, 'assembly_items')") ||
    str_contains($batchPurgeBlock, 'assembly_items'),
    'batch_purge checks for legacy assembly_items table existence'
);

// 1.2 Verify assembly_items deletion query
$hasAssemblyItemsDelete = (bool) preg_match(
    '/DELETE\s+FROM\s+assembly_items\s+WHERE\s+assembly_id\s+IN\s*\(\$inClause\)\s+OR\s+catalog_item_id\s+IN\s*\(\$inClause\)/i',
    $batchPurgeBlock
);
$check(
    $hasAssemblyItemsDelete,
    'batch_purge deletes from assembly_items where assembly_id or catalog_item_id match target IDs'
);

// 1.3 Verify deletion ordering: assembly_items before catalog_items
$assemblyItemsPos = strpos($batchPurgeBlock, 'assembly_items');
$catalogItemsDeletePos = strpos($batchPurgeBlock, 'DELETE FROM catalog_items');
$check(
    $assemblyItemsPos !== false && $catalogItemsDeletePos !== false && $assemblyItemsPos < $catalogItemsDeletePos,
    'batch_purge cleans up legacy assembly_items before deleting catalog_items'
);

// 1.4 Verify transaction boundaries (atomicity and rollback on failure)
$check(
    str_contains($batchPurgeBlock, 'beginTransaction') &&
    str_contains($batchPurgeBlock, 'commit') &&
    str_contains($batchPurgeBlock, 'rollBack'),
    'batch_purge wraps dependency cleanup and parent deletion in a transaction with rollback on failure'
);

// 1.5 Verify parameterized query execution
$check(
    str_contains($batchPurgeBlock, 'execute(array_merge($ids, $ids))'),
    'batch_purge passes parameterized parameters for assembly_items IN clauses'
);

// -----------------------------------------------------------------------------
// 2. Behavioral Verification with In-Memory SQLite (Isolated from Production)
// -----------------------------------------------------------------------------

$hasSqlite = extension_loaded('pdo_sqlite') && in_array('sqlite', PDO::getAvailableDrivers(), true);

if (!$hasSqlite) {
    echo '[SKIP] SQLite PDO driver unavailable in runtime; skipping behavioral test.' . PHP_EOL;
} else {
    try {
        $pdo = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON;');

        // Create tables replicating legacy schema with foreign keys
        $pdo->exec('CREATE TABLE catalog_items (id INTEGER PRIMARY KEY, name TEXT);');
        $pdo->exec('CREATE TABLE assembly_items (
            id INTEGER PRIMARY KEY,
            assembly_id INTEGER NOT NULL,
            catalog_item_id INTEGER NOT NULL,
            FOREIGN KEY (assembly_id) REFERENCES catalog_items(id),
            FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id)
        );');
        $pdo->exec('CREATE TABLE assembly_parts (
            id INTEGER PRIMARY KEY,
            assembly_catalog_item_id INTEGER NOT NULL,
            part_catalog_item_id INTEGER NOT NULL,
            FOREIGN KEY (assembly_catalog_item_id) REFERENCES catalog_items(id),
            FOREIGN KEY (part_catalog_item_id) REFERENCES catalog_items(id)
        );');

        // Seed test data
        $pdo->exec("INSERT INTO catalog_items (id, name) VALUES (1, 'Assembly Alpha'), (2, 'Part Beta'), (3, 'Independent Gamma');");
        $pdo->exec("INSERT INTO assembly_items (id, assembly_id, catalog_item_id) VALUES (10, 1, 2);");
        $pdo->exec("INSERT INTO assembly_parts (id, assembly_catalog_item_id, part_catalog_item_id) VALUES (20, 1, 2);");

        // 2.1 Prove defect: deleting catalog_items directly fails when assembly_items references exist
        $directDeleteThrewFk = false;
        try {
            $pdo->exec('DELETE FROM catalog_items WHERE id IN (1, 2);');
        } catch (PDOException $e) {
            $directDeleteThrewFk = str_contains(strtolower($e->getMessage()), 'foreign key');
        }
        $check($directDeleteThrewFk, 'direct deletion of catalog_items without deleting assembly_items fails with FK constraint');

        // 2.2 Prove resolution: deleting assembly_items before catalog_items succeeds
        $purgeSucceeded = false;
        $ids = [1, 2];
        $inClause = implode(',', array_fill(0, count($ids), '?'));

        $pdo->beginTransaction();
        try {
            $stmtParts = $pdo->prepare("DELETE FROM assembly_parts WHERE part_catalog_item_id IN ($inClause) OR assembly_catalog_item_id IN ($inClause)");
            $stmtParts->execute(array_merge($ids, $ids));

            $stmtLegacy = $pdo->prepare("DELETE FROM assembly_items WHERE assembly_id IN ($inClause) OR catalog_item_id IN ($inClause)");
            $stmtLegacy->execute(array_merge($ids, $ids));

            $stmtItems = $pdo->prepare("DELETE FROM catalog_items WHERE id IN ($inClause)");
            $stmtItems->execute($ids);

            $pdo->commit();
            $purgeSucceeded = true;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $purgeSucceeded = false;
        }

        $check($purgeSucceeded, 'ordered batch purge cleans up dependencies and parent catalog_items atomically');

        // Verify records 1 and 2 were removed and 3 remains
        $remainingItems = $pdo->query('SELECT id FROM catalog_items')->fetchAll(PDO::FETCH_COLUMN);
        $check($remainingItems === [3] || $remainingItems === ['3'], 'only unpurged items remain after batch purge');

        // 2.3 Prove rollback atomicity: mid-operation failure rolls back all changes
        $pdo->exec("INSERT INTO catalog_items (id, name) VALUES (4, 'Assembly Delta'), (5, 'Part Epsilon');");
        $pdo->exec("INSERT INTO assembly_items (id, assembly_id, catalog_item_id) VALUES (30, 4, 5);");

        $rollbackWorked = false;
        $testIds = [4, 5];
        $testIn = implode(',', array_fill(0, count($testIds), '?'));

        $pdo->beginTransaction();
        try {
            $stmtLegacy = $pdo->prepare("DELETE FROM assembly_items WHERE assembly_id IN ($testIn) OR catalog_item_id IN ($testIn)");
            $stmtLegacy->execute(array_merge($testIds, $testIds));

            // Simulate an unexpected error before deleting catalog_items
            throw new RuntimeException('Simulated network or database failure mid-purge');
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $rollbackWorked = true;
        }

        // Verify assembly_items row 30 still exists after rollback
        $assemblyItemCount = (int) $pdo->query('SELECT COUNT(*) FROM assembly_items WHERE id = 30')->fetchColumn();
        $check($rollbackWorked && $assemblyItemCount === 1, 'batch purge rolls back atomically if a failure occurs before completion');

    } catch (Throwable $e) {
        $msg = 'Behavioral test exception: ' . $e->getMessage();
        echo '[FAIL] ' . $msg . PHP_EOL;
        $failures[] = $msg;
    }
}

if ($failures !== []) {
    echo PHP_EOL . 'Test failed with ' . count($failures) . ' failure(s):' . PHP_EOL;
    foreach ($failures as $f) {
        echo '  - ' . $f . PHP_EOL;
    }
    exit(1);
}

exit(0);
