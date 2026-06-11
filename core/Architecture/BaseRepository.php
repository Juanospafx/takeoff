<?php
declare(strict_types=1);

namespace Takeoff\Architecture;

use PDO;

abstract class BaseRepository
{
    public function __construct(
        protected PDO $pdo,
        protected string $table,
        protected string $entityClass
    ) {
    }

    public function find(int $id): ?BaseEntity
    {
        $stmt = $this->pdo->prepare("SELECT * FROM {$this->table} WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? new $this->entityClass($row) : null;
    }

    public function allActive(int $limit = 100): array
    {
        $stmt = $this->pdo->prepare("SELECT * FROM {$this->table} WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ?");
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        return array_map(fn(array $row) => new $this->entityClass($row), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function create(array $data): BaseEntity
    {
        $columns = array_keys($data);
        $placeholders = array_fill(0, count($columns), '?');
        $sql = "INSERT INTO {$this->table} (" . implode(', ', $columns) . ") VALUES (" . implode(', ', $placeholders) . ")";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(array_values($data));
        return $this->find((int)$this->pdo->lastInsertId());
    }

    public function update(int $id, array $data): ?BaseEntity
    {
        if (!$data) return $this->find($id);
        $set = implode(', ', array_map(fn(string $column) => "{$column} = ?", array_keys($data)));
        $stmt = $this->pdo->prepare("UPDATE {$this->table} SET {$set} WHERE id = ?");
        $stmt->execute([...array_values($data), $id]);
        return $this->find($id);
    }

    public function softDelete(int $id): bool
    {
        $stmt = $this->pdo->prepare("UPDATE {$this->table} SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?");
        return $stmt->execute([$id]);
    }
}
