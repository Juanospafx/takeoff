<?php
declare(strict_types=1);

require_once __DIR__ . '/../helpers.php';

class FoldersController
{
    private $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public function index(array $params): void
    {
        $projectId = require_int($params['id'] ?? null);
        if (!$projectId) {
            error_response('VALIDATION_ERROR', 'Invalid project id', ['field' => 'id'], 422);
        }

        try {
            $stmt = $this->pdo->prepare(
                "SELECT id, name\n                 FROM folders\n                 WHERE project_id = ? AND deleted_at IS NULL\n                 ORDER BY name ASC"
            );
            $stmt->execute([$projectId]);
            $folders = $stmt->fetchAll(PDO::FETCH_ASSOC);

            ok_response($folders);
        } catch (Exception $e) {
            error_response('INTERNAL_ERROR', 'Unexpected error', null, 500);
        }
    }
}
