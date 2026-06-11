<?php
declare(strict_types=1);

namespace Takeoff\Architecture;

use InvalidArgumentException;
use PDO;

final class RepositoryFactory
{
    public function __construct(private PDO $pdo, private array $map)
    {
    }

    public function make(string $name): BaseRepository
    {
        if (!isset($this->map[$name])) {
            throw new InvalidArgumentException("Unknown repository entity: {$name}");
        }

        $definition = $this->map[$name];

        return new class($this->pdo, $definition['table'], $definition['entity']) extends BaseRepository {
        };
    }
}
