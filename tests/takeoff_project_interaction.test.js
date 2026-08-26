const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'assets', 'project_takeoff.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const CatalogMetadata = require('../assets/catalog_metadata.js');
const editor = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'pages', 'project_dashboard.php'), 'utf8');

function projectTakeoffInternals() {
    const end = source.lastIndexOf('})();');
    assert.notEqual(end, -1, 'project_takeoff.js must remain an IIFE');
    const instrumented = `${source.slice(0, end)}
        globalThis.__takeoffTest = {
            takeoffState,
            selectionState,
            applyAggregatedCanvasQuantities,
            seedGroupsFromProjectLayers
        };
    ${source.slice(end)}`;
    const sandbox = {
        console,
        setTimeout: () => 0,
        clearTimeout: () => {},
        requestAnimationFrame: () => 0,
        URLSearchParams,
        CustomEvent: class CustomEvent {},
        localStorage: { getItem: () => null, setItem: () => {} },
        document: {
            readyState: 'loading',
            addEventListener: () => {},
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => []
        }
    };
    sandbox.window = sandbox;
    sandbox.CatalogMetadata = CatalogMetadata;
    sandbox.window.ProjectState = { projectId: 2, documents: [] };
    vm.runInNewContext(instrumented, sandbox, { filename: sourcePath });
    return sandbox.__takeoffTest;
}

test('group and layer checkboxes activate from their change event without bubbling the click', () => {
    assert.match(source, /\[data-group-select\][\s\S]*?addEventListener\('click',\s*event\s*=>\s*event\.stopPropagation\(\)\)[\s\S]*?addEventListener\('change',\s*\(\)\s*=>\s*setGroupSelection\(box\.dataset\.groupSelect,\s*box\.checked\)\)/);
    assert.match(source, /\[data-layer-select\][\s\S]*?addEventListener\('click',\s*event\s*=>\s*event\.stopPropagation\(\)\)[\s\S]*?addEventListener\('change',\s*\(\)\s*=>\s*toggleLayerSelection\(box\.dataset\.layerSelect,\s*box\.checked\)\)/);
});

test('groups support additive selection, persistent bulk deletion, and drag reorder from the chevron', () => {
    assert.match(source, /selectedGroupIds:\s*\[\]/);
    assert.match(source, /groupIds\.add\(String\(group\.id\)\)/);
    assert.match(source, /callEditor\('projectTakeoffDeleteLayers', layerIds\)/);
    assert.match(source, /takeoff:estimating-groups-delete-requested/);
    assert.match(source, /draggable="true" data-group-toggle/);
    assert.match(source, /function reorderTakeoffGroup\(sourceId, targetId\)/);
    assert.match(source, /takeoff:estimating-groups-reorder-requested/);
});

test('an intentionally empty Takeoff stays empty and exposes visible group creation', () => {
    assert.doesNotMatch(editor, /if \(!state\.layers\.length[^\n]*\)[\s\S]{0,120}seedTemplateLayers/);
    assert.match(source, /return groups;[\s\S]*?function normalizeSavedGroups/);
    assert.doesNotMatch(source, /if \(!result\.length\) result\.push\(defaultGroup/);
    assert.match(source, /estimating-group-create-requested/);
    assert.match(dashboard, /class="pro-create-group-btn"[^>]*data-takeoff-action="create-group"/);
    const actionsMenu = dashboard.slice(dashboard.indexOf('id="takeoffItemsActions"'), dashboard.indexOf('class="pro-create-group-btn"'));
    assert.doesNotMatch(actionsMenu, /data-takeoff-action="create-group"/);
});

test('quantities update in real time by aggregating every document snapshot once', () => {
    const { takeoffState, applyAggregatedCanvasQuantities } = projectTakeoffInternals();
    takeoffState.groups = [{
        id: 'default',
        layers: [
            { id: 'copper', baseQuantity: 2, quantity: 0 },
            { id: 'receptacle', baseQuantity: 0, quantity: 0 }
        ]
    }];
    takeoffState.canvasSnapshots = {
        doc1: { estimateId: 'est_primary', layers: [{ id: 'copper', shapes: [{ quantityValue: 3 }, { quantity: 4 }] }] },
        doc2: { estimateId: 'est_primary', layers: [
            { layerId: 'copper', takeoffObjects: [{ quantityValue: 5 }] },
            { id: 'receptacle', shapes: [{ quantity: 7 }] }
        ] }
    };

    applyAggregatedCanvasQuantities();

    assert.equal(takeoffState.groups[0].layers[0].quantity, 14, 'base 2 + document totals 7 and 5');
    assert.equal(takeoffState.groups[0].layers[1].quantity, 7);
});

test('a persisted calculated quantity is not reused as an additive base quantity', () => {
    // The function runs in the VM, so update the ProjectState object captured
    // by its global through a second instrumented instance.
    const end = source.lastIndexOf('})();');
    const instrumented = `${source.slice(0, end)}
        globalThis.__takeoffTest = { seedGroupsFromProjectLayers };
    ${source.slice(end)}`;
    const sandbox = {
        console,
        setTimeout: () => 0,
        clearTimeout: () => {},
        requestAnimationFrame: () => 0,
        URLSearchParams,
        CustomEvent: class CustomEvent {},
        localStorage: { getItem: () => null, setItem: () => {} },
        document: {
            readyState: 'loading', addEventListener: () => {}, getElementById: () => null,
            querySelector: () => null, querySelectorAll: () => []
        }
    };
    sandbox.window = sandbox;
    sandbox.CatalogMetadata = CatalogMetadata;
    sandbox.ProjectState = {
        projectId: 2,
        documents: [],
        takeoffLayers: [{ id: 10, name: 'Conduit', quantity: 12 }]
    };
    vm.runInNewContext(instrumented, sandbox, { filename: sourcePath });

    const layer = sandbox.__takeoffTest.seedGroupsFromProjectLayers()[0].layers[0];
    assert.equal(layer.quantity, 12, 'the API aggregate remains available for initial display');
    assert.equal(layer.baseQuantity, 0, 'the API aggregate is not added to measured shapes again');
});
