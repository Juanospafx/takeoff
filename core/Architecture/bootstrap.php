<?php
declare(strict_types=1);

require_once __DIR__ . '/BaseEntity.php';
require_once __DIR__ . '/BaseDTO.php';
require_once __DIR__ . '/BaseRepository.php';
require_once __DIR__ . '/BaseService.php';
require_once __DIR__ . '/Entities.php';
require_once __DIR__ . '/DTOs.php';
require_once __DIR__ . '/Repositories.php';
require_once __DIR__ . '/Services.php';
require_once __DIR__ . '/RepositoryFactory.php';
require_once __DIR__ . '/ServiceFactory.php';

return require __DIR__ . '/EntityMap.php';
