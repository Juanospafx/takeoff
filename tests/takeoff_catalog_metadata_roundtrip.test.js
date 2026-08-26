const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Contract = require('../assets/catalog_item_contract.js');
const Metadata = require('../assets/catalog_metadata.js');
const Adapter = require('../assets/takeoff_catalog_adapter.js');

function metadataFor(raw, assemblyParts = []) {
    const dto = Contract.normalizeCatalogItem(raw, { assemblyParts });
    return { dto, legacy: Adapter.catalogItemDtoToLegacyLayerMeta(dto) };
}

function roundTrip(legacy) {
    const dashboardLayer = Metadata.attach({ id: 'layer-1', metadata_json: legacy.metadata_json }, legacy.catalogMetadata);
    const editorMetadata = Metadata.mergeMetadata({}, dashboardLayer.catalogMetadata, { project_layer_id: 'layer-1' });
    const editorLayer = { client_uid: 'layer-1', metadata_json: editorMetadata };
    const projectPayload = { id: 'layer-1', catalogMetadata: Metadata.fromLayer(editorLayer) };
    const persisted = JSON.parse(JSON.stringify({ metadata_json: editorLayer.metadata_json }));
    const reloadedEditor = Metadata.attach({ id: 'db-1', metadata_json: persisted.metadata_json });
    const dashboardReturn = Metadata.attach({ id: projectPayload.id }, Metadata.fromLayer(reloadedEditor));
    return { dashboardLayer, editorLayer, projectPayload, persisted, dashboardReturn };
}

test('PART metadata and revision survive dashboard-editor-API-dashboard', () => {
    const { legacy } = metadataFor({ id: 1, revision: 7, item_type: 'part', unit_cost: 10 });
    const result = roundTrip(legacy);
    assert.equal(result.dashboardReturn.catalogMetadata.catalogRevision, 7);
    assert.equal(result.dashboardReturn.catalogMetadata.pricing.materialUnitCost, 10);
});

test('EQUIPMENT and LABOR canonical pricing survive the round-trip', () => {
    const equipment = roundTrip(metadataFor({ id: 2, item_type: 'equipment', unit_cost: 100 }).legacy);
    const labor = roundTrip(metadataFor({ id: 3, item_type: 'labor', labor_rate: 45 }).legacy);
    assert.equal(equipment.dashboardReturn.catalogMetadata.type, 'EQUIPMENT');
    assert.equal(equipment.dashboardReturn.catalogMetadata.pricing.equipmentUnitCost, 100);
    assert.equal(labor.dashboardReturn.catalogMetadata.type, 'LABOR');
    assert.equal(labor.dashboardReturn.catalogMetadata.pricing.laborRate, 45);
});

test('ASSEMBLY components preserve every canonical component property', () => {
    const parts = [
        { id: 10, assembly_catalog_item_id: 4, part_catalog_item_id: 5, quantity: 2,
            ratio_type: 'spacing_based', spacing_value: 12, waste_factor_percent: 5,
            unit_cost_snapshot: 8, unit_labor_time_snapshot: 0.25, overrides: { note: 'first' } },
        { id: 11, assembly_catalog_item_id: 4, part_catalog_item_id: 6, quantity: 3 }
    ];
    const result = roundTrip(metadataFor({ id: 4, item_type: 'assembly' }, parts).legacy);
    const components = result.dashboardReturn.catalogMetadata.assemblyComponents;
    assert.equal(components.length, 2);
    assert.deepEqual(components[0], {
        id: '10', catalogItemId: '5', quantity: 2, ratioType: 'spacing_based', spacing: 12, waste: 5,
        pricingSnapshot: { materialUnitCost: 8, equipmentUnitCost: 0, subcontractorUnitCost: 0,
            laborHoursPerUnit: 0.25, laborRate: 0 },
        overrides: { note: 'first' }
    });
});

test('legacy layers remain valid and metadata clones do not share mutable references', () => {
    const legacyLayer = { id: 'legacy', unit_cost: 5, metadata_json: { project_layer_id: 'legacy' } };
    assert.equal(Metadata.fromLayer(legacyLayer), null);
    assert.deepEqual(Metadata.attach(legacyLayer).metadata_json, { project_layer_id: 'legacy' });

    const source = metadataFor({ id: 2, item_type: 'equipment', unit_cost: 100 }).legacy;
    const result = roundTrip(source);
    result.editorLayer.metadata_json.catalog_item.pricing.equipmentUnitCost = 999;
    assert.equal(source.catalogMetadata.pricing.equipmentUnitCost, 100);
    assert.equal(result.dashboardLayer.catalogMetadata.pricing.equipmentUnitCost, 100);
});

test('all Takeoff transport whitelists explicitly preserve catalogMetadata', () => {
    const root = path.resolve(__dirname, '..');
    const parent = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
    const editor = fs.readFileSync(path.join(root, 'assets/editor/takeoff.js'), 'utf8');
    const api = fs.readFileSync(path.join(root, 'api/takeoff.php'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'pages/editor.php'), 'utf8');
    assert.match(parent, /function layerCanvasPayload[\s\S]*?catalogMetadata: layerCatalogMetadata\(layer\)/);
    assert.match(parent, /syncTakeoffFromCanvasSnapshot[\s\S]*?remote\.catalogMetadata/);
    assert.match(editor, /function projectLayerPayload[\s\S]*?catalogMetadata: window\.CatalogMetadata\.fromLayer\(layer\)/);
    assert.match(editor, /projectTakeoffSyncLayers[\s\S]*?payload\.catalogMetadata/);
    assert.match(editor, /projectTakeoffActivateLayer[\s\S]*?payload\.catalogMetadata/);
    assert.match(api, /json_value\(\$layer\['metadata_json'\] \?\? null\)/);
    assert.ok(page.indexOf('catalog_metadata.js') < page.indexOf('editor/takeoff.js'));
});
