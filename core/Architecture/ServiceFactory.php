<?php
declare(strict_types=1);

namespace Takeoff\Architecture;

final class ServiceFactory
{
    public function __construct(private RepositoryFactory $repositories)
    {
    }

    public function make(string $name): BaseService
    {
        return new class($this->repositories->make($name)) extends BaseService {
        };
    }
}
