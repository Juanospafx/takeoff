<?php
declare(strict_types=1);

final class SchemaProbeStatement extends PDOStatement
{
    private array $params = [];

    public function __construct(private readonly array $existingTables)
    {
    }

    public function execute(?array $params = null): bool
    {
        $this->params = $params ?? [];
        return true;
    }

    public function fetchColumn(int $column = 0): mixed
    {
        $table = (string) ($this->params[0] ?? '');
        return in_array($table, $this->existingTables, true) ? 1 : 0;
    }
}

final class NativeMariaDbSchemaProbe extends PDO
{
    public function __construct(private readonly array $existingTables)
    {
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (preg_match('/^\s*SHOW\s+TABLES\s+LIKE\s+\?/i', $query)) {
            throw new PDOException('Native MariaDB prepares reject this SHOW placeholder');
        }

        if (!str_contains($query, 'information_schema.TABLES')
            || !str_contains($query, 'TABLE_SCHEMA = DATABASE()')
            || !str_contains($query, 'TABLE_NAME = ?')) {
            throw new PDOException('Unexpected schema probe query');
        }

        return new SchemaProbeStatement($this->existingTables);
    }
}

$source = file_get_contents(__DIR__ . '/../api/takeoff.php');
if ($source === false) {
    throw new RuntimeException('Unable to read api/takeoff.php');
}

$start = strpos($source, 'function takeoff_table_exists');
$end = strpos($source, 'function assert_takeoff_runtime_schema', $start ?: 0);
if ($start === false || $end === false || $end <= $start) {
    throw new RuntimeException('Unable to isolate takeoff_table_exists');
}

$functionSource = substr($source, $start, $end - $start);
$functionSource = preg_replace('/function\s+takeoff_table_exists/', 'function tested_takeoff_table_exists', $functionSource, 1);
if (!is_string($functionSource)) {
    throw new RuntimeException('Unable to prepare table detection helper');
}
eval($functionSource);

$pdo = new NativeMariaDbSchemaProbe(['takeoff_layers']);

if (!tested_takeoff_table_exists($pdo, 'takeoff_layers')) {
    throw new RuntimeException('Existing tables must be detected when native MariaDB prepares reject SHOW TABLES LIKE ?.');
}
if (tested_takeoff_table_exists($pdo, 'missing_table')) {
    throw new RuntimeException('Missing tables must remain absent.');
}
if (str_contains($functionSource, 'SHOW TABLES LIKE ?')) {
    throw new RuntimeException('The runtime preflight must not use the incompatible SHOW TABLES placeholder.');
}

echo "Takeoff runtime schema table detection: PASS\n";
