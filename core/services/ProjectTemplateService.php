<?php
declare(strict_types=1);

/**
 * Shared service for managing project templates:
 * - Resolving and listing unified template projects
 * - Deep cloning projects & workspaces safely with remapped estimate/layer keys
 * - Resetting workspace & takeoff quantities to 0 for clean templates
 * - Converting an existing project into a new template copy (status = 'templates')
 * - Applying a template into an existing project as a new estimate prefixed with TMPLT_
 */
class ProjectTemplateService
{
    public static function tableExists(PDO $pdo, string $table): bool
    {
        try {
            $driver = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
            if ($driver === 'sqlite') {
                $stmt = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1");
                $stmt->execute([$table]);
                return (bool) $stmt->fetchColumn();
            }
            $stmt = $pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1");
            $stmt->execute([$table]);
            if ($stmt->fetchColumn())
                return true;
        } catch (Throwable $e) {
        }
        try {
            $stmt = $pdo->query("SELECT 1 FROM `{$table}` LIMIT 1");
            return $stmt !== false;
        } catch (Throwable $e) {
            return false;
        }
    }

    public static function tableColumns(PDO $pdo, string $table): array
    {
        static $cache = [];
        $key = spl_object_hash($pdo) . ':' . $table;
        if (isset($cache[$key]))
            return $cache[$key];
        $cols = [];
        try {
            $driver = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
            if ($driver === 'sqlite') {
                $stmt = $pdo->query("PRAGMA table_info(`{$table}`)");
                foreach (($stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
                    if (!empty($row['name']))
                        $cols[(string) $row['name']] = true;
                }
            } else {
                $stmt = $pdo->query("SHOW COLUMNS FROM `{$table}`");
                foreach (($stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
                    if (!empty($row['Field']))
                        $cols[(string) $row['Field']] = true;
                }
            }
        } catch (Throwable $e) {
        }
        $cache[$key] = $cols;
        return $cols;
    }

    public static function defaultEstimateSettings(?PDO $pdo = null): array
    {
        $laborCost = 36.0;
        $laborMargin = 34.6;
        $materialMargin = 15.0;
        $equipmentMargin = 15.0;
        if ($pdo && self::tableExists($pdo, 'company_settings')) {
            try {
                $row = $pdo->query("SELECT * FROM company_settings ORDER BY id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
                if (is_array($row)) {
                    if (isset($row['labor_cost_rate']) && is_numeric($row['labor_cost_rate']) && (float) $row['labor_cost_rate'] > 0) {
                        $laborCost = (float) $row['labor_cost_rate'];
                    }
                    if (isset($row['labor_margin_percent']) && is_numeric($row['labor_margin_percent']) && (float) $row['labor_margin_percent'] > 0) {
                        $laborMargin = (float) $row['labor_margin_percent'];
                    }
                }
            } catch (Throwable $e) {
            }
        }
        $laborSales = $laborMargin < 99.9 ? round($laborCost / (1 - ($laborMargin / 100.0)), 2) : $laborCost;
        return [
            'assemblyExpansionPolicy' => 'CANONICAL',
            'marginMode' => 'margin',
            'globalLaborCost' => $laborCost,
            'globalLaborSales' => $laborSales,
            'globalLaborMargin' => $laborMargin,
            'materialMargin' => $materialMargin,
            'equipmentMargin' => $equipmentMargin,
            'laborWaste' => 0,
            'materialWaste' => 0,
            'equipmentWaste' => 0,
            'laborDifficulty' => 1,
            'taxes' => ['Materials' => 0, 'Labor' => 0, 'Equipment' => 0],
            'preTaxMarkups' => [
                ['id' => 'm_overhead', 'name' => 'Overhead', 'type' => 'percentage', 'percent' => 6, 'amount' => 0, 'base' => 'subtotal_sales', 'operator' => 'add', 'active' => true],
                ['id' => 'm_pre_disc', 'name' => 'Discount', 'type' => 'percentage', 'percent' => 0, 'amount' => 0, 'base' => 'subtotal_sales', 'operator' => 'subtract', 'active' => true],
            ],
            'postTaxMarkups' => [
                ['id' => 'm_bonding', 'name' => 'Bonding', 'type' => 'percentage', 'percent' => 0, 'amount' => 0, 'base' => 'subtotal_sales', 'operator' => 'add', 'active' => true],
                ['id' => 'm_permit', 'name' => 'Permit Impact Fee', 'type' => 'percentage', 'percent' => 0, 'amount' => 0, 'base' => 'subtotal_sales', 'operator' => 'add', 'active' => true],
                ['id' => 'm_lvbox', 'name' => 'Low Voltage Box', 'type' => 'percentage', 'percent' => 0, 'amount' => 0, 'base' => 'subtotal_sales', 'operator' => 'add', 'active' => true],
                ['id' => 'm_post_disc', 'name' => 'Discount', 'type' => 'percentage', 'percent' => 0, 'amount' => 0, 'base' => 'subtotal_sales', 'operator' => 'subtract', 'active' => true],
            ],
            '_markupsSeeded' => true,
            '_defaultsActivated' => true,
            '_laborDefaultsActivated' => true,
        ];
    }

    public static function decodeJson(?string $raw): array
    {
        if (!$raw)
            return [];
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    public static function uid(string $prefix = 'id'): string
    {
        return $prefix . '_' . bin2hex(random_bytes(6));
    }

    private static function zeroItemsRecursive(array $items, ?int $projectId = null, ?string $clientEstimateId = null): array
    {
        $out = [];
        foreach ($items as $item) {
            if (!is_array($item))
                continue;
            $item['quantity'] = 0;
            $item['originalQuantity'] = 0;
            $item['lastSyncedTakeoffQuantity'] = 0;
            $item['pendingTakeoffQuantity'] = null;
            $item['quantityOverride'] = false;
            $item['quantitySource'] = 'takeoff';
            $item['quantitySyncStatus'] = 'synced';
            $item['equipmentQuantity'] = 0;
            if ($projectId !== null && $projectId > 0) {
                $item['projectId'] = (string) $projectId;
            }
            if ($clientEstimateId !== null && $clientEstimateId !== '') {
                $item['estimateId'] = $clientEstimateId;
            }
            if (!empty($item['children']) && is_array($item['children'])) {
                $item['children'] = self::zeroItemsRecursive($item['children'], $projectId, $clientEstimateId);
            }
            $out[] = $item;
        }
        return $out;
    }

    public static function zeroWorkspaceData(array $workspace, ?int $projectId = null, ?string $clientEstimateId = null, ?int $dbEstimateId = null): array
    {
        if ($projectId !== null && $projectId > 0) {
            $workspace['projectId'] = (string) $projectId;
        }
        if ($clientEstimateId !== null && $clientEstimateId !== '') {
            $workspace['id'] = $clientEstimateId;
        }
        if ($dbEstimateId !== null && $dbEstimateId > 0) {
            $workspace['dbEstimateId'] = $dbEstimateId;
            $workspace['estimateItemId'] = $dbEstimateId;
        }
        $workspace['estimateTotal'] = 0;
        $workspace['totalSales'] = 0;
        $workspace['grand_total'] = 0;
        $workspace['total_amount'] = 0;
        $workspace['estimateSummary'] = [
            'material' => 0,
            'labor' => 0,
            'equipment' => 0,
            'waste' => 0,
            'markup' => 0,
            'estimateTotal' => 0,
            'total' => 0,
            'laborHours' => 0,
        ];
        if (!empty($workspace['groups']) && is_array($workspace['groups'])) {
            foreach ($workspace['groups'] as &$group) {
                if (!is_array($group))
                    continue;
                if ($clientEstimateId !== null && $clientEstimateId !== '' && !empty($group['estimateId'])) {
                    $group['estimateId'] = $clientEstimateId;
                }
                if (!empty($group['items']) && is_array($group['items'])) {
                    $group['items'] = self::zeroItemsRecursive($group['items'], $projectId, $clientEstimateId);
                }
            }
            unset($group);
        }
        return $workspace;
    }

    public static function resetProjectQuantitiesToZero(PDO $pdo, int $projectId): void
    {
        if ($projectId <= 0)
            return;

        if (self::tableExists($pdo, 'takeoff_layers')) {
            $layerIdsStmt = $pdo->prepare("SELECT id FROM takeoff_layers WHERE project_id = ?");
            $layerIdsStmt->execute([$projectId]);
            $layerIds = array_map('intval', $layerIdsStmt->fetchAll(PDO::FETCH_COLUMN) ?: []);
            if ($layerIds) {
                $in = implode(',', array_fill(0, count($layerIds), '?'));
                if (self::tableExists($pdo, 'takeoff_count_markers')) {
                    $pdo->prepare("DELETE FROM takeoff_count_markers WHERE layer_id IN ($in)")->execute($layerIds);
                }
                if (self::tableExists($pdo, 'takeoff_linear_segments')) {
                    $pdo->prepare("DELETE FROM takeoff_linear_segments WHERE layer_id IN ($in)")->execute($layerIds);
                }
            }
            $pdo->prepare("UPDATE takeoff_layers SET quantity = 0 WHERE project_id = ?")->execute([$projectId]);
        }

        if (self::tableExists($pdo, 'takeoff_estimate_states')) {
            $stStmt = $pdo->prepare("SELECT estimate_key, drawing_id, state_json FROM takeoff_estimate_states WHERE project_id = ?");
            $stStmt->execute([$projectId]);
            $upd = $pdo->prepare("UPDATE takeoff_estimate_states SET state_json = ?, revision = COALESCE(revision, 0) + 1 WHERE estimate_key = ? AND drawing_id = ?");
            foreach ($stStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $decoded = self::decodeJson((string) ($row['state_json'] ?? ''));
                if (!$decoded)
                    continue;
                $layers = is_array($decoded['layers'] ?? null) ? $decoded['layers'] : [];
                foreach ($layers as &$ly) {
                    if (!is_array($ly))
                        continue;
                    $ly['quantity'] = 0;
                    $ly['baseQuantity'] = 0;
                    $ly['base_quantity'] = 0;
                    $ly['seed_quantity'] = 0;
                    if (is_array($ly['metadata_json'] ?? null)) {
                        $ly['metadata_json']['base_quantity'] = 0;
                    }
                }
                unset($ly);
                $decoded['layers'] = $layers;
                $decoded['markers'] = [];
                $decoded['segments'] = [];
                $decoded['summary'] = [];
                $encoded = json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                if ($encoded !== false) {
                    $upd->execute([$encoded, $row['estimate_key'], $row['drawing_id']]);
                }
            }
        }

        if (self::tableExists($pdo, 'estimates')) {
            $estCols = self::tableColumns($pdo, 'estimates');
            $setParts = [];
            foreach (['subtotal_cost', 'markup_total', 'tax_total', 'total_cost', 'labor_hours_total'] as $col) {
                if (isset($estCols[$col]))
                    $setParts[] = "`$col` = 0";
            }
            if ($setParts) {
                $pdo->prepare("UPDATE estimates SET " . implode(', ', $setParts) . " WHERE project_id = ?")->execute([$projectId]);
            }

            $estIds = array_map('intval', $pdo->query("SELECT id FROM estimates WHERE project_id = " . (int) $projectId)->fetchAll(PDO::FETCH_COLUMN) ?: []);
            if ($estIds && self::tableExists($pdo, 'estimate_items')) {
                $eiCols = self::tableColumns($pdo, 'estimate_items');
                $eiSets = [];
                foreach (['quantity', 'material_cost', 'labor_cost', 'equipment_cost', 'subcontractor_cost', 'labor_hours', 'subtotal_cost', 'total_cost'] as $col) {
                    if (isset($eiCols[$col]))
                        $eiSets[] = "`$col` = 0";
                }
                if (isset($eiCols['is_quantity_locked_from_takeoff']))
                    $eiSets[] = "is_quantity_locked_from_takeoff = 1";
                if ($eiSets) {
                    $in = implode(',', array_fill(0, count($estIds), '?'));
                    $pdo->prepare("UPDATE estimate_items SET " . implode(', ', $eiSets) . " WHERE estimate_id IN ($in)")->execute($estIds);
                }
            }
            if ($estIds && self::tableExists($pdo, 'estimate_workspace_states')) {
                $wsStmt = $pdo->prepare("SELECT estimate_id, client_estimate_id, state_json FROM estimate_workspace_states WHERE project_id = ?");
                $wsStmt->execute([$projectId]);
                $wsUpd = $pdo->prepare("UPDATE estimate_workspace_states SET state_json = ?, revision = COALESCE(revision, 0) + 1 WHERE estimate_id = ?");
                foreach ($wsStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $ws) {
                    $decoded = self::decodeJson((string) ($ws['state_json'] ?? ''));
                    if (!$decoded)
                        continue;
                    $zeroed = self::zeroWorkspaceData($decoded, $projectId, (string) $ws['client_estimate_id'], (int) $ws['estimate_id']);
                    $encoded = json_encode($zeroed, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                    if ($encoded !== false) {
                        $wsUpd->execute([$encoded, (int) $ws['estimate_id']]);
                    }
                }
            }
        }
    }

    /**
     * Ensures every project whose status is 'templates' has a synced active row
     * in project_templates pointing to it via settings_json.source_project_id,
     * and returns all active templates sorted by name.
     */
    public static function listTemplates(PDO $pdo): array
    {
        if (!self::tableExists($pdo, 'project_templates'))
            return [];

        $tplRows = $pdo->query("SELECT * FROM project_templates WHERE deleted_at IS NULL ORDER BY id ASC")->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $projRows = self::tableExists($pdo, 'projects')
            ? ($pdo->query("SELECT id, name, description, status, project_template_id, metadata_json FROM projects WHERE deleted_at IS NULL ORDER BY id ASC")->fetchAll(PDO::FETCH_ASSOC) ?: [])
            : [];

        $projById = [];
        $projByName = [];
        foreach ($projRows as $pr) {
            $pid = (int) $pr['id'];
            $projById[$pid] = $pr;
            $key = strtolower(trim((string) $pr['name']));
            if ($key !== '' && !isset($projByName[$key])) {
                $projByName[$key] = $pid;
            }
        }

        $linkedProjectIds = [];
        $tplCols = self::tableColumns($pdo, 'project_templates');
        $updSettings = isset($tplCols['settings_json'])
            ? $pdo->prepare("UPDATE project_templates SET settings_json = ? WHERE id = ?")
            : null;

        foreach ($tplRows as &$tpl) {
            $settings = self::decodeJson($tpl['settings_json'] ?? null);
            $sourcePid = isset($settings['source_project_id']) ? (int) $settings['source_project_id'] : 0;
            if ($sourcePid <= 0 || !isset($projById[$sourcePid])) {
                $nameKey = strtolower(trim((string) ($tpl['name'] ?? '')));
                if ($nameKey !== '' && isset($projByName[$nameKey])) {
                    $sourcePid = (int) $projByName[$nameKey];
                    $settings['source_project_id'] = $sourcePid;
                    $tpl['settings_json'] = json_encode($settings, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                    if ($updSettings)
                        $updSettings->execute([$tpl['settings_json'], (int) $tpl['id']]);
                } else {
                    foreach ($projRows as $pr) {
                        if ((int) ($pr['project_template_id'] ?? 0) === (int) $tpl['id'] && strtolower(trim((string) $pr['status'])) === 'templates') {
                            $sourcePid = (int) $pr['id'];
                            $settings['source_project_id'] = $sourcePid;
                            $tpl['settings_json'] = json_encode($settings, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                            if ($updSettings)
                                $updSettings->execute([$tpl['settings_json'], (int) $tpl['id']]);
                            break;
                        }
                    }
                }
            }
            if ($sourcePid > 0 && isset($projById[$sourcePid])) {
                $tpl['source_project_id'] = $sourcePid;
                $linkedProjectIds[$sourcePid] = (int) $tpl['id'];
            } else {
                $tpl['source_project_id'] = null;
            }
        }
        unset($tpl);

        // Auto-register any project with status = 'templates' not yet represented
        foreach ($projRows as $pr) {
            if (strtolower(trim((string) ($pr['status'] ?? ''))) !== 'templates')
                continue;
            $pid = (int) $pr['id'];
            if (isset($linkedProjectIds[$pid]))
                continue;
            $newId = self::upsertTemplateEntryForProject($pdo, $pid, $pr['name'], $pr['description'] ?? null);
            if ($newId > 0) {
                $tplRows[] = [
                    'id' => $newId,
                    'name' => $pr['name'],
                    'description' => $pr['description'] ?? null,
                    'trade' => 'Electrical',
                    'settings_json' => json_encode(['source_project_id' => $pid], JSON_UNESCAPED_SLASHES),
                    'active' => 1,
                    'source_project_id' => $pid,
                ];
            }
        }

        $active = array_values(array_filter($tplRows, function ($t) {
            if ((int) ($t['active'] ?? 1) !== 1)
                return false;
            return !empty($t['source_project_id']);
        }));
        usort($active, function ($a, $b) {
            return strcasecmp((string) ($a['name'] ?? ''), (string) ($b['name'] ?? ''));
        });
        return $active;
    }

    public static function upsertTemplateEntryForProject(PDO $pdo, int $projectId, string $name, ?string $description = null): int
    {
        if (!self::tableExists($pdo, 'project_templates') || $projectId <= 0)
            return 0;
        $rows = $pdo->query("SELECT id, name, settings_json FROM project_templates WHERE deleted_at IS NULL")->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $matchedId = 0;
        $matchedSettings = [];
        foreach ($rows as $row) {
            $s = self::decodeJson($row['settings_json'] ?? null);
            if ((int) ($s['source_project_id'] ?? 0) === $projectId || strcasecmp(trim((string) $row['name']), trim($name)) === 0) {
                $matchedId = (int) $row['id'];
                $matchedSettings = $s;
                break;
            }
        }
        $matchedSettings['source_project_id'] = $projectId;
        $settingsJson = json_encode($matchedSettings, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($matchedId > 0) {
            $stmt = $pdo->prepare("UPDATE project_templates SET name = ?, description = ?, settings_json = ?, active = 1 WHERE id = ?");
            $stmt->execute([trim($name), $description, $settingsJson, $matchedId]);
            return $matchedId;
        }
        $stmt = $pdo->prepare("INSERT INTO project_templates (name, description, trade, settings_json, active) VALUES (?, ?, 'Electrical', ?, 1)");
        $stmt->execute([trim($name), $description, $settingsJson]);
        return (int) $pdo->lastInsertId();
    }

    public static function syncTemplateStatusForProject(PDO $pdo, int $projectId): void
    {
        if ($projectId <= 0 || !self::tableExists($pdo, 'projects') || !self::tableExists($pdo, 'project_templates'))
            return;
        $stmt = $pdo->prepare("SELECT id, name, description, status FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $stmt->execute([$projectId]);
        $proj = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$proj)
            return;
        $isTemplate = strtolower(trim((string) ($proj['status'] ?? ''))) === 'templates';
        if ($isTemplate) {
            self::upsertTemplateEntryForProject($pdo, $projectId, (string) $proj['name'], $proj['description'] ?? null);
            return;
        }
        $rows = $pdo->query("SELECT id, settings_json FROM project_templates WHERE deleted_at IS NULL")->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $deact = $pdo->prepare("UPDATE project_templates SET active = 0 WHERE id = ?");
        foreach ($rows as $row) {
            $s = self::decodeJson($row['settings_json'] ?? null);
            if ((int) ($s['source_project_id'] ?? 0) === $projectId) {
                $deact->execute([(int) $row['id']]);
            }
        }
    }

    public static function resolveTemplateSource(PDO $pdo, int $templateOrProjectId): array
    {
        if ($templateOrProjectId <= 0)
            return [0, 'Template'];
        $templates = self::listTemplates($pdo);
        foreach ($templates as $tpl) {
            if ((int) $tpl['id'] === $templateOrProjectId) {
                return [(int) $tpl['source_project_id'], (string) $tpl['name']];
            }
        }
        foreach ($templates as $tpl) {
            if ((int) ($tpl['source_project_id'] ?? 0) === $templateOrProjectId) {
                return [$templateOrProjectId, (string) $tpl['name']];
            }
        }
        $stmt = $pdo->prepare("SELECT id, name FROM project_templates WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $stmt->execute([$templateOrProjectId]);
        $rawTpl = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($rawTpl) {
            $settings = [];
            $pStmt = $pdo->prepare("SELECT id FROM projects WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL LIMIT 1");
            $pStmt->execute([$rawTpl['name']]);
            $pid = (int) $pStmt->fetchColumn();
            if ($pid > 0)
                return [$pid, (string) $rawTpl['name']];
        }
        $stmtP = $pdo->prepare("SELECT id, name, status FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $stmtP->execute([$templateOrProjectId]);
        $proj = $stmtP->fetch(PDO::FETCH_ASSOC);
        if ($proj && strtolower(trim((string) $proj['status'])) === 'templates') {
            return [(int) $proj['id'], (string) $proj['name']];
        }
        return [0, $rawTpl['name'] ?? 'Template'];
    }

    public static function deepCloneProjectWorkspace(PDO $pdo, int $sourceId, int $newId, array $options = []): void
    {
        $includeDocuments = array_key_exists('includeDocuments', $options) ? (bool) $options['includeDocuments'] : true;
        $resetQuantities = !empty($options['resetQuantities']);

        $inTransaction = $pdo->inTransaction();
        if (!$inTransaction)
            $pdo->beginTransaction();

        try {
            $folderMap = [];
            $docFolderMap = [];
            $fileMap = [];
            $docMap = [];
            $takeoffMap = [];
            $layerMap = [];
            $layerUidMap = [];
            $estimateMap = [];
            $estimateClientKeyMap = [];

            if ($includeDocuments) {
                if (self::tableExists($pdo, 'folders')) {
                    $stmt = $pdo->prepare("SELECT * FROM folders WHERE project_id = ? ORDER BY COALESCE(parent_id, 0) ASC, id ASC");
                    $stmt->execute([$sourceId]);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $f) {
                        $oldFid = (int) $f['id'];
                        unset($f['id'], $f['created_at'], $f['updated_at']);
                        $f['project_id'] = $newId;
                        if (isset($f['parent_id']) && $f['parent_id'] !== null && isset($folderMap[(int) $f['parent_id']])) {
                            $f['parent_id'] = $folderMap[(int) $f['parent_id']];
                        }
                        $cols = array_keys($f);
                        $pdo->prepare("INSERT INTO folders (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($f));
                        $folderMap[$oldFid] = (int) $pdo->lastInsertId();
                    }
                }
                if (self::tableExists($pdo, 'document_folders')) {
                    $stmt = $pdo->prepare("SELECT * FROM document_folders WHERE project_id = ? ORDER BY COALESCE(parent_folder_id, 0) ASC, id ASC");
                    $stmt->execute([$sourceId]);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $df) {
                        $oldDfid = (int) $df['id'];
                        unset($df['id'], $df['created_at'], $df['updated_at'], $df['deleted_at']);
                        $df['project_id'] = $newId;
                        if (isset($df['parent_folder_id']) && $df['parent_folder_id'] !== null && isset($docFolderMap[(int) $df['parent_folder_id']])) {
                            $df['parent_folder_id'] = $docFolderMap[(int) $df['parent_folder_id']];
                        }
                        $cols = array_keys($df);
                        $pdo->prepare("INSERT INTO document_folders (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($df));
                        $docFolderMap[$oldDfid] = (int) $pdo->lastInsertId();
                    }
                }
                if (self::tableExists($pdo, 'files')) {
                    $stmt = $pdo->prepare("SELECT * FROM files WHERE project_id = ? AND deleted_at IS NULL");
                    $stmt->execute([$sourceId]);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $fl) {
                        $oldFlId = (int) $fl['id'];
                        unset($fl['id'], $fl['created_at'], $fl['updated_at'], $fl['deleted_at']);
                        $fl['project_id'] = $newId;
                        if (isset($fl['folder_id']) && $fl['folder_id'] !== null && isset($folderMap[(int) $fl['folder_id']])) {
                            $fl['folder_id'] = $folderMap[(int) $fl['folder_id']];
                        }
                        $cols = array_keys($fl);
                        $pdo->prepare("INSERT INTO files (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($fl));
                        $fileMap[$oldFlId] = (int) $pdo->lastInsertId();
                    }
                }
                if (self::tableExists($pdo, 'project_documents')) {
                    $stmt = $pdo->prepare("SELECT * FROM project_documents WHERE project_id = ? AND deleted_at IS NULL");
                    $stmt->execute([$sourceId]);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $dc) {
                        $oldDcId = (int) $dc['id'];
                        unset($dc['id'], $dc['created_at'], $dc['updated_at'], $dc['deleted_at']);
                        $dc['project_id'] = $newId;
                        if (isset($dc['document_folder_id']) && $dc['document_folder_id'] !== null && isset($docFolderMap[(int) $dc['document_folder_id']])) {
                            $dc['document_folder_id'] = $docFolderMap[(int) $dc['document_folder_id']];
                        }
                        if (isset($dc['file_id']) && $dc['file_id'] !== null && isset($fileMap[(int) $dc['file_id']])) {
                            $dc['file_id'] = $fileMap[(int) $dc['file_id']];
                        }
                        $cols = array_keys($dc);
                        $pdo->prepare("INSERT INTO project_documents (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($dc));
                        $docMap[$oldDcId] = (int) $pdo->lastInsertId();
                    }
                }
            }

            // Estimates + Estimate Workspace States first so we have oldClientKey => newClientKey mapping
            if (self::tableExists($pdo, 'estimates')) {
                $stmt = $pdo->prepare("SELECT * FROM estimates WHERE project_id = ? AND deleted_at IS NULL");
                $stmt->execute([$sourceId]);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $est) {
                    $oldEstId = (int) $est['id'];
                    unset($est['id'], $est['created_at'], $est['updated_at'], $est['deleted_at']);
                    $est['project_id'] = $newId;
                    foreach (['estimate_number', 'estimating_id', 'takeoff_id', 'bid_id'] as $detachedColumn) {
                        if (array_key_exists($detachedColumn, $est)) {
                            $est[$detachedColumn] = null;
                        }
                    }
                    if ($resetQuantities) {
                        foreach (['subtotal_cost', 'markup_total', 'tax_total', 'total_cost', 'labor_hours_total'] as $zc) {
                            if (array_key_exists($zc, $est))
                                $est[$zc] = 0;
                        }
                    }
                    $cols = array_keys($est);
                    $pdo->prepare("INSERT INTO estimates (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($est));
                    $estimateMap[$oldEstId] = (int) $pdo->lastInsertId();
                }
            }

            if (self::tableExists($pdo, 'estimate_markups') && !empty($estimateMap)) {
                $estIds = array_keys($estimateMap);
                $inClause = implode(',', array_fill(0, count($estIds), '?'));
                $stmt = $pdo->prepare("SELECT * FROM estimate_markups WHERE estimate_id IN ($inClause)");
                $stmt->execute($estIds);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $mkp) {
                    unset($mkp['id'], $mkp['created_at'], $mkp['updated_at']);
                    $mkp['estimate_id'] = $estimateMap[(int) $mkp['estimate_id']] ?? $mkp['estimate_id'];
                    $cols = array_keys($mkp);
                    $pdo->prepare("INSERT INTO estimate_markups (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($mkp));
                }
            }

            // 5. Estimate Workspace States (preserving primary estimate, markups, summary rates & group/item order)
            $wsLayerOrderByEst = [];
            $wsHasGroupsByEst = [];
            $wsLiveItemIdsByEst = [];
            $wsSyncModeByEst = [];
            if (self::tableExists($pdo, 'estimate_workspace_states') && !empty($estimateMap)) {
                $estIds = array_keys($estimateMap);
                $inClause = implode(',', array_fill(0, count($estIds), '?'));
                $stmt = $pdo->prepare("SELECT * FROM estimate_workspace_states WHERE estimate_id IN ($inClause)");
                $stmt->execute($estIds);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $ws) {
                    $oldEstId = (int) $ws['estimate_id'];
                    $newEstId = $estimateMap[$oldEstId] ?? null;
                    if (!$newEstId)
                        continue;
                    $oldClientId = (string) ($ws['client_estimate_id'] ?? '');
                    unset($ws['id'], $ws['created_at'], $ws['updated_at']);
                    $ws['estimate_id'] = $newEstId;
                    $ws['project_id'] = $newId;
                    $newClientId = 'estimate_' . substr(md5($newId . '_' . $newEstId . '_' . uniqid('', true)), 0, 14);
                    $ws['client_estimate_id'] = $newClientId;
                    if ($oldClientId !== '') {
                        $estimateClientKeyMap[$oldClientId] = $newClientId;
                    }
                    $estimateClientKeyMap[(string) $oldEstId] = $newClientId;
                    if (!empty($ws['state_json'])) {
                        $decoded = json_decode((string) $ws['state_json'], true);
                        if (is_array($decoded)) {
                            $decoded['id'] = $newClientId;
                            $decoded['dbEstimateId'] = $newEstId;
                            $decoded['estimateItemId'] = $newEstId;
                            $decoded['projectId'] = (string) $newId;
                            if ($resetQuantities) {
                                $decoded = self::zeroWorkspaceData($decoded, $newId, $newClientId, $newEstId);
                            }
                            if (isset($decoded['groups']) && is_array($decoded['groups'])) {
                                $seq = 0;
                                $wsHasGroupsByEst[$newClientId] = true;
                                $wsSyncModeByEst[$newClientId] = (string) ($decoded['takeoffSyncMode'] ?? 'mirror');
                                $wsLayerOrderByEst[$newClientId] = [];
                                $wsLiveItemIdsByEst[$newClientId] = [];
                                foreach ($decoded['groups'] as $grp) {
                                    if (!is_array($grp))
                                        continue;
                                    $gName = trim((string) ($grp['name'] ?? ''));
                                    foreach (($grp['items'] ?? []) as $it) {
                                        if (!is_array($it))
                                            continue;
                                        if (!empty($it['parentItemId']) || !empty($it['parent_item_id']) || !empty($it['assemblyParentId']))
                                            continue;
                                        $estItemId = trim((string) ($it['id'] ?? ''));
                                        if ($estItemId !== '') {
                                            $wsLiveItemIdsByEst[$newClientId][$estItemId] = true;
                                        }
                                        $lk = trim((string) ($it['takeoffLayerId'] ?? ''));
                                        if ($lk !== '' && !isset($wsLayerOrderByEst[$newClientId][$lk])) {
                                            $wsLayerOrderByEst[$newClientId][$lk] = [
                                                'order' => $seq++,
                                                'group_name' => $gName,
                                            ];
                                        }
                                    }
                                }
                            }
                            $ws['state_json'] = json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                        }
                    }
                    $cols = array_keys($ws);
                    $pdo->prepare("INSERT INTO estimate_workspace_states (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($ws));
                }
            }

            // Takeoffs
            if (self::tableExists($pdo, 'takeoffs')) {
                $stmt = $pdo->prepare("SELECT * FROM takeoffs WHERE project_id = ? AND deleted_at IS NULL");
                $stmt->execute([$sourceId]);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $tk) {
                    if (!$includeDocuments && !empty($tk['drawing_id'])) {
                        // Still allow one base takeoff container when copying without PDFs
                        if (!empty($takeoffMap))
                            continue;
                    }
                    $oldTkId = (int) $tk['id'];
                    unset($tk['id'], $tk['created_at'], $tk['updated_at'], $tk['deleted_at']);
                    $tk['project_id'] = $newId;
                    if (isset($tk['estimate_id'])) {
                        $tk['estimate_id'] = isset($estimateMap[(int) $tk['estimate_id']])
                            ? $estimateMap[(int) $tk['estimate_id']]
                            : null;
                    }
                    if ($includeDocuments) {
                        if (isset($tk['drawing_id']) && $tk['drawing_id'] !== null) {
                            if (isset($fileMap[(int) $tk['drawing_id']]))
                                $tk['drawing_id'] = $fileMap[(int) $tk['drawing_id']];
                            elseif (isset($docMap[(int) $tk['drawing_id']]))
                                $tk['drawing_id'] = $docMap[(int) $tk['drawing_id']];
                        }
                    } else {
                        $tk['drawing_id'] = null;
                        $tk['name'] = 'Project Takeoff';
                        $tk['metadata_json'] = null;
                    }
                    $cols = array_keys($tk);
                    $pdo->prepare("INSERT INTO takeoffs (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($tk));
                    $takeoffMap[$oldTkId] = (int) $pdo->lastInsertId();
                }
            }

            // Takeoff Layers (deduped by integration_key + estimate_key if cloning without documents)
            if (self::tableExists($pdo, 'takeoff_layers')) {
                $layerCols = self::tableColumns($pdo, 'takeoff_layers');
                $layerOrderBy = !empty($layerCols['sort_order']) ? 'ORDER BY sort_order ASC, id ASC' : 'ORDER BY id ASC';
                $stmt = $pdo->prepare("SELECT * FROM takeoff_layers WHERE project_id = ? AND deleted_at IS NULL {$layerOrderBy}");
                $stmt->execute([$sourceId]);
                $defaultTargetTakeoffId = $takeoffMap ? reset($takeoffMap) : null;
                $seenWithoutDocs = [];
                $rawLayers = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
                $indexedLayers = [];
                foreach ($rawLayers as $origIdx => $ly) {
                    $oldEstimateKey = (string) ($ly['estimate_key'] ?? '');
                    $mappedEstKey = $estimateClientKeyMap[$oldEstimateKey] ?? $oldEstimateKey;
                    $metaTmp = self::decodeJson($ly['metadata_json'] ?? null);
                    $ik = (string) ($ly['integration_key'] ?? '');
                    $plk = (string) ($metaTmp['project_layer_id'] ?? '');
                    $orderInfo = $wsLayerOrderByEst[$mappedEstKey][$ik] ?? ($plk !== '' ? ($wsLayerOrderByEst[$mappedEstKey][$plk] ?? null) : null);
                    if ($resetQuantities && !empty($wsHasGroupsByEst[$mappedEstKey])) {
                        $linkedEstItemId = trim((string) ($metaTmp['estimating_item_id'] ?? ''));
                        $inWsByLayerKey = ($ik !== '' && isset($wsLayerOrderByEst[$mappedEstKey][$ik]))
                            || ($plk !== '' && isset($wsLayerOrderByEst[$mappedEstKey][$plk]));
                        $inWsByEstItem = $linkedEstItemId !== '' && isset($wsLiveItemIdsByEst[$mappedEstKey][$linkedEstItemId]);
                        $estIsMirror = ($wsSyncModeByEst[$mappedEstKey] ?? 'mirror') !== 'linked-only';
                        if (!$inWsByLayerKey && !$inWsByEstItem && ($linkedEstItemId !== '' || $estIsMirror || !empty($wsLayerOrderByEst[$mappedEstKey]))) {
                            // Do not resurrect layers removed from the authoritative estimating workspace when cloning templates
                            continue;
                        }
                    }
                    $indexedLayers[] = [
                        'ly' => $ly,
                        'origIdx' => $origIdx,
                        'mappedEstKey' => $mappedEstKey,
                        'orderInfo' => $orderInfo,
                    ];
                }
                usort($indexedLayers, function ($a, $b) {
                    $oa = $a['orderInfo'] ? (int) $a['orderInfo']['order'] : PHP_INT_MAX;
                    $ob = $b['orderInfo'] ? (int) $b['orderInfo']['order'] : PHP_INT_MAX;
                    if ($oa !== $ob)
                        return $oa <=> $ob;
                    return $a['origIdx'] <=> $b['origIdx'];
                });
                $nextLayerSortByEst = [];
                foreach ($indexedLayers as $entry) {
                    $ly = $entry['ly'];
                    $oldLyId = (int) $ly['id'];
                    $oldEstimateKey = (string) ($ly['estimate_key'] ?? '');
                    $mappedEstKey = $entry['mappedEstKey'];
                    $oldIntegrationKey = (string) ($ly['integration_key'] ?? '');
                    if (!$includeDocuments && $oldIntegrationKey !== '') {
                        $dedupe = $mappedEstKey . '|' . $oldIntegrationKey;
                        if (isset($seenWithoutDocs[$dedupe]))
                            continue;
                        $seenWithoutDocs[$dedupe] = true;
                    }
                    unset($ly['id'], $ly['created_at'], $ly['updated_at'], $ly['deleted_at']);
                    $ly['project_id'] = $newId;
                    if (isset($ly['takeoff_id']) && isset($takeoffMap[(int) $ly['takeoff_id']])) {
                        $ly['takeoff_id'] = $takeoffMap[(int) $ly['takeoff_id']];
                    } elseif (!$includeDocuments && $defaultTargetTakeoffId) {
                        $ly['takeoff_id'] = $defaultTargetTakeoffId;
                    }
                    if ($mappedEstKey !== '') {
                        $ly['estimate_key'] = $mappedEstKey;
                    }
                    if (!isset($nextLayerSortByEst[$mappedEstKey])) {
                        $nextLayerSortByEst[$mappedEstKey] = 0;
                    }
                    $ly['sort_order'] = $nextLayerSortByEst[$mappedEstKey]++;
                    if (!empty($entry['orderInfo']['group_name'])) {
                        $ly['group_name'] = $entry['orderInfo']['group_name'];
                    }
                    if ($includeDocuments) {
                        if (isset($ly['drawing_id']) && $ly['drawing_id'] !== null) {
                            if (isset($fileMap[(int) $ly['drawing_id']]))
                                $ly['drawing_id'] = $fileMap[(int) $ly['drawing_id']];
                            elseif (isset($docMap[(int) $ly['drawing_id']]))
                                $ly['drawing_id'] = $docMap[(int) $ly['drawing_id']];
                        }
                    } else {
                        $ly['drawing_id'] = null;
                    }
                    if ($resetQuantities) {
                        $ly['quantity'] = 0;
                    }
                    $meta = self::decodeJson($ly['metadata_json'] ?? null);
                    if ($meta) {
                        if ($mappedEstKey !== '')
                            $meta['estimate_id'] = $mappedEstKey;
                        if (!$includeDocuments)
                            unset($meta['file_drawing_id']);
                        if ($resetQuantities)
                            $meta['base_quantity'] = 0;
                        $ly['metadata_json'] = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                    }
                    $cols = array_keys($ly);
                    $pdo->prepare("INSERT INTO takeoff_layers (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($ly));
                    $layerMap[$oldLyId] = (int) $pdo->lastInsertId();
                    if ($oldIntegrationKey !== '') {
                        $layerUidMap[$oldIntegrationKey] = $oldIntegrationKey;
                    }
                }
            }

            // Copy canvas geometry only when requested AND not resetting quantities
            if ($includeDocuments && !$resetQuantities) {
                if (self::tableExists($pdo, 'takeoff_count_markers') && !empty($layerMap)) {
                    $layerIds = array_keys($layerMap);
                    $inClause = implode(',', array_fill(0, count($layerIds), '?'));
                    $stmt = $pdo->prepare("SELECT * FROM takeoff_count_markers WHERE layer_id IN ($inClause)");
                    $stmt->execute($layerIds);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $mk) {
                        unset($mk['id'], $mk['created_at'], $mk['updated_at']);
                        $mk['layer_id'] = $layerMap[(int) $mk['layer_id']] ?? $mk['layer_id'];
                        if (isset($mk['file_id']) && isset($fileMap[(int) $mk['file_id']]))
                            $mk['file_id'] = $fileMap[(int) $mk['file_id']];
                        if (isset($mk['drawing_id']) && isset($fileMap[(int) $mk['drawing_id']]))
                            $mk['drawing_id'] = $fileMap[(int) $mk['drawing_id']];
                        $cols = array_keys($mk);
                        $pdo->prepare("INSERT INTO takeoff_count_markers (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($mk));
                    }
                }
                if (self::tableExists($pdo, 'takeoff_linear_segments') && !empty($layerMap)) {
                    $layerIds = array_keys($layerMap);
                    $inClause = implode(',', array_fill(0, count($layerIds), '?'));
                    $stmt = $pdo->prepare("SELECT * FROM takeoff_linear_segments WHERE layer_id IN ($inClause)");
                    $stmt->execute($layerIds);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $sg) {
                        unset($sg['id'], $sg['created_at'], $sg['updated_at']);
                        $sg['layer_id'] = $layerMap[(int) $sg['layer_id']] ?? $sg['layer_id'];
                        if (isset($sg['file_id']) && isset($fileMap[(int) $sg['file_id']]))
                            $sg['file_id'] = $fileMap[(int) $sg['file_id']];
                        if (isset($sg['drawing_id']) && isset($fileMap[(int) $sg['drawing_id']]))
                            $sg['drawing_id'] = $fileMap[(int) $sg['drawing_id']];
                        $cols = array_keys($sg);
                        $pdo->prepare("INSERT INTO takeoff_linear_segments (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($sg));
                    }
                }
                if (self::tableExists($pdo, 'takeoff_sheet_scales')) {
                    $stmt = $pdo->prepare("SELECT * FROM takeoff_sheet_scales WHERE project_id = ?");
                    $stmt->execute([$sourceId]);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $sc) {
                        unset($sc['id'], $sc['created_at'], $sc['updated_at']);
                        $sc['project_id'] = $newId;
                        if (isset($sc['drawing_id']) && isset($fileMap[(int) $sc['drawing_id']]))
                            $sc['drawing_id'] = $fileMap[(int) $sc['drawing_id']];
                        $cols = array_keys($sc);
                        $pdo->prepare("INSERT INTO takeoff_sheet_scales (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($sc));
                    }
                }
                if (self::tableExists($pdo, 'drawing_scales')) {
                    $stmt = $pdo->prepare("SELECT * FROM drawing_scales WHERE project_id = ?");
                    $stmt->execute([$sourceId]);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $dsc) {
                        unset($dsc['id'], $dsc['created_at'], $dsc['updated_at']);
                        $dsc['project_id'] = $newId;
                        if (isset($dsc['drawing_id']) && isset($fileMap[(int) $dsc['drawing_id']]))
                            $dsc['drawing_id'] = $fileMap[(int) $dsc['drawing_id']];
                        $cols = array_keys($dsc);
                        $pdo->prepare("INSERT INTO drawing_scales (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($dsc));
                    }
                }
                if (self::tableExists($pdo, 'takeoff_estimate_states')) {
                    $stmt = $pdo->prepare("SELECT * FROM takeoff_estimate_states WHERE project_id = ?");
                    $stmt->execute([$sourceId]);
                    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $tes) {
                        unset($tes['created_at'], $tes['updated_at']);
                        $tes['project_id'] = $newId;
                        $oldKey = (string) ($tes['estimate_key'] ?? '');
                        if ($oldKey !== '' && isset($estimateClientKeyMap[$oldKey])) {
                            $tes['estimate_key'] = $estimateClientKeyMap[$oldKey];
                        }
                        if (isset($tes['drawing_id']) && isset($fileMap[(int) $tes['drawing_id']])) {
                            $tes['drawing_id'] = $fileMap[(int) $tes['drawing_id']];
                        }
                        $cols = array_keys($tes);
                        $pdo->prepare("INSERT INTO takeoff_estimate_states (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($tes));
                    }
                }
            }

            // Estimate Items (re-linking estimate_id and takeoff_layer_id)
            if (self::tableExists($pdo, 'estimate_items') && !empty($estimateMap)) {
                $estIds = array_keys($estimateMap);
                $inClause = implode(',', array_fill(0, count($estIds), '?'));
                $itemCols = self::tableColumns($pdo, 'estimate_items');
                $itemOrderBy = !empty($itemCols['sort_order']) ? 'ORDER BY sort_order ASC, id ASC' : 'ORDER BY id ASC';
                $stmt = $pdo->prepare("SELECT * FROM estimate_items WHERE estimate_id IN ($inClause) AND deleted_at IS NULL {$itemOrderBy}");
                $stmt->execute($estIds);
                $itemIdMap = [];
                $pendingParentLinks = [];
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $ei) {
                    $oldItemId = (int) $ei['id'];
                    $oldParentId = isset($ei['parent_estimate_item_id']) ? (int) $ei['parent_estimate_item_id'] : 0;
                    unset($ei['id'], $ei['created_at'], $ei['updated_at'], $ei['deleted_at']);
                    if (array_key_exists('project_id', $ei))
                        $ei['project_id'] = $newId;
                    if (isset($ei['estimate_id']) && isset($estimateMap[(int) $ei['estimate_id']])) {
                        $ei['estimate_id'] = $estimateMap[(int) $ei['estimate_id']];
                    }
                    if (isset($ei['takeoff_layer_id']) && isset($layerMap[(int) $ei['takeoff_layer_id']])) {
                        $ei['takeoff_layer_id'] = $layerMap[(int) $ei['takeoff_layer_id']];
                    } else {
                        $ei['takeoff_layer_id'] = null;
                    }
                    if (array_key_exists('takeoff_measurement_id', $ei)) {
                        $ei['takeoff_measurement_id'] = null;
                    }
                    if (array_key_exists('parent_estimate_item_id', $ei)) {
                        $ei['parent_estimate_item_id'] = null;
                    }
                    if ($resetQuantities) {
                        foreach (['quantity', 'material_cost', 'labor_cost', 'equipment_cost', 'subcontractor_cost', 'labor_hours', 'subtotal_cost', 'total_cost'] as $col) {
                            if (array_key_exists($col, $ei))
                                $ei[$col] = 0;
                        }
                    }
                    $cols = array_keys($ei);
                    $pdo->prepare("INSERT INTO estimate_items (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($ei));
                    $newItemId = (int) $pdo->lastInsertId();
                    $itemIdMap[$oldItemId] = $newItemId;
                    if ($oldParentId > 0) {
                        $pendingParentLinks[$newItemId] = $oldParentId;
                    }
                }
                if (isset($itemCols['parent_estimate_item_id']) && $pendingParentLinks !== []) {
                    $parentUpdate = $pdo->prepare('UPDATE estimate_items SET parent_estimate_item_id = ? WHERE id = ?');
                    foreach ($pendingParentLinks as $newItemId => $oldParentId) {
                        if (isset($itemIdMap[$oldParentId])) {
                            $parentUpdate->execute([$itemIdMap[$oldParentId], $newItemId]);
                        }
                    }
                }
            }

            // Ensure every item group from estimate_workspace_states has takeoff_layers if the source project had none
            if (empty($layerMap) && !empty($estimateMap)) {
                self::ensureTakeoffLayersFromWorkspace($pdo, $newId);
            }

            if (!$inTransaction)
                $pdo->commit();
        } catch (Throwable $e) {
            if (!$inTransaction && $pdo->inTransaction())
                $pdo->rollBack();
            error_log('Project template deep clone failed');
            throw new RuntimeException('Unable to clone the selected project template.', 0, $e);
        }
    }

    /**
     * Generates missing takeoff_layers for a project based on its primary/all estimate_workspace_states.
     */
    public static function ensureTakeoffLayersFromWorkspace(PDO $pdo, int $projectId, ?string $onlyClientEstId = null): void
    {
        if (!self::tableExists($pdo, 'estimate_workspace_states') || !self::tableExists($pdo, 'takeoff_layers') || !self::tableExists($pdo, 'takeoffs')) {
            return;
        }
        $tkStmt = $pdo->prepare("SELECT id FROM takeoffs WHERE project_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1");
        $tkStmt->execute([$projectId]);
        $takeoffId = (int) $tkStmt->fetchColumn();
        if ($takeoffId <= 0) {
            $pdo->prepare("INSERT INTO takeoffs (project_id, name, status) VALUES (?, 'Project Takeoff', 'draft')")->execute([$projectId]);
            $takeoffId = (int) $pdo->lastInsertId();
        }

        $sql = "SELECT estimate_id, client_estimate_id, state_json FROM estimate_workspace_states WHERE project_id = ?";
        $params = [$projectId];
        if ($onlyClientEstId !== null && $onlyClientEstId !== '') {
            $sql .= " AND client_estimate_id = ?";
            $params[] = $onlyClientEstId;
        }
        $wsStmt = $pdo->prepare($sql);
        $wsStmt->execute($params);

        $layerCols = self::tableColumns($pdo, 'takeoff_layers');
        $hasEstimateKey = isset($layerCols['estimate_key']);
        $palette = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#ea580c', '#4f46e5'];

        foreach ($wsStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $ws) {
            $cid = (string) $ws['client_estimate_id'];
            $decoded = self::decodeJson($ws['state_json'] ?? '');
            if (!$decoded || empty($decoded['groups']) || !is_array($decoded['groups']))
                continue;

            if ($hasEstimateKey) {
                $existsStmt = $pdo->prepare("SELECT COUNT(*) FROM takeoff_layers WHERE project_id = ? AND estimate_key = ? AND deleted_at IS NULL");
                $existsStmt->execute([$projectId, $cid]);
            } else {
                // Older deployments do not have estimate_key yet. Project scope is
                // the safest available deduplication boundary on that schema.
                $existsStmt = $pdo->prepare("SELECT COUNT(*) FROM takeoff_layers WHERE project_id = ? AND deleted_at IS NULL");
                $existsStmt->execute([$projectId]);
            }
            if ((int) $existsStmt->fetchColumn() > 0)
                continue;

            $sort = 0;
            $changedState = false;
            foreach ($decoded['groups'] as &$group) {
                if (!is_array($group))
                    continue;
                $groupName = trim((string) ($group['name'] ?? 'Default Group')) ?: 'Default Group';
                $groupId = (string) ($group['id'] ?? ($group['takeoffGroupId'] ?? self::uid('grp')));
                if (empty($group['takeoffGroupId'])) {
                    $group['takeoffGroupId'] = $groupId;
                    $changedState = true;
                }
                foreach (($group['items'] ?? []) as &$item) {
                    if (!is_array($item))
                        continue;
                    if (!empty($item['parentItemId']) || !empty($item['parent_item_id']) || !empty($item['assemblyParentId'])) {
                        continue;
                    }
                    $layerKey = trim((string) ($item['takeoffLayerId'] ?? ''));
                    if ($layerKey === '') {
                        $layerKey = self::uid('layer');
                        $item['takeoffLayerId'] = $layerKey;
                        $changedState = true;
                    }
                    if ((string) ($item['estimateId'] ?? '') !== $cid) {
                        $item['estimateId'] = $cid;
                        $changedState = true;
                    }
                    if ((string) ($item['projectId'] ?? '') !== (string) $projectId) {
                        $item['projectId'] = (string) $projectId;
                        $changedState = true;
                    }
                    $color = trim((string) ($item['color'] ?? $item['catalogMetadata']['takeoffDefaults']['color'] ?? ''));
                    if ($color === '')
                        $color = $palette[$sort % count($palette)];
                    $uom = trim((string) ($item['uom'] ?? 'ea')) ?: 'ea';
                    $type = self::inferTakeoffTypeFromItem($item);
                    $meta = [
                        'project_layer_id' => $layerKey,
                        'base_quantity' => 0,
                        'multiplier' => (float) ($item['multiplier'] ?? 1) ?: 1,
                        'estimate_id' => $cid,
                        'estimating_item_id' => (string) ($item['id'] ?? ''),
                        'estimating_group_id' => $groupId,
                        'unit_cost' => (float) ($item['unitCost'] ?? $item['unitMaterialCost'] ?? 0),
                        'unit_labor_time' => (float) ($item['unitLabor'] ?? 0),
                        'difficulty' => (float) ($item['difficulty'] ?? 1) ?: 1,
                        'cost_code' => (string) ($item['costCode'] ?? $item['budgetCode'] ?? ''),
                    ];
                    if (!empty($item['catalogItemId']))
                        $meta['catalog_item_id'] = $item['catalogItemId'];
                    if (!empty($item['catalogMetadata']))
                        $meta['catalog_item'] = $item['catalogMetadata'];
                    if (!empty($item['addedFromEstimating']) || !empty($item['quantityOverride'])) {
                        $meta['addedFromEstimating'] = true;
                    }

                    $row = [
                        'integration_key' => $layerKey,
                        'takeoff_id' => $takeoffId,
                        'drawing_id' => null,
                        'page_number' => 1,
                        'project_id' => $projectId,
                        'estimate_key' => $cid,
                        'group_name' => $groupName,
                        'name' => substr((string) ($item['name'] ?? 'Cost item'), 0, 191),
                        'type' => strtolower($type),
                        'layer_type' => in_array(strtolower($type), ['linear', 'area', 'count', 'volume'], true) ? strtolower($type) : 'mixed',
                        'takeoff_type' => $type,
                        'unit_of_measure' => $uom,
                        'catalog_item_id' => !empty($item['catalogItemId']) && is_numeric($item['catalogItemId']) ? (int) $item['catalogItemId'] : null,
                        'assembly_id' => null,
                        'assembly_catalog_item_id' => !empty($item['isAssembly']) && !empty($item['catalogItemId']) && is_numeric($item['catalogItemId']) ? (int) $item['catalogItemId'] : null,
                        'color' => $color,
                        'symbol' => 'Solid Circle',
                        'tag' => !empty($item['tag']) ? substr((string) $item['tag'], 0, 100) : null,
                        'symbol_size' => 'Medium',
                        'quantity' => 0,
                        'visible' => 1,
                        'locked' => 0,
                        'sort_order' => $sort++,
                        'metadata_json' => json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    ];
                    $filtered = array_filter($row, function ($k) use ($layerCols) {
                        return isset($layerCols[$k]);
                    }, ARRAY_FILTER_USE_KEY);
                    $cols = array_keys($filtered);
                    $pdo->prepare("INSERT INTO takeoff_layers (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($filtered));
                }
                unset($item);
            }
            unset($group);

            if ($changedState) {
                $enc = json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                if ($enc !== false) {
                    $pdo->prepare("UPDATE estimate_workspace_states SET state_json = ? WHERE estimate_id = ?")->execute([$enc, (int) $ws['estimate_id']]);
                }
            }
        }
    }

    public static function inferTakeoffTypeFromItem(array $item): string
    {
        $raw = strtolower(trim((string) ($item['type'] ?? $item['itemType'] ?? $item['catalogMetadata']['type'] ?? '')));
        if (str_contains($raw, 'linear avg'))
            return 'Linear avg. with drop';
        if (str_contains($raw, 'linear with drop'))
            return 'Linear with drop';
        if (str_contains($raw, 'count by distance'))
            return 'Count by distance';
        if (str_contains($raw, 'linear'))
            return 'Linear';
        if (str_contains($raw, 'area') || str_contains($raw, 'volume'))
            return 'Area / Volume';
        $uom = strtolower(trim((string) ($item['uom'] ?? 'ea')));
        if (in_array($uom, ['ft', 'lf', 'linear ft', 'linear feet', 'm', 'lm'], true))
            return 'Linear';
        if (in_array($uom, ['sq ft', 'sf', 'sqft', 'ft2', 'm2', 'sqm'], true))
            return 'Area / Volume';
        return 'Count';
    }

    public static function syncPrimaryEstimateMetadata(PDO $pdo, int $projectId, bool $resetTotal = false): void
    {
        if ($projectId <= 0 || !self::tableExists($pdo, 'projects') || !self::tableExists($pdo, 'estimates')) {
            return;
        }
        $pStmt = $pdo->prepare("SELECT metadata_json FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $pStmt->execute([$projectId]);
        $rawMeta = $pStmt->fetchColumn();
        if ($rawMeta === false)
            return;
        $meta = self::decodeJson(is_string($rawMeta) ? $rawMeta : null);

        $rows = [];
        if (self::tableExists($pdo, 'estimate_workspace_states')) {
            $stmt = $pdo->prepare(
                "SELECT e.id, e.total_cost, ws.client_estimate_id, ws.state_json
                 FROM estimates e
                 LEFT JOIN estimate_workspace_states ws ON ws.estimate_id = e.id
                 WHERE e.project_id = ? AND e.deleted_at IS NULL
                 ORDER BY e.id ASC"
            );
            $stmt->execute([$projectId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        }
        if (!$rows) {
            return;
        }

        $chosen = null;
        foreach ($rows as $r) {
            $snap = self::decodeJson((string) ($r['state_json'] ?? ''));
            if (!empty($snap['isPrimary']) || !empty($snap['is_primary'])) {
                $chosen = $r;
                break;
            }
        }
        if (!$chosen) {
            $chosen = $rows[0];
            $snap = self::decodeJson((string) ($chosen['state_json'] ?? ''));
            if ($snap) {
                $snap['isPrimary'] = true;
                $snap['is_primary'] = true;
                if (count($rows) === 1) {
                    $snap['isActive'] = true;
                }
                $enc = json_encode($snap, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                if ($enc !== false) {
                    $pdo->prepare("UPDATE estimate_workspace_states SET state_json = ? WHERE estimate_id = ?")
                        ->execute([$enc, (int) $chosen['id']]);
                }
            }
        }

        $chosenCid = !empty($chosen['client_estimate_id']) ? (string) $chosen['client_estimate_id'] : (string) $chosen['id'];
        $chosenSnap = self::decodeJson((string) ($chosen['state_json'] ?? ''));
        $total = $resetTotal ? 0.0 : (float) ($chosenSnap['estimateTotal'] ?? $chosenSnap['totalSales'] ?? $chosen['total_cost'] ?? 0);

        $meta['primary_estimate_id'] = $chosenCid;
        $meta['primary_estimate_total'] = $total;
        $meta['primary_quote_value'] = $total;
        $meta['total_sales'] = $total;
        $meta['estimate_total'] = $total;
        $meta['primary_estimate_updated_at'] = gmdate('c');

        $encodedMeta = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encodedMeta !== false) {
            $pdo->prepare("UPDATE projects SET metadata_json = ? WHERE id = ?")->execute([$encodedMeta, $projectId]);
        }
    }

    public static function instantiateTemplateIntoProject(PDO $pdo, int $templateId, int $newProjectId, string $projectName = ''): bool
    {
        [$sourcePid,] = self::resolveTemplateSource($pdo, $templateId);
        if ($sourcePid <= 0 || $sourcePid === $newProjectId) {
            throw new RuntimeException('Selected template does not have a valid workspace source.');
        }

        $sourceEstimateStmt = $pdo->prepare('SELECT COUNT(*) FROM estimates WHERE project_id = ? AND deleted_at IS NULL');
        $sourceEstimateStmt->execute([$sourcePid]);
        $sourceEstimateCount = (int) $sourceEstimateStmt->fetchColumn();
        if ($sourceEstimateCount <= 0) {
            throw new RuntimeException('Selected template does not contain an estimate to copy.');
        }

        self::deepCloneProjectWorkspace($pdo, $sourcePid, $newProjectId, [
            'includeDocuments' => false,
            'resetQuantities' => true,
        ]);

        $targetEstimateStmt = $pdo->prepare('SELECT COUNT(*) FROM estimates WHERE project_id = ? AND deleted_at IS NULL');
        $targetEstimateStmt->execute([$newProjectId]);
        if ((int) $targetEstimateStmt->fetchColumn() < $sourceEstimateCount) {
            throw new RuntimeException('The selected template workspace was not copied completely.');
        }
        if ($projectName !== '') {
            $pdo->prepare("UPDATE estimates SET name = ? WHERE project_id = ? AND deleted_at IS NULL")->execute([$projectName . ' Estimate', $newProjectId]);
        }
        self::syncPrimaryEstimateMetadata($pdo, $newProjectId, true);
        return true;
    }

    public static function convertProjectToTemplate(PDO $pdo, int $sourceProjectId, ?string $templateName = null): array
    {
        $stmt = $pdo->prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $stmt->execute([$sourceProjectId]);
        $source = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$source) {
            throw new RuntimeException('Source project not found');
        }

        $baseName = trim((string) ($templateName ?? ''));
        if ($baseName === '') {
            $orig = trim((string) ($source['name'] ?? 'Project Template'));
            $baseName = preg_match('/template$/i', $orig) ? $orig : ($orig . ' Template');
        }

        $inTx = $pdo->inTransaction();
        if (!$inTx)
            $pdo->beginTransaction();
        try {
            $copy = $source;
            unset($copy['id'], $copy['created_at'], $copy['updated_at'], $copy['deleted_at']);
            $copy['name'] = substr($baseName, 0, 191);
            $copy['status'] = 'templates';
            $copy['project_number'] = null;
            $meta = self::decodeJson($copy['metadata_json'] ?? null);
            $meta['is_template'] = true;
            $meta['converted_from_project_id'] = $sourceProjectId;
            $copy['metadata_json'] = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

            $cols = array_keys($copy);
            $pdo->prepare("INSERT INTO projects (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($copy));
            $newProjectId = (int) $pdo->lastInsertId();

            self::deepCloneProjectWorkspace($pdo, $sourceProjectId, $newProjectId, [
                'includeDocuments' => false,
                'resetQuantities' => true,
            ]);
            self::resetProjectQuantitiesToZero($pdo, $newProjectId);
            self::syncPrimaryEstimateMetadata($pdo, $newProjectId, true);

            $tplId = self::upsertTemplateEntryForProject($pdo, $newProjectId, $copy['name'], $copy['description'] ?? null);
            if ($tplId > 0) {
                $pdo->prepare("UPDATE projects SET project_template_id = ? WHERE id = ?")->execute([$tplId, $newProjectId]);
            }

            if (!$inTx)
                $pdo->commit();
            return [
                'project_id' => $newProjectId,
                'template_id' => $tplId,
                'name' => $copy['name'],
                'status' => 'templates',
            ];
        } catch (Throwable $e) {
            if (!$inTx && $pdo->inTransaction())
                $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Applies a template onto an existing project by creating a NEW estimate prefixed with TMPLT_
     * and cloning the template's groups, items, assemblies, settings, and takeoff layers (qty = 0).
     */
    public static function applyTemplateToProject(PDO $pdo, int $targetProjectId, int $templateId): array
    {
        [$sourceProjectId, $tplName] = self::resolveTemplateSource($pdo, $templateId);
        if ($sourceProjectId <= 0) {
            throw new RuntimeException('Selected template does not have a valid workspace source.');
        }

        $targetStmt = $pdo->prepare("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1");
        $targetStmt->execute([$targetProjectId]);
        if (!$targetStmt->fetchColumn()) {
            throw new RuntimeException('Target project not found');
        }

        // Load primary (or first) estimate of source template
        $srcEstStmt = $pdo->prepare(
            "SELECT e.*, ws.client_estimate_id, ws.state_json
             FROM estimates e
             LEFT JOIN estimate_workspace_states ws ON ws.estimate_id = e.id
             WHERE e.project_id = ? AND e.deleted_at IS NULL
             ORDER BY e.id ASC"
        );
        $srcEstStmt->execute([$sourceProjectId]);
        $srcEstimates = $srcEstStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $srcEst = $srcEstimates[0] ?? null;
        foreach ($srcEstimates as $cand) {
            $snap = self::decodeJson($cand['state_json'] ?? '');
            if (!empty($snap['isPrimary']) || !empty($snap['is_primary'])) {
                $srcEst = $cand;
                break;
            }
        }

        $cleanName = trim((string) $tplName);
        if ($cleanName === '')
            $cleanName = 'Template';
        $estimateName = str_starts_with($cleanName, 'TMPLT_') ? $cleanName : ('TMPLT_' . $cleanName);
        $estimateName = substr($estimateName, 0, 191);
        $newClientEstimateId = 'estimate_' . substr(md5($targetProjectId . '_' . $templateId . '_' . uniqid('', true)), 0, 14);

        $inTx = $pdo->inTransaction();
        if (!$inTx)
            $pdo->beginTransaction();
        try {
            $estCols = self::tableColumns($pdo, 'estimates');
            $estInsert = [
                'project_id' => $targetProjectId,
                'name' => $estimateName,
                'description' => 'Applied from template: ' . $cleanName,
                'status' => 'draft',
                'currency_code' => 'USD',
                'settings_json' => $srcEst['settings_json'] ?? json_encode(self::defaultEstimateSettings($pdo), JSON_UNESCAPED_SLASHES),
                'notes_json' => $srcEst['notes_json'] ?? json_encode(['scope' => '', 'included' => [], 'excluded' => []], JSON_UNESCAPED_SLASHES),
                'subtotal_cost' => 0,
                'markup_total' => 0,
                'tax_total' => 0,
                'total_cost' => 0,
                'labor_hours_total' => 0,
                'metadata_json' => json_encode(['applied_template_id' => $templateId, 'source_template_project_id' => $sourceProjectId], JSON_UNESCAPED_SLASHES),
            ];
            $estFiltered = array_filter($estInsert, fn($k) => isset($estCols[$k]), ARRAY_FILTER_USE_KEY);
            $cols = array_keys($estFiltered);
            $pdo->prepare("INSERT INTO estimates (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute(array_values($estFiltered));
            $newEstId = (int) $pdo->lastInsertId();

            // Build fresh workspace state with new group/item/layer IDs & 0 quantities
            $srcState = self::decodeJson($srcEst['state_json'] ?? '');
            if (!$srcState) {
                $srcState = [
                    'groups' => [],
                    'notes' => ['scope' => '', 'included' => [], 'excluded' => []],
                    'settings' => self::defaultEstimateSettings($pdo),
                ];
            }
            // Carry over project-level estimatingTableSettings if source project has them
            try {
                $srcProjMetaStmt = $pdo->prepare("SELECT metadata_json FROM projects WHERE id = ? LIMIT 1");
                $srcProjMetaStmt->execute([$sourceProjectId]);
                $srcProjMeta = self::decodeJson($srcProjMetaStmt->fetchColumn() ?: null);
                $tblSettings = is_array($srcProjMeta['estimatingTableSettings'] ?? null) ? $srcProjMeta['estimatingTableSettings'] : null;
                if ($tblSettings) {
                    if (!isset($srcState['settings']) || !is_array($srcState['settings'])) {
                        $srcState['settings'] = self::defaultEstimateSettings($pdo);
                    }
                    if (
                        !empty($tblSettings['visibleColumns']) && is_array($tblSettings['visibleColumns'])
                        && (empty($srcState['settings']['visibleColumns']) || !empty($tblSettings['applyAll']))
                    ) {
                        $srcState['settings']['visibleColumns'] = array_values(array_map('strval', $tblSettings['visibleColumns']));
                    }
                    if (
                        !empty($tblSettings['columnsOrder']) && is_array($tblSettings['columnsOrder'])
                        && (empty($srcState['settings']['columnsOrder']) || !empty($tblSettings['applyAll']))
                    ) {
                        $srcState['settings']['columnsOrder'] = array_values(array_map('strval', $tblSettings['columnsOrder']));
                    }
                    if (isset($estCols['settings_json'])) {
                        $pdo->prepare("UPDATE estimates SET settings_json = ? WHERE id = ?")
                            ->execute([json_encode($srcState['settings'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $newEstId]);
                    }
                }
            } catch (Throwable $e) {
            }

            $srcClientKey = (string) ($srcEst['client_estimate_id'] ?? '');
            $tkStmt = $pdo->prepare("SELECT * FROM takeoff_layers WHERE project_id = ? AND deleted_at IS NULL" . ($srcClientKey !== '' ? " AND (estimate_key = ? OR estimate_key IS NULL OR estimate_key = '')" : "") . " ORDER BY sort_order ASC, id ASC");
            $tkStmt->execute($srcClientKey !== '' ? [$sourceProjectId, $srcClientKey] : [$sourceProjectId]);
            $srcLayers = $tkStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $srcLayerByKey = [];
            foreach ($srcLayers as $sl) {
                $ik = (string) ($sl['integration_key'] ?? '');
                $metaTmp = self::decodeJson($sl['metadata_json'] ?? null);
                $plk = (string) ($metaTmp['project_layer_id'] ?? '');
                if ($ik !== '' && !isset($srcLayerByKey[$ik]))
                    $srcLayerByKey[$ik] = $sl;
                if ($plk !== '' && !isset($srcLayerByKey[$plk]))
                    $srcLayerByKey[$plk] = $sl;
            }

            $layerUidRemap = [];
            $layerMetaLinks = [];
            $orderedSrcLayerPlan = [];
            $newGroups = [];
            foreach (($srcState['groups'] ?? []) as $grp) {
                if (!is_array($grp))
                    continue;
                $newGrpId = self::uid('estgrp');
                $newTkGrpId = 'takeoff_group_' . self::uid('grp');
                $grpName = trim((string) ($grp['name'] ?? '')) ?: 'Default Group';
                $newItems = [];
                foreach (($grp['items'] ?? []) as $it) {
                    if (!is_array($it))
                        continue;
                    $newItId = self::uid('estitem');
                    $oldLayerUid = (string) ($it['takeoffLayerId'] ?? '');
                    $newLayerUid = self::uid('layer');
                    $isChildItem = !empty($it['parentItemId']) || !empty($it['parent_item_id']) || !empty($it['assemblyParentId']);
                    if ($oldLayerUid !== '') {
                        $layerUidRemap[$oldLayerUid] = $newLayerUid;
                        if (!$isChildItem) {
                            $orderedSrcLayerPlan[] = [
                                'oldKey' => $oldLayerUid,
                                'newKey' => $newLayerUid,
                                'groupName' => $grpName,
                            ];
                        }
                    }
                    $layerMetaLinks[$newLayerUid] = [
                        'estimating_group_id' => $newGrpId,
                        'estimating_item_id' => $newItId,
                    ];
                    $it['id'] = $newItId;
                    $it['groupId'] = $newGrpId;
                    $it['estimateId'] = $newClientEstimateId;
                    $it['projectId'] = (string) $targetProjectId;
                    $it['takeoffLayerId'] = $newLayerUid;
                    $it['estimatingItemId'] = $newItId;
                    if (!empty($it['children']) && is_array($it['children'])) {
                        $it['children'] = self::remapChildEstimateIds($it['children'], $newItId, $newClientEstimateId, $targetProjectId);
                    }
                    $newItems[] = $it;
                }
                $grp['id'] = $newGrpId;
                $grp['takeoffGroupId'] = $newTkGrpId;
                $grp['estimateId'] = $newClientEstimateId;
                $grp['items'] = $newItems;
                $newGroups[] = $grp;
            }

            $existingEstStmt = $pdo->prepare(
                "SELECT e.id, ws.state_json
                 FROM estimates e
                 LEFT JOIN estimate_workspace_states ws ON ws.estimate_id = e.id
                 WHERE e.project_id = ? AND e.id <> ? AND e.deleted_at IS NULL"
            );
            $existingEstStmt->execute([$targetProjectId, $newEstId]);
            $otherEstimates = $existingEstStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $targetHasPrimary = false;
            foreach ($otherEstimates as $oe) {
                $oeSnap = self::decodeJson((string) ($oe['state_json'] ?? ''));
                if (!empty($oeSnap['isPrimary']) || !empty($oeSnap['is_primary'])) {
                    $targetHasPrimary = true;
                    break;
                }
            }
            $makeThisPrimary = count($otherEstimates) === 0 || !$targetHasPrimary;

            $srcState['groups'] = $newGroups;
            $srcState['name'] = $estimateName;
            $srcState['status'] = 'draft';
            $srcState['isActive'] = count($otherEstimates) === 0;
            $srcState['isPrimary'] = $makeThisPrimary;
            $srcState['is_primary'] = $makeThisPrimary;
            $srcState['creationMode'] = 'template';
            $srcState['createdAt'] = gmdate('c');
            $srcState['updatedAt'] = gmdate('c');
            $srcState = self::zeroWorkspaceData($srcState, $targetProjectId, $newClientEstimateId, $newEstId);

            if (self::tableExists($pdo, 'estimate_workspace_states')) {
                $encodedWs = json_encode($srcState, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                $pdo->prepare("INSERT INTO estimate_workspace_states (estimate_id, project_id, client_estimate_id, state_json, revision) VALUES (?, ?, ?, ?, 1)")
                    ->execute([$newEstId, $targetProjectId, $newClientEstimateId, $encodedWs]);
            }

            // Copy estimate_markups from source estimate
            if ($srcEst && self::tableExists($pdo, 'estimate_markups')) {
                $mkpStmt = $pdo->prepare("SELECT * FROM estimate_markups WHERE estimate_id = ?");
                $mkpStmt->execute([(int) $srcEst['id']]);
                foreach ($mkpStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $mkp) {
                    unset($mkp['id'], $mkp['created_at'], $mkp['updated_at']);
                    $mkp['estimate_id'] = $newEstId;
                    $mCols = array_keys($mkp);
                    $pdo->prepare("INSERT INTO estimate_markups (" . implode(', ', $mCols) . ") VALUES (" . implode(', ', array_fill(0, count($mCols), '?')) . ")")->execute(array_values($mkp));
                }
            }

            // Insert remapped takeoff_layers for the new TMPLT_ estimate (or generate from workspace)
            if (!empty($srcLayerByKey) && self::tableExists($pdo, 'takeoff_layers') && self::tableExists($pdo, 'takeoffs')) {
                $tkRowStmt = $pdo->prepare("SELECT id FROM takeoffs WHERE project_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1");
                $tkRowStmt->execute([$targetProjectId]);
                $targetTakeoffId = (int) $tkRowStmt->fetchColumn();
                if ($targetTakeoffId <= 0) {
                    $pdo->prepare("INSERT INTO takeoffs (project_id, name, status) VALUES (?, 'Project Takeoff', 'draft')")->execute([$targetProjectId]);
                    $targetTakeoffId = (int) $pdo->lastInsertId();
                }
                $insertLayerRow = function (array $sl, string $newKey, ?string $groupNameOverride, int $sortOrder) use ($pdo, $targetProjectId, $targetTakeoffId, $newClientEstimateId, $layerMetaLinks): void {
                    unset($sl['id'], $sl['created_at'], $sl['updated_at'], $sl['deleted_at']);
                    $sl['project_id'] = $targetProjectId;
                    $sl['takeoff_id'] = $targetTakeoffId;
                    $sl['drawing_id'] = null;
                    $sl['estimate_key'] = $newClientEstimateId;
                    $sl['integration_key'] = $newKey;
                    $sl['quantity'] = 0;
                    $sl['estimate_item_id'] = null;
                    $sl['sort_order'] = $sortOrder;
                    if ($groupNameOverride !== null && $groupNameOverride !== '') {
                        $sl['group_name'] = $groupNameOverride;
                    }
                    $meta = self::decodeJson($sl['metadata_json'] ?? null);
                    $meta['project_layer_id'] = $newKey;
                    $meta['estimate_id'] = $newClientEstimateId;
                    $meta['base_quantity'] = 0;
                    if (isset($layerMetaLinks[$newKey])) {
                        $meta['estimating_group_id'] = $layerMetaLinks[$newKey]['estimating_group_id'];
                        $meta['estimating_item_id'] = $layerMetaLinks[$newKey]['estimating_item_id'];
                    }
                    unset($meta['file_drawing_id']);
                    $sl['metadata_json'] = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                    $lCols = array_keys($sl);
                    $pdo->prepare("INSERT INTO takeoff_layers (" . implode(', ', $lCols) . ") VALUES (" . implode(', ', array_fill(0, count($lCols), '?')) . ")")->execute(array_values($sl));
                };
                $emittedSourceIds = [];
                $nextSortOrder = 0;
                foreach ($orderedSrcLayerPlan as $planRow) {
                    $oldKey = $planRow['oldKey'];
                    if (!isset($srcLayerByKey[$oldKey]))
                        continue;
                    $sl = $srcLayerByKey[$oldKey];
                    $srcIdMark = (int) ($sl['id'] ?? 0);
                    if ($srcIdMark > 0) {
                        if (isset($emittedSourceIds[$srcIdMark]))
                            continue;
                        $emittedSourceIds[$srcIdMark] = true;
                    }
                    $insertLayerRow($sl, $planRow['newKey'], $planRow['groupName'], $nextSortOrder++);
                }
                foreach ($srcLayers as $sl) {
                    $srcIdMark = (int) ($sl['id'] ?? 0);
                    if ($srcIdMark > 0 && isset($emittedSourceIds[$srcIdMark]))
                        continue;
                    if ($srcIdMark > 0)
                        $emittedSourceIds[$srcIdMark] = true;
                    $oldKey = (string) ($sl['integration_key'] ?? '');
                    $newKey = ($oldKey !== '' && isset($layerUidRemap[$oldKey])) ? $layerUidRemap[$oldKey] : self::uid('layer');
                    $insertLayerRow($sl, $newKey, null, $nextSortOrder++);
                }
            }
            self::ensureTakeoffLayersFromWorkspace($pdo, $targetProjectId, $newClientEstimateId);
            if ($makeThisPrimary) {
                self::syncPrimaryEstimateMetadata($pdo, $targetProjectId, true);
            }

            if (!$inTx)
                $pdo->commit();
            return [
                'estimate_id' => $newEstId,
                'client_estimate_id' => $newClientEstimateId,
                'name' => $estimateName,
                'template_id' => $templateId,
                'source_project_id' => $sourceProjectId,
            ];
        } catch (Throwable $e) {
            if (!$inTx && $pdo->inTransaction())
                $pdo->rollBack();
            throw $e;
        }
    }

    private static function remapChildEstimateIds(array $children, string $parentId, string $estClientId, int $projectId): array
    {
        $out = [];
        foreach ($children as $ch) {
            if (!is_array($ch))
                continue;
            $newChId = self::uid('estchild');
            $ch['id'] = $newChId;
            $ch['parentItemId'] = $parentId;
            $ch['estimateId'] = $estClientId;
            $ch['projectId'] = (string) $projectId;
            $ch['quantity'] = 0;
            $ch['originalQuantity'] = 0;
            if (!empty($ch['children']) && is_array($ch['children'])) {
                $ch['children'] = self::remapChildEstimateIds($ch['children'], $newChId, $estClientId, $projectId);
            }
            $out[] = $ch;
        }
        return $out;
    }
}
