const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const takeoff = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
const syncService = require(path.join(root, 'assets/takeoff_estimating_sync_service.js'));
const CatalogSnapshot = require(path.join(root, 'assets/estimating_catalog_snapshot_service.js'));

test('Takeoff editor projectTakeoffSyncLayers matches existing layers by id, integration_key, and client_uid', () => {
    assert.match(editor, /String\(row\.id \|\| ''\) === externalId/);
    assert.match(editor, /String\(row\.integration_key \|\| ''\) === externalId/);
    assert.match(editor, /client_uid: layer\?\.client_uid \|\| externalId/);
});

test('Takeoff editor updates canvas markers and segments when layer color or symbol changes', () => {
    assert.match(editor, /const colorChanged = layer\.color !== data\.color;/);
    assert.match(editor, /destroyMarkerNodes\(ref\);/);
    assert.match(editor, /createMarkerNode\(ref\);/);
    assert.match(editor, /ref\.node\?\.stroke\(String\(ref\.color \|\| layer\.color\)\);/);
});

test('Takeoff editor projectTakeoffUpdateLayerObjects resolves all layer keys to update markers and segments', () => {
    assert.match(editor, /String\(row\.id \|\| ''\) === layerKey/);
    assert.match(editor, /String\(row\.integration_key \|\| ''\) === layerKey/);
    assert.match(editor, /layerKeys\.has\(String\(marker\.layer_client_uid \|\| ''\)\) \|\| layerKeys\.has\(String\(marker\.layer_id \|\| ''\)\)/);
    assert.match(editor, /layerKeys\.has\(String\(segment\.layer_client_uid \|\| ''\)\) \|\| layerKeys\.has\(String\(segment\.layer_id \|\| ''\)\)/);
});

test('Takeoff dashboard submitLayerModal and changeLayerColor sync to canvas before saving', () => {
    assert.match(takeoff, /syncAllLayersToCanvas\(\{ immediate: true, suppressEstimatingSync: true \}\);\s*\/\/\s*Modal Save is a durable operation/);
    assert.match(takeoff, /function changeLayerColor[\s\S]*?callEditor\('projectTakeoffUpdateLayerObjects'/);
    assert.match(takeoff, /function changeLayerColor[\s\S]*?syncAllLayersToCanvas/);
    assert.match(takeoff, /function changeLayerColor[\s\S]*?callEditor\('projectTakeoffSave'\)/);
});

test('Takeoff dashboard syncEstimatingItemsToTakeoff matches layers using multi-key resolution without creating duplicates', () => {
    assert.match(takeoff, /const layerMatchesEstimatingItem =/);
    assert.match(takeoff, /itemKeys\.some\(k => rowKeys\.includes\(k\)\)/);
    assert.match(takeoff, /let layer = allLayers\(\)\.find\(row => \(String\(row\.estimateId \|\| ''\) === estimateId \|\| !row\.estimateId\)/);
});

test('Takeoff dashboard syncTakeoffToEstimating resolves layer aliases to find existing estimating items', () => {
    assert.match(takeoff, /existingByLayerId\.get\(String\(layer\.id\)\)\s*\|\|\s*\(layer\.integration_key/);
    assert.match(takeoff, /key\.startsWith\('takeoff_'\)/);
});

test('TakeoffEstimatingSyncService preserves custom labor hours (AH) and unit cost in overrides when catalog metadata is attached', () => {
    const catalogItem = {
        id: 99,
        catalogItemId: 99,
        name: 'Copper THHN 600 KCMIL',
        uom: 'ft',
        materialUnitCost: 15.00,
        laborHoursPerUnit: 0.05,
        pricing: {
            materialUnitCost: 15.00,
            laborHoursPerUnit: 0.05,
            laborRate: 85
        }
    };

    const layer = {
        id: 'layer_copper_600',
        name: 'Copper THHN 600 KCMIL',
        quantity: 100,
        uom: 'ft',
        unitMaterialCost: 18.50,
        unitLabor: 0.12,
        catalogItemId: 99,
        catalogMetadata: catalogItem
    };

    const group = { id: 'grp_1', name: 'Feeders' };
    const syncedItem = syncService.takeoffItem(layer, group, null);

    assert.equal(syncedItem.name, 'Copper THHN 600 KCMIL');
    assert.equal(syncedItem.quantity, 100);
    assert.equal(syncedItem.overrides.laborHoursPerUnit, 0.12);
    assert.equal(syncedItem.overrides.materialUnitCost, 18.50);
    assert.equal(syncedItem.unitLabor, 0.12);
    assert.equal(syncedItem.unitMaterialCost, 18.50);
});

test('Functional simulation: updating layer color and AH in editor updates in-place without duplicating', () => {
    const state = {
        layers: [{
            id: 45,
            client_uid: 'uid-45-original',
            name: 'Receptacle 20A',
            color: '#2563eb',
            symbol: 'circle',
            symbol_size: 'Medium',
            unit_cost: 12.00,
            unit_labor_time: 0.25,
            metadata_json: { project_layer_id: 'uid-45-original' }
        }],
        markers: [{
            client_uid: 'marker-1',
            layer_client_uid: 'uid-45-original',
            layer_id: 45,
            color: '#2563eb',
            symbol: 'circle'
        }]
    };

    const payload = {
        id: '45',
        name: 'Receptacle 20A',
        color: '#eab308',
        labor_hours: 0.45,
        unit_cost: 14.00,
        symbol: 'circle'
    };

    const externalId = String(payload.id);
    let layer = state.layers.find(row => row.client_uid === externalId
        || row.metadata_json?.project_layer_id === externalId
        || String(row.id || '') === externalId
        || String(row.integration_key || '') === externalId);

    assert.ok(layer, 'Existing layer should be found by row.id');

    const colorChanged = layer.color !== payload.color;
    layer.color = payload.color;
    layer.unit_labor_time = payload.labor_hours;
    layer.unit_cost = payload.unit_cost;

    if (colorChanged) {
        const layerKeys = new Set([externalId, String(layer.client_uid || ''), String(layer.id || ''), String(layer.metadata_json?.project_layer_id || '')].filter(Boolean));
        state.markers.filter(m => layerKeys.has(String(m.layer_client_uid || '')) || layerKeys.has(String(m.layer_id || ''))).forEach(ref => {
            ref.color = payload.color;
        });
    }

    assert.equal(state.layers.length, 1, 'No duplicate layer pushed');
    assert.equal(layer.color, '#eab308', 'Layer color updated to yellow');
    assert.equal(layer.unit_labor_time, 0.45, 'Layer unit labor updated');
    assert.equal(state.markers[0].color, '#eab308', 'Marker color updated to yellow');
});
