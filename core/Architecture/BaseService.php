<?php
declare(strict_types=1);

namespace Takeoff\Architecture;

abstract class BaseService
{
    public function __construct(protected BaseRepository $repository)
    {
    }

    public function get(int $id): ?BaseEntity
    {
        return $this->repository->find($id);
    }

    public function list(int $limit = 100): array
    {
        return $this->repository->allActive($limit);
    }

    public function create(BaseDTO $dto): BaseEntity
    {
        return $this->repository->create($dto->toArray());
    }

    public function update(int $id, BaseDTO $dto): ?BaseEntity
    {
        return $this->repository->update($id, $dto->toArray());
    }

    public function delete(int $id): bool
    {
        return $this->repository->softDelete($id);
    }
}
