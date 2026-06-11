<?php
declare(strict_types=1);

namespace Takeoff\Architecture;

class BaseDTO
{
    public function __construct(private array $data = [])
    {
    }

    public static function fromArray(array $data): self
    {
        return new self($data);
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->data[$key] ?? $default;
    }

    public function only(array $keys): array
    {
        return array_intersect_key($this->data, array_flip($keys));
    }

    public function toArray(): array
    {
        return $this->data;
    }
}
