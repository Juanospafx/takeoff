<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/WonProjectIntegrationConfig.php';

/**
 * Backend transactional producer service for STORY-0019 (WonProject integration).
 *
 * Responsibilities:
 *   - Verifies admin role authorization.
 *   - Locks project row with FOR UPDATE.
 *   - Validates canonical payload before any database mutation.
 *   - Transitions projects.status to 'accepted'.
 *   - Idempotently creates or reuses domain event 'project.won' in won_project_outbox.
 *   - Handles concurrent insert races via unique constraint without leaking SQL exceptions.
 *   - Extracts full canonical WonProjectExport.v1 payload without loss or fabrication.
 */
class WonProjectExportService
{
    private PDO $pdo;
    private ?WonProjectIntegrationConfig $config;

    public function __construct(PDO $pdo, ?WonProjectIntegrationConfig $config = null)
    {
        $this->pdo = $pdo;
        $this->config = $config;
    }

    /**
     * Marks a project as won, transitions status to accepted, and creates canonical outbox event.
     *
     * @param int $projectId ID of the project to mark as won
     * @param int $actorUserId ID of the user performing the action
     * @param string $actorRole Role of the actor (must be 'admin')
     * @return array Canonical WonProjectExport.v1 event payload
     * @throws InvalidArgumentException When role is unauthorized or IDs are invalid
     * @throws RuntimeException When project is not found or transactional write fails
     */
    public function markAsWon(int $projectId, int $actorUserId, string $actorRole): array
    {
        if (strtolower(trim($actorRole)) !== 'admin') {
            throw new InvalidArgumentException("Unauthorized: only admin role may mark a project as won. Given role: '{$actorRole}'");
        }

        if ($projectId <= 0) {
            throw new InvalidArgumentException("Invalid project ID: {$projectId}");
        }

        if ($actorUserId <= 0) {
            throw new InvalidArgumentException("Invalid actor user ID: {$actorUserId}");
        }

        $inOuterTx = $this->pdo->inTransaction();
        $savepointName = 'sp_won_' . $projectId . '_' . bin2hex(random_bytes(4));

        if ($inOuterTx) {
            $this->pdo->exec("SAVEPOINT {$savepointName}");
        } else {
            $this->pdo->beginTransaction();
        }

        try {
            $result = $this->executeMarkAsWon($projectId, $actorUserId, $actorRole);
            if ($inOuterTx) {
                $this->pdo->exec("RELEASE SAVEPOINT {$savepointName}");
            } else {
                $this->pdo->commit();
            }
            return $result;
        } catch (Throwable $e) {
            if ($inOuterTx) {
                try {
                    $this->pdo->exec("ROLLBACK TO SAVEPOINT {$savepointName}");
                } catch (Throwable $ignored) {
                }
            } else {
                if ($this->pdo->inTransaction()) {
                    $this->pdo->rollBack();
                }
            }
            throw $e;
        }
    }

    private function executeMarkAsWon(int $projectId, int $actorUserId, string $actorRole): array
    {
        $driver = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $forUpdate = ($driver === 'sqlite') ? '' : ' FOR UPDATE';

        // 1. Lock project row
        $stmt = $this->pdo->prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL{$forUpdate}");
        $stmt->execute([$projectId]);
        $project = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$project) {
            throw new RuntimeException("Project not found with ID: {$projectId}");
        }

        if (!$this->tableExists('won_project_outbox')) {
            throw new RuntimeException("Table won_project_outbox does not exist");
        }

        $userStmt = $this->pdo->prepare("SELECT role FROM users WHERE id=? LIMIT 1");
        $userStmt->execute([$actorUserId]);
        $userRole = $userStmt->fetchColumn();
        if ($userRole === false || strtolower(trim((string)$userRole)) !== 'admin') {
            throw new RuntimeException("Unauthorized: actor user does not exist or is not admin");
        }

        // 2. Replay idempotency check
        $checkStmt = $this->pdo->prepare("SELECT payload FROM won_project_outbox WHERE project_id = ? AND event_type = 'project.won' LIMIT 1{$forUpdate}");
        $checkStmt->execute([$projectId]);
        $existingPayloadJson = $checkStmt->fetchColumn();

        if ($existingPayloadJson !== false && is_string($existingPayloadJson) && $existingPayloadJson !== '') {
            $decoded = json_decode($existingPayloadJson, true);
            if (!is_array($decoded)) {
                throw new RuntimeException("Persisted won project payload is not valid JSON for project ID: {$projectId}");
            }

            // Replay with invalid payload must fail before state mutation
            $this->validateCanonicalPayload($decoded);

            // Ensure project status is accepted
            $this->pdo->prepare("UPDATE projects SET status = 'accepted' WHERE id = ?")->execute([$projectId]);

            return $decoded;
        }

        // 3. Construct canonical WonProjectExport.v1 payload using persisted real data
        $payload = $this->buildCanonicalPayload($project, $actorUserId, $actorRole);

        // 4. Validate payload before any UPDATE or INSERT mutations
        $this->validateCanonicalPayload($payload);

        // 5. Canonical JSON serialization and SHA-256 digest
        $canonicalJson = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($canonicalJson === false) {
            throw new RuntimeException("Failed to serialize canonical won project export: " . json_last_error_msg());
        }
        $payloadHash = hash('sha256', $canonicalJson);

        // 6. Transition project status to accepted
        $this->pdo->prepare("UPDATE projects SET status = 'accepted' WHERE id = ?")->execute([$projectId]);

        // 7. Insert outbox record with sub-savepoint to gracefully handle concurrent race conditions
        $insertSp = 'sp_ins_' . bin2hex(random_bytes(4));
        $hasInsertSp = false;
        try {
            $this->pdo->exec("SAVEPOINT {$insertSp}");
            $hasInsertSp = true;
        } catch (Throwable $ignored) {
        }

        try {
            $insertStmt = $this->pdo->prepare("
                INSERT INTO won_project_outbox (
                    event_id,
                    project_id,
                    event_type,
                    payload,
                    payload_hash,
                    status,
                    attempts,
                    next_attempt_at,
                    created_at,
                    updated_at
                ) VALUES (
                    ?,
                    ?,
                    'project.won',
                    ?,
                    ?,
                    'pending',
                    0,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )
            ");
            $insertStmt->execute([
                $payload['event_id'],
                $projectId,
                $canonicalJson,
                $payloadHash,
            ]);

            if ($hasInsertSp) {
                try {
                    $this->pdo->exec("RELEASE SAVEPOINT {$insertSp}");
                } catch (Throwable $ignored) {
                }
            }

            return $payload;
        } catch (PDOException $e) {
            if ($hasInsertSp) {
                try {
                    $this->pdo->exec("ROLLBACK TO SAVEPOINT {$insertSp}");
                } catch (Throwable $ignored) {
                }
            }

            $errorCode = (int)($e->errorInfo[1] ?? 0);
            $sqlState = (string)($e->errorInfo[0] ?? $e->getCode());
            if ($sqlState === '23000' || $errorCode === 1062 || str_contains($e->getMessage(), 'Duplicate') || str_contains($e->getMessage(), 'UNIQUE')) {
                $raceStmt = $this->pdo->prepare("SELECT payload FROM won_project_outbox WHERE project_id = ? AND event_type = 'project.won' LIMIT 1{$forUpdate}");
                $raceStmt->execute([$projectId]);
                $persistedJson = $raceStmt->fetchColumn();
                if ($persistedJson !== false && is_string($persistedJson) && $persistedJson !== '') {
                    $persistedPayload = json_decode($persistedJson, true);
                    if (is_array($persistedPayload)) {
                        $this->validateCanonicalPayload($persistedPayload);
                        return $persistedPayload;
                    }
                }
            }

            throw $e;
        }
    }

    private function buildCanonicalPayload(array $project, int $actorUserId, string $actorRole): array
    {
        $projectId = (int)$project['id'];
        $occurredAt = gmdate('Y-m-d\TH:i:s\Z');
        $eventId = $this->generateUuid();

        // 1. Resolve actor identity
        // Note: auth table only has id, username, role columns
        $uTable = 'users';
        if (!$this->tableExists($uTable)) {
            throw new RuntimeException("Auth user table does not exist");
        }
        $uStmt = $this->pdo->prepare("SELECT id, username, role FROM {$uTable} WHERE id = ? LIMIT 1");
        $uStmt->execute([$actorUserId]);
        $actorUser = $uStmt->fetch(PDO::FETCH_ASSOC);
        if (!$actorUser) {
            throw new RuntimeException("Actor user not found with ID: {$actorUserId}");
        }

        if (strtolower(trim((string)($actorUser['role'] ?? ''))) !== 'admin') {
            throw new RuntimeException("Unauthorized: actor user does not have admin role");
        }

        $actorUsername = trim((string)($actorUser['username'] ?? ''));
        if ($actorUsername === '') {
            throw new RuntimeException("Actor user {$actorUserId} has empty username");
        }

        if (!filter_var($actorUsername, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException("Actor user {$actorUserId} does not have a valid email");
        }
        $actorEmail = $actorUsername;
        $actorDisplayName = $actorUsername;

        // 2. Resolve project metadata and fields
        $projectMeta = [];
        if (!empty($project['metadata_json'])) {
            $decodedPrjMeta = json_decode((string)$project['metadata_json'], true);
            if (is_array($decodedPrjMeta)) {
                $projectMeta = $decodedPrjMeta;
            }
        }

        $clientMeta = (isset($projectMeta['client']) && is_array($projectMeta['client'])) ? $projectMeta['client'] : [];
        $locationMeta = (isset($projectMeta['location']) && is_array($projectMeta['location'])) ? $projectMeta['location'] : [];
        $datesMeta = (isset($projectMeta['dates']) && is_array($projectMeta['dates'])) ? $projectMeta['dates'] : [];

        // 3. Resolve active approved/accepted estimate
        if (!$this->tableExists('estimates')) {
            throw new RuntimeException("Estimates table does not exist");
        }

        $eStmt = $this->pdo->prepare("SELECT * FROM estimates WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC");
        $eStmt->execute([$projectId]);
        $estimates = $eStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $estimate = null;
        foreach ($estimates as $candidate) {
            $normStatus = strtolower(trim((string)($candidate['status'] ?? '')));
            if ($normStatus === 'approved' || $normStatus === 'accepted') {
                $estimate = $candidate;
                break;
            }
        }

        if (!$estimate) {
            throw new RuntimeException("No approved or accepted estimate found for project ID: {$projectId}");
        }

        // 4. Resolve real bid ID
        $bidId = '';
        if (!empty($estimate['bid_id'])) {
            $bidId = trim((string)$estimate['bid_id']);
        } elseif ($this->tableExists('bids')) {
            $bStmt = $this->pdo->prepare("SELECT id FROM bids WHERE project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1");
            $bStmt->execute([$projectId]);
            $foundBidId = $bStmt->fetchColumn();
            if ($foundBidId !== false && $foundBidId !== null) {
                $bidId = trim((string)$foundBidId);
            }
        }
        if ($bidId === '') {
            throw new RuntimeException("No valid bid found for project ID: {$projectId}");
        }

        $estimateId = isset($estimate['id']) ? trim((string)$estimate['id']) : '';
        if ($estimateId === '') {
            throw new RuntimeException("Estimate missing ID for project ID: {$projectId}");
        }

        $estimateNumber = trim((string)($estimate['estimate_number'] ?? ''));
        if ($estimateNumber === '') {
            throw new RuntimeException("Estimate missing estimate_number for estimate ID: {$estimateId}");
        }

        $estimateMeta = [];
        if (!empty($estimate['metadata_json'])) {
            $decodedEstMeta = json_decode((string)$estimate['metadata_json'], true);
            if (is_array($decodedEstMeta)) {
                $estimateMeta = $decodedEstMeta;
            }
        }

        $estimateRevision = trim((string)($estimate['revision'] ?? ($estimateMeta['revision'] ?? ($estimateMeta['estimate_revision'] ?? ''))));
        if ($estimateRevision === '') {
            throw new RuntimeException("Estimate missing revision for estimate ID: {$estimateId}");
        }

        $rawCurrency = strtoupper(trim((string)($estimate['currency_code'] ?? '')));
        if (!preg_match('/^[A-Z]{3}$/', $rawCurrency)) {
            throw new RuntimeException("Estimate missing or invalid currency_code for estimate ID: {$estimateId}");
        }
        $estimateCurrency = $rawCurrency;

        if (!isset($estimate['total_cost']) || !is_numeric($estimate['total_cost']) || (float)$estimate['total_cost'] < 0.0) {
            throw new RuntimeException("Estimate missing or invalid total_cost for estimate ID: {$estimateId}");
        }
        $estimateTotalCost = (float)$estimate['total_cost'];

        if (!isset($estimate['labor_hours_total']) || !is_numeric($estimate['labor_hours_total']) || (float)$estimate['labor_hours_total'] < 0.0) {
            throw new RuntimeException("Estimate missing or invalid labor_hours_total for estimate ID: {$estimateId}");
        }
        $laborHoursTotal = (float)$estimate['labor_hours_total'];

        $updatedAtRaw = trim((string)($estimate['updated_at'] ?? ''));
        $ts = ($updatedAtRaw !== '') ? strtotime($updatedAtRaw) : false;
        if ($ts === false) {
            throw new RuntimeException("Estimate missing or invalid updated_at for estimate ID: {$estimateId}");
        }
        $approvedAt = gmdate('Y-m-d\TH:i:s\Z', $ts);

        // Checksum sha256 must be persisted in column or metadata_json (no ad-hoc hash calculation)
        $rawEstChecksum = $estimate['checksum_sha256'] ?? ($estimateMeta['checksum_sha256'] ?? ($estimateMeta['approved_estimate_hash'] ?? null));
        if (!is_string($rawEstChecksum) || !preg_match('/^[a-f0-9]{64}$/i', trim($rawEstChecksum))) {
            throw new RuntimeException("Estimate missing or invalid persisted checksum_sha256 for estimate ID: {$estimateId}");
        }
        $estimateHash = strtolower(trim($rawEstChecksum));

        // 5. Project details
        $projectNumber = trim((string)($project['project_number'] ?? ($projectMeta['project_number'] ?? ($projectMeta['number'] ?? ''))));
        if ($projectNumber === '') {
            throw new RuntimeException("Project missing project_number for project ID: {$projectId}");
        }

        $projectName = trim((string)($project['name'] ?? ($projectMeta['name'] ?? '')));
        if ($projectName === '') {
            throw new RuntimeException("Project missing name for project ID: {$projectId}");
        }

        // Client
        $clientId = trim((string)($project['client_id'] ?? ($clientMeta['client_id'] ?? ($projectMeta['client_id'] ?? ''))));
        if ($clientId === '') {
            throw new RuntimeException("Project missing client_id for project ID: {$projectId}");
        }

        $clientName = trim((string)($project['client_name'] ?? ($clientMeta['name'] ?? ($projectMeta['client_name'] ?? ''))));
        if ($clientName === '') {
            throw new RuntimeException("Project missing client_name for project ID: {$projectId}");
        }

        $contactName = trim((string)($project['contact_name'] ?? ($clientMeta['contact_name'] ?? ($projectMeta['contact_name'] ?? ''))));
        if ($contactName === '') {
            throw new RuntimeException("Project missing contact_name for project ID: {$projectId}");
        }

        $contactEmail = trim((string)($project['contact_email'] ?? ($clientMeta['contact_email'] ?? ($projectMeta['contact_email'] ?? ($project['client_email'] ?? '')))));
        if ($contactEmail === '' || !filter_var($contactEmail, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException("Project missing or invalid contact_email for project ID: {$projectId}");
        }

        $contactPhone = trim((string)($project['contact_phone'] ?? ($clientMeta['contact_phone'] ?? ($projectMeta['contact_phone'] ?? ($project['client_phone'] ?? '')))));
        if (strlen($contactPhone) < 5) {
            throw new RuntimeException("Project missing or invalid contact_phone for project ID: {$projectId}");
        }

        // Location
        $addressLine1 = trim((string)($project['job_address'] ?? ($project['address'] ?? ($locationMeta['address_line1'] ?? ($projectMeta['address_line1'] ?? '')))));
        if ($addressLine1 === '') {
            throw new RuntimeException("Project missing address_line1 for project ID: {$projectId}");
        }

        $city = trim((string)($project['city'] ?? ($locationMeta['city'] ?? ($projectMeta['city'] ?? ''))));
        if ($city === '') {
            throw new RuntimeException("Project missing city for project ID: {$projectId}");
        }

        $state = trim((string)($project['state'] ?? ($locationMeta['state'] ?? ($projectMeta['state'] ?? ''))));
        if ($state === '') {
            throw new RuntimeException("Project missing state for project ID: {$projectId}");
        }

        $postalCode = trim((string)($project['postal_code'] ?? ($locationMeta['postal_code'] ?? ($projectMeta['postal_code'] ?? ''))));
        if ($postalCode === '') {
            throw new RuntimeException("Project missing postal_code for project ID: {$projectId}");
        }

        $countryRaw = strtoupper(trim((string)($project['country'] ?? ($locationMeta['country'] ?? ($projectMeta['country'] ?? '')))));
        if (!preg_match('/^[A-Z]{2}$/', $countryRaw)) {
            throw new RuntimeException("Project missing or invalid country for project ID: {$projectId}");
        }
        $country = $countryRaw;

        $rawLat = $project['latitude'] ?? ($locationMeta['latitude'] ?? ($projectMeta['latitude'] ?? null));
        if ($rawLat === null || !is_numeric($rawLat) || (float)$rawLat < -90.0 || (float)$rawLat > 90.0) {
            throw new RuntimeException("Project missing or invalid latitude for project ID: {$projectId}");
        }
        $latitude = (float)$rawLat;

        $rawLng = $project['longitude'] ?? ($locationMeta['longitude'] ?? ($projectMeta['longitude'] ?? null));
        if ($rawLng === null || !is_numeric($rawLng) || (float)$rawLng < -180.0 || (float)$rawLng > 180.0) {
            throw new RuntimeException("Project missing or invalid longitude for project ID: {$projectId}");
        }
        $longitude = (float)$rawLng;

        $rawRadius = $project['geofence_radius_meters'] ?? ($locationMeta['geofence_radius_meters'] ?? ($projectMeta['geofence_radius_meters'] ?? null));
        if ($rawRadius === null || !is_numeric($rawRadius) || (float)$rawRadius < 10.0 || (float)$rawRadius > 50000.0) {
            throw new RuntimeException("Project missing or invalid geofence_radius_meters for project ID: {$projectId}");
        }
        $geofenceRadius = (float)$rawRadius;

        $location = [
            'address_line1' => $addressLine1,
            'city' => $city,
            'state' => $state,
            'postal_code' => $postalCode,
            'country' => $country,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'geofence_radius_meters' => $geofenceRadius,
        ];

        $addressLine2 = trim((string)($project['address_line2'] ?? ($locationMeta['address_line2'] ?? ($projectMeta['address_line2'] ?? ''))));
        if ($addressLine2 !== '') {
            $location['address_line2'] = $addressLine2;
        }

        // Dates
        $rawStartDate = trim((string)($project['start_date'] ?? ($datesMeta['estimated_start_date'] ?? ($projectMeta['estimated_start_date'] ?? ''))));
        if (preg_match('/^([0-9]{4}-[0-9]{2}-[0-9]{2})/', $rawStartDate, $mStart)) {
            $startDate = $mStart[1];
        } else {
            throw new RuntimeException("Project missing or invalid start_date for project ID: {$projectId}");
        }

        $rawEndDate = trim((string)($project['end_date'] ?? ($datesMeta['estimated_completion_date'] ?? ($projectMeta['estimated_completion_date'] ?? ''))));
        if (preg_match('/^([0-9]{4}-[0-9]{2}-[0-9]{2})/', $rawEndDate, $mEnd)) {
            $endDate = $mEnd[1];
        } else {
            throw new RuntimeException("Project missing or invalid end_date for project ID: {$projectId}");
        }

        // 6. Assigned roles (use real project estimator from estimators table, never convert actor to estimator)
        $assignedRoles = [];
        $estimatorId = !empty($project['estimator_id']) ? (int)$project['estimator_id'] : 0;
        if ($estimatorId > 0 && $this->tableExists('estimators')) {
            $estStmt = $this->pdo->prepare("SELECT id, display_name, email FROM estimators WHERE id = ? AND active = 1 LIMIT 1");
            $estStmt->execute([$estimatorId]);
            $estimatorRow = $estStmt->fetch(PDO::FETCH_ASSOC);
            if ($estimatorRow) {
                $estEmail = trim((string)($estimatorRow['email'] ?? ''));
                $estDisplayName = trim((string)($estimatorRow['display_name'] ?? ''));
                if ($estDisplayName !== '' && $estEmail !== '' && filter_var($estEmail, FILTER_VALIDATE_EMAIL)) {
                    $assignedRoles[] = [
                        'role' => 'estimator',
                        'user_id' => (string)$estimatorRow['id'],
                        'name' => $estDisplayName,
                        'email' => $estEmail,
                    ];
                }
            }
        }

        if (empty($assignedRoles)) {
            throw new RuntimeException("Project missing required assigned_roles for project ID: {$projectId}");
        }

        // 7. Material items snapshot
        $items = [];
        if ($this->tableExists('estimate_items')) {
            $eiStmt = $this->pdo->prepare("SELECT * FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY id ASC");
            $eiStmt->execute([(int)$estimate['id']]);
            $rawItems = $eiStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

            foreach ($rawItems as $rItem) {
                $itemId = isset($rItem['id']) ? trim((string)$rItem['id']) : '';
                if ($itemId === '') {
                    throw new RuntimeException("estimate_item missing id for estimate ID: {$estimateId}");
                }

                $itemMeta = [];
                if (!empty($rItem['metadata_json'])) {
                    $decodedItemMeta = json_decode((string)$rItem['metadata_json'], true);
                    if (is_array($decodedItemMeta)) {
                        $itemMeta = $decodedItemMeta;
                    }
                }

                // Preserve persisted item code without synthetic prefixes
                $itemCode = null;
                if (!empty($rItem['item_code'])) {
                    $itemCode = trim((string)$rItem['item_code']);
                } elseif (!empty($itemMeta['item_code'])) {
                    $itemCode = trim((string)$itemMeta['item_code']);
                } elseif (!empty($rItem['source_layer_key'])) {
                    $itemCode = trim((string)$rItem['source_layer_key']);
                } elseif (!empty($rItem['budget_code'])) {
                    $itemCode = trim((string)$rItem['budget_code']);
                } elseif (!empty($rItem['catalog_item_id'])) {
                    $itemCode = trim((string)$rItem['catalog_item_id']);
                } else {
                    $itemCode = $itemId;
                }

                if ($itemCode === '') {
                    throw new RuntimeException("estimate_item {$itemId} missing item_code");
                }

                $desc = trim((string)($rItem['description'] ?? ($rItem['name'] ?? ($itemMeta['description'] ?? ''))));
                if ($desc === '') {
                    throw new RuntimeException("estimate_item {$itemId} missing description");
                }

                // Preserve persisted category without default fallback
                $rawCategory = $rItem['category'] ?? ($itemMeta['category'] ?? ($rItem['group_name'] ?? ($rItem['cost_type'] ?? null)));
                $category = is_string($rawCategory) ? trim($rawCategory) : '';
                if ($category === '') {
                    throw new RuntimeException("estimate_item {$itemId} missing category");
                }

                if (!isset($rItem['quantity']) || !is_numeric($rItem['quantity']) || (float)$rItem['quantity'] < 0.0) {
                    throw new RuntimeException("estimate_item {$itemId} missing or invalid quantity");
                }
                $quantity = (float)$rItem['quantity'];

                $uom = trim((string)($rItem['unit_of_measure'] ?? ($itemMeta['unit_of_measure'] ?? ($rItem['uom'] ?? ''))));
                if ($uom === '') {
                    throw new RuntimeException("estimate_item {$itemId} missing unit_of_measure");
                }

                $itemData = [
                    'item_id' => $itemId,
                    'item_code' => $itemCode,
                    'description' => $desc,
                    'category' => $category,
                    'quantity' => $quantity,
                    'unit_of_measure' => $uom,
                ];

                if (isset($rItem['unit_cost']) && is_numeric($rItem['unit_cost'])) {
                    $itemData['unit_cost'] = max(0.0, (float)$rItem['unit_cost']);
                }

                // Preserve persisted total_cost without recalculating
                if (isset($rItem['total_cost']) && is_numeric($rItem['total_cost'])) {
                    $itemData['total_cost'] = max(0.0, (float)$rItem['total_cost']);
                }

                $items[] = $itemData;
            }
        }

        // 8. Documents manifest
        $documents = $this->resolveSafeDocuments($projectId);

        $paddedProjectId = str_pad((string)$projectId, 10, '0', STR_PAD_LEFT);
        $paddedEstimateId = str_pad((string)$estimateId, 10, '0', STR_PAD_LEFT);
        $idempotencyKey = 'project.won-' . $paddedProjectId . '-' . $paddedEstimateId;
        $correlationId = 'corr-takeoff-' . $projectId . '-' . substr(bin2hex(random_bytes(8)), 0, 16);

        return [
            'event_id' => $eventId,
            'occurred_at' => $occurredAt,
            'source_system' => 'takeoff',
            'source_project_id' => (string)$projectId,
            'source_bid_id' => $bidId,
            'source_estimate_id' => $estimateId,
            'idempotency_key' => $idempotencyKey,
            'correlation_id' => $correlationId,
            'traceability' => [
                'awarded_by' => [
                    'user_id' => (string)$actorUserId,
                    'email' => $actorEmail,
                    'display_name' => $actorDisplayName,
                ],
            ],
            'approved_estimate' => [
                'estimate_id' => $estimateId,
                'estimate_number' => $estimateNumber,
                'revision' => $estimateRevision,
                'approved_at' => $approvedAt,
                'approved_by_user_id' => (string)$actorUserId,
                'checksum_sha256' => $estimateHash,
                'currency' => $estimateCurrency,
                'total_amount' => $estimateTotalCost,
                'total_labor_hours' => $laborHoursTotal,
            ],
            'project' => [
                'number' => $projectNumber,
                'name' => $projectName,
                'client' => [
                    'client_id' => $clientId,
                    'name' => $clientName,
                    'contact_name' => $contactName,
                    'contact_email' => $contactEmail,
                    'contact_phone' => $contactPhone,
                ],
                'location' => $location,
                'dates' => [
                    'estimated_start_date' => $startDate,
                    'estimated_completion_date' => $endDate,
                ],
                'assigned_roles' => $assignedRoles,
            ],
            'commercial_summary' => [
                'currency' => $estimateCurrency,
                'total_amount' => $estimateTotalCost,
                'total_labor_hours' => $laborHoursTotal,
                'estimate_revision' => $estimateRevision,
                'approved_estimate_hash' => $estimateHash,
            ],
            'materials_snapshot' => [
                'snapshot_id' => 'SNAP-' . $estimateId,
                'version' => '1.0',
                'generated_at' => $occurredAt,
                'total_items' => count($items),
                'items' => $items,
            ],
            'documents_manifest' => [
                'manifest_version' => '1.0',
                'total_files' => count($documents),
                'documents' => $documents,
            ],
        ];
    }

    private function resolveSafeDocuments(int $projectId): array
    {
        $documents = [];
        $allowedTypes = ['drawings', 'specifications', 'proposal', 'contract', 'boq_export', 'permit', 'other'];

        $rows = [];
        if ($this->tableExists('project_documents')) {
            $stmt = $this->pdo->prepare("SELECT * FROM project_documents WHERE project_id = ? AND deleted_at IS NULL ORDER BY id ASC");
            $stmt->execute([$projectId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } elseif ($this->tableExists('files')) {
            $stmt = $this->pdo->prepare("SELECT * FROM files WHERE project_id = ? AND deleted_at IS NULL ORDER BY id ASC");
            $stmt->execute([$projectId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        }

        foreach ($rows as $doc) {
            $docId = isset($doc['id']) ? trim((string)$doc['id']) : '';
            if ($docId === '') {
                continue;
            }

            $docMeta = [];
            if (!empty($doc['metadata_json'])) {
                $decodedDocMeta = json_decode((string)$doc['metadata_json'], true);
                if (is_array($decodedDocMeta)) {
                    $docMeta = $decodedDocMeta;
                }
            }

            // Checksum must be persisted in columns or metadata_json (no fabrication)
            $rawChecksum = $doc['checksum_sha256'] ?? ($doc['sha256'] ?? ($doc['checksum'] ?? ($doc['file_hash'] ?? ($docMeta['checksum_sha256'] ?? ($docMeta['sha256'] ?? ($docMeta['checksum'] ?? null))))));
            if (is_array($rawChecksum) && isset($rawChecksum['value'])) {
                $rawChecksum = $rawChecksum['value'];
            }
            $checksumValue = is_string($rawChecksum) ? strtolower(trim($rawChecksum)) : '';
            if (!preg_match('/^[a-f0-9]{64}$/', $checksumValue)) {
                continue;
            }

            // MIME type must be persisted (no fabrication)
            $contentType = trim((string)($doc['mime_type'] ?? ($doc['content_type'] ?? ($docMeta['mime_type'] ?? ($docMeta['content_type'] ?? '')))));
            if ($contentType === '') {
                continue;
            }

            // File size must be persisted (no fabrication)
            $rawSize = $doc['file_size'] ?? ($doc['filesize'] ?? ($doc['size'] ?? ($docMeta['file_size'] ?? ($docMeta['size_bytes'] ?? null))));
            if ($rawSize === null || !is_numeric($rawSize) || (int)$rawSize < 0) {
                continue;
            }
            $sizeBytes = (int)$rawSize;

            $fileName = trim((string)($doc['original_filename'] ?? ($doc['filename'] ?? ($docMeta['file_name'] ?? ($doc['title'] ?? '')))));
            if ($fileName === '') {
                continue;
            }

            // download_url: persisted URL or secure API endpoint derived from real project_id and document_id
            $persistedUrl = trim((string)($doc['download_url'] ?? ($docMeta['download_url'] ?? ($doc['url'] ?? ($docMeta['url'] ?? '')))));
            $urlPattern = '/^(https:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?\/|\/api\/)[^\\\\\s]+$/';
            if ($persistedUrl !== '' && preg_match($urlPattern, $persistedUrl)) {
                $downloadUrl = $persistedUrl;
            } else {
                $downloadUrl = '/api/projects/' . $projectId . '/documents/' . $docId . '/download';
                if (!preg_match($urlPattern, $downloadUrl)) {
                    continue;
                }
            }

            $rawType = strtolower(trim((string)($doc['document_type'] ?? ($docMeta['document_type'] ?? 'other'))));
            $docType = in_array($rawType, $allowedTypes, true) ? $rawType : 'other';

            $documents[] = [
                'document_id' => $docId,
                'file_name' => $fileName,
                'document_type' => $docType,
                'content_type' => $contentType,
                'size_bytes' => $sizeBytes,
                'checksum' => [
                    'algorithm' => 'sha256',
                    'value' => $checksumValue,
                ],
                'download_url' => $downloadUrl,
            ];
        }

        return $documents;
    }

    private function validateCanonicalPayload(array $payload): void
    {
        // 1. Top-level required
        $requiredTop = [
            'event_id', 'occurred_at', 'source_system', 'source_project_id',
            'source_bid_id', 'source_estimate_id', 'idempotency_key', 'correlation_id',
            'traceability', 'approved_estimate', 'project', 'commercial_summary',
            'materials_snapshot', 'documents_manifest'
        ];
        foreach ($requiredTop as $field) {
            if (!array_key_exists($field, $payload)) {
                throw new RuntimeException("Payload missing required top-level field: {$field}");
            }
        }

        if (!preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', (string)$payload['event_id'])) {
            throw new RuntimeException("Invalid event_id UUID");
        }

        if ($payload['source_system'] !== 'takeoff') {
            throw new RuntimeException("Invalid source_system");
        }

        if (strlen((string)$payload['idempotency_key']) < 16 || strlen((string)$payload['idempotency_key']) > 128) {
            throw new RuntimeException("Invalid idempotency_key length");
        }

        if (strlen((string)$payload['correlation_id']) < 8 || strlen((string)$payload['correlation_id']) > 128) {
            throw new RuntimeException("Invalid correlation_id length");
        }

        // 2. Traceability
        $trace = $payload['traceability'];
        if (!isset($trace['awarded_by']) || !is_array($trace['awarded_by'])) {
            throw new RuntimeException("Traceability missing awarded_by");
        }
        $awardedBy = $trace['awarded_by'];
        if (empty($awardedBy['user_id']) || empty($awardedBy['display_name']) || empty($awardedBy['email']) || !filter_var($awardedBy['email'], FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException("Traceability awarded_by missing or invalid fields");
        }

        // 3. Approved estimate
        $ae = $payload['approved_estimate'];
        if (empty($ae['estimate_id']) || empty($ae['estimate_number']) || empty($ae['revision'])) {
            throw new RuntimeException("Approved estimate missing identifiers");
        }
        if (!preg_match('/^[a-f0-9]{64}$/', (string)($ae['checksum_sha256'] ?? ''))) {
            throw new RuntimeException("Approved estimate checksum_sha256 must be 64-hex SHA-256");
        }
        if (!preg_match('/^[A-Z]{3}$/', (string)($ae['currency'] ?? ''))) {
            throw new RuntimeException("Approved estimate currency must be 3 uppercase letters");
        }
        if (!isset($ae['total_amount']) || !is_numeric($ae['total_amount']) || (float)$ae['total_amount'] < 0.0) {
            throw new RuntimeException("Approved estimate total_amount must be non-negative number");
        }
        if (!isset($ae['total_labor_hours']) || !is_numeric($ae['total_labor_hours']) || (float)$ae['total_labor_hours'] < 0.0) {
            throw new RuntimeException("Approved estimate total_labor_hours must be non-negative number");
        }

        // 4. Project
        $prj = $payload['project'];
        if (empty($prj['number']) || empty($prj['name'])) {
            throw new RuntimeException("Project missing number or name");
        }

        $client = $prj['client'] ?? [];
        if (empty($client['client_id']) || empty($client['name']) || empty($client['contact_name']) || empty($client['contact_email']) || !filter_var($client['contact_email'], FILTER_VALIDATE_EMAIL) || empty($client['contact_phone']) || strlen((string)$client['contact_phone']) < 5) {
            throw new RuntimeException("Project client missing or invalid required fields");
        }

        $loc = $prj['location'] ?? [];
        if (empty($loc['address_line1']) || empty($loc['city']) || empty($loc['state']) || empty($loc['postal_code']) || empty($loc['country']) || !preg_match('/^[A-Z]{2}$/', (string)$loc['country'])) {
            throw new RuntimeException("Project location missing or invalid address fields");
        }
        if (!isset($loc['latitude']) || !is_numeric($loc['latitude']) || (float)$loc['latitude'] < -90.0 || (float)$loc['latitude'] > 90.0) {
            throw new RuntimeException("Project location invalid latitude");
        }
        if (!isset($loc['longitude']) || !is_numeric($loc['longitude']) || (float)$loc['longitude'] < -180.0 || (float)$loc['longitude'] > 180.0) {
            throw new RuntimeException("Project location invalid longitude");
        }
        if (!isset($loc['geofence_radius_meters']) || !is_numeric($loc['geofence_radius_meters']) || (float)$loc['geofence_radius_meters'] < 10.0 || (float)$loc['geofence_radius_meters'] > 50000.0) {
            throw new RuntimeException("Project location invalid geofence_radius_meters");
        }

        $dates = $prj['dates'] ?? [];
        if (empty($dates['estimated_start_date']) || !preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/', (string)$dates['estimated_start_date']) || empty($dates['estimated_completion_date']) || !preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/', (string)$dates['estimated_completion_date'])) {
            throw new RuntimeException("Project dates missing or invalid format");
        }

        if (empty($prj['assigned_roles']) || !is_array($prj['assigned_roles'])) {
            throw new RuntimeException("Project must have at least one assigned role");
        }
        $allowedRoles = ['project_manager', 'lead_electrician', 'estimator', 'supervisor'];
        foreach ($prj['assigned_roles'] as $roleEntry) {
            if (empty($roleEntry['role']) || !in_array($roleEntry['role'], $allowedRoles, true) || empty($roleEntry['user_id']) || empty($roleEntry['name']) || empty($roleEntry['email']) || !filter_var($roleEntry['email'], FILTER_VALIDATE_EMAIL)) {
                throw new RuntimeException("Project assigned role has invalid entry");
            }
        }

        // 5. Commercial summary
        $comm = $payload['commercial_summary'];
        if (!preg_match('/^[A-Z]{3}$/', (string)($comm['currency'] ?? '')) || !isset($comm['total_amount']) || (float)$comm['total_amount'] < 0.0 || !isset($comm['total_labor_hours']) || (float)$comm['total_labor_hours'] < 0.0 || empty($comm['estimate_revision']) || !preg_match('/^[a-f0-9]{64}$/', (string)($comm['approved_estimate_hash'] ?? ''))) {
            throw new RuntimeException("Commercial summary missing or invalid required fields");
        }

        // 6. Material items snapshot
        $mat = $payload['materials_snapshot'];
        if (empty($mat['snapshot_id']) || empty($mat['version']) || empty($mat['generated_at']) || !isset($mat['total_items']) || !is_array($mat['items']) || $mat['total_items'] !== count($mat['items'])) {
            throw new RuntimeException("Material items snapshot missing or invalid fields");
        }
        foreach ($mat['items'] as $item) {
            if (empty($item['item_id']) || empty($item['item_code']) || empty($item['description']) || empty($item['category']) || !isset($item['quantity']) || (float)$item['quantity'] < 0.0 || empty($item['unit_of_measure'])) {
                throw new RuntimeException("Material item missing or invalid required fields");
            }
        }

        // 7. Documents manifest
        $docs = $payload['documents_manifest'];
        if (empty($docs['manifest_version']) || !isset($docs['total_files']) || !is_array($docs['documents']) || $docs['total_files'] !== count($docs['documents'])) {
            throw new RuntimeException("Documents manifest missing or invalid fields");
        }
    }

    private function tableExists(string $tableName): bool
    {
        try {
            $driver = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
            if ($driver === 'sqlite') {
                $stmt = $this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
                $stmt->execute([$tableName]);
                return (bool)$stmt->fetchColumn();
            }

            $stmt = $this->pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?");
            $stmt->execute([$tableName]);
            if ($stmt->fetchColumn()) {
                return true;
            }

            $direct = $this->pdo->query("SELECT 1 FROM `{$tableName}` LIMIT 1");
            return $direct !== false;
        } catch (Throwable $e) {
            return false;
        }
    }

    private function generateUuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); // version 4
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); // variant RFC 4122
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
