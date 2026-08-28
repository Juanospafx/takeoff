<?php
declare(strict_types=1);

final class CatalogRevisionConflict extends RuntimeException
{
    public array $current;
    public function __construct(array $current)
    {
        parent::__construct('The catalog record changed after it was loaded.');
        $this->current = $current;
    }
}

function catalog_ra_columns(PDO $pdo, string $table): array
{
    static $cache = [];
    if (!isset($cache[$table])) $cache[$table] = array_fill_keys($pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN), true);
    return $cache[$table];
}

function catalog_ra_table_exists(PDO $pdo, string $table): bool
{
    static $cache = [];
    if (!array_key_exists($table, $cache)) {
        $stmt=$pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1');
        $stmt->execute([$table]); $cache[$table]=(bool)$stmt->fetchColumn();
    }
    return $cache[$table];
}

function catalog_ra_has_audit(PDO $pdo): bool
{
    static $cache;
    if ($cache === null) {
        $stmt = $pdo->query("SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='catalog_audit_events' LIMIT 1");
        $cache = (bool)$stmt->fetchColumn();
    }
    return $cache;
}

function catalog_ra_expected(array $input): ?int
{
    return array_key_exists('expected_revision', $input) && $input['expected_revision'] !== '' && $input['expected_revision'] !== null
        ? max(0, (int)$input['expected_revision']) : null;
}

function catalog_ra_request_id(array $input): string
{
    $value = trim((string)($input['request_id'] ?? ''));
    return $value !== '' ? substr($value, 0, 64) : bin2hex(random_bytes(16));
}

function catalog_ra_row(PDO $pdo, string $table, int $id, bool $lock = false): ?array
{
    $stmt = $pdo->prepare("SELECT * FROM `$table` WHERE id=?" . ($lock && $pdo->inTransaction() ? ' FOR UPDATE' : ''));
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function catalog_ra_equal($a, $b): bool
{
    if ($a === null || $a === '') return $b === null || $b === '';
    if (is_bool($a) || is_numeric($a)) return (float)$a === (float)$b;
    return (string)$a === (string)$b;
}

function catalog_ra_assert_expected(PDO $pdo, string $table, int $id, array $input): array
{
    $row = catalog_ra_row($pdo, $table, $id, true);
    if (!$row) throw new RuntimeException('Catalog record not found.');
    $expected = catalog_ra_expected($input);
    if ($expected !== null && isset(catalog_ra_columns($pdo, $table)['revision']) && (int)$row['revision'] !== $expected) {
        throw new CatalogRevisionConflict($row);
    }
    return $row;
}

function catalog_ra_audit(PDO $pdo, string $requestId, string $action, string $entityType, int $entityId,
    ?int $catalogId, ?array $before, ?array $after, array $changes = [], ?int $actorUserId = null): void
{
    if (!catalog_ra_has_audit($pdo)) return;
    $beforeRevision = $before && isset($before['revision']) ? (int)$before['revision'] : null;
    $afterRevision = $after && isset($after['revision']) ? (int)$after['revision'] : null;
    $stmt = $pdo->prepare('INSERT IGNORE INTO catalog_audit_events
        (request_id,actor_user_id,action,entity_type,entity_id,catalog_id,revision_before,revision_after,before_json,after_json,changes_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    $encode = static fn($value) => $value === null ? null : json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $stmt->execute([$requestId, $actorUserId, $action, $entityType, $entityId, $catalogId,
        $beforeRevision, $afterRevision, $encode($before), $encode($after), $encode($changes)]);
}

/** Capability-aware audited update. Column names are supplied only by trusted endpoint code. */
function catalog_ra_update(PDO $pdo, string $table, string $entityType, int $id, array $values, string $action,
    array $input = [], ?int $catalogId = null, bool $forceRevision = false): array
{
    $ownTx = !$pdo->inTransaction();
    if ($ownTx) $pdo->beginTransaction();
    try {
        $before = catalog_ra_row($pdo, $table, $id, true);
        if (!$before) throw new RuntimeException('Catalog record not found.');
        $hasRevision = isset(catalog_ra_columns($pdo, $table)['revision']);
        $expected = catalog_ra_expected($input);
        if ($expected !== null && $hasRevision && (int)$before['revision'] !== $expected) throw new CatalogRevisionConflict($before);
        $changed = [];
        foreach ($values as $column => $value) if (!catalog_ra_equal($before[$column] ?? null, $value)) $changed[$column] = ['before' => $before[$column] ?? null, 'after' => $value];
        if ($forceRevision && !$changed) $changed['_command'] = ['before' => null, 'after' => $action];
        if ($changed) {
            $sets = array_map(static fn($column) => "`$column`=?", array_keys($values));
            if ($hasRevision) $sets[] = '`revision`=`revision`+1';
            $stmt = $pdo->prepare("UPDATE `$table` SET " . implode(',', $sets) . ' WHERE id=?');
            $stmt->execute(array_merge(array_values($values), [$id]));
        }
        $after = catalog_ra_row($pdo, $table, $id);
        if ($changed) catalog_ra_audit($pdo, catalog_ra_request_id($input), $action, $entityType, $id,
            $catalogId ?? (isset($after['catalog_id']) ? (int)$after['catalog_id'] : null), $before, $after, $changed);
        if ($ownTx) $pdo->commit();
        return $after;
    } catch (Throwable $e) {
        if ($ownTx && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function catalog_ra_created(PDO $pdo, string $table, string $entityType, int $id, string $action, array $input = [], ?int $catalogId = null): array
{
    $after = catalog_ra_row($pdo, $table, $id) ?: [];
    catalog_ra_audit($pdo, catalog_ra_request_id($input), $action, $entityType, $id,
        $catalogId ?? (isset($after['catalog_id']) ? (int)$after['catalog_id'] : null), null, $after, ['created' => true]);
    return $after;
}
