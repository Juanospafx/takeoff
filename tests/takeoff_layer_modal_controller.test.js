const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../assets/takeoff_layer_modal.js');
const dashboardPath = path.resolve(__dirname, '../pages/project_dashboard.php');
const projectTakeoffPath = path.resolve(__dirname, '../assets/project_takeoff.js');

function loadFactory() {
    assert.ok(fs.existsSync(modulePath), 'assets/takeoff_layer_modal.js must exist');
    delete require.cache[require.resolve(modulePath)];

    const previousWindow = global.window;
    global.window = {};
    try {
        const exported = require(modulePath);
        const api = exported?.create ? exported : global.window.TakeoffLayerModalController;
        assert.ok(api, 'the module must expose window.TakeoffLayerModalController');
        assert.equal(typeof api.create, 'function', 'TakeoffLayerModalController.create must be a factory');
        return api;
    } finally {
        global.window = previousWindow;
    }
}

function makeController(overrides = {}) {
    const calls = [];
    const api = loadFactory();
    const modal = {
        id: 'takeoffLayerModal',
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => calls.push('bind')
    };
    const controller = api.create({
        getEditingLayerId: () => 'layer-1',
        getElement: () => null,
        ensureModal: () => modal,
        switchTab: () => {},
        openCatalogModal: () => {},
        showSplitPrepared: () => {},
        flushActiveLayerModalSave: () => calls.push('flush'),
        isLayerModalNonAutoDirty: () => false,
        submitLayerModal: async () => {
            calls.push('submit');
            return true;
        },
        closeLayerModal: () => calls.push('close'),
        ...overrides
    });
    return { controller, calls };
}

function assertSourceMatch(source, pattern, message) {
    assert.ok(pattern.test(source), message || `expected source to match ${pattern}`);
}

test('publishes a factory whose controller has the extraction boundary', () => {
    const api = loadFactory();
    const controller = api.create({});

    assert.equal(typeof controller.ensure, 'function');
    assert.equal(typeof controller.commit, 'function');
});

test('ensure is idempotent and does not bind modal handlers twice', () => {
    let creates = 0;
    let binds = 0;
    const modal = {
        id: 'takeoffLayerModal',
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => { binds += 1; }
    };
    const { controller } = makeController({
        ensureModal: () => {
            creates += 1;
            return modal;
        }
    });

    assert.equal(controller.ensure(), modal);
    assert.equal(controller.ensure(), modal);
    assert.equal(creates, 1, 'the drawer DOM must only be created once');
    assert.equal(binds, 1, 'Close/X/Enter handlers must only be registered once');
});

test('commit flushes pending autosave and closes immediately when deferred fields are clean', async () => {
    const { controller, calls } = makeController();

    assert.equal(await controller.commit(), true);
    assert.deepEqual(calls, ['flush', 'close']);
});

test('commit submits deferred title and metadata on the first action when dirty', async () => {
    const { controller, calls } = makeController({
        isLayerModalNonAutoDirty: () => true
    });

    assert.equal(await controller.commit(), true);
    assert.deepEqual(calls, ['flush', 'submit']);
});

test('new layers submit directly instead of running an edit autosave flush', async () => {
    const { controller, calls } = makeController({
        getEditingLayerId: () => null
    });

    assert.equal(await controller.commit(), true);
    assert.deepEqual(calls, ['submit']);
});

test('integration keeps Close, X, Enter and the active three-dot toggle on controller.commit', () => {
    const projectSource = fs.readFileSync(projectTakeoffPath, 'utf8');
    const controllerSource = fs.readFileSync(modulePath, 'utf8');

    assertSourceMatch(controllerSource, /layerDrawerSaveBtn[\s\S]*?void commit\(\)/, 'Close must use controller.commit');
    assertSourceMatch(controllerSource, /data-layer-modal-close[\s\S]*?void commit\(\)/, 'drawer X must use controller.commit');
    assertSourceMatch(controllerSource, /event\.key !== 'Enter'[\s\S]*?void commit\(\)/, 'Enter must use controller.commit');
    assertSourceMatch(projectSource, /if \(isOpen\) \{\s*void layerModalController\.commit\(\);\s*return;/,
        'clicking the active three-dot menu must commit on the first close action');
});

test('autosave remains limited to UoM, symbol, size and color', () => {
    const source = fs.readFileSync(modulePath, 'utf8');

    for (const field of ['layerUomInput', 'layerSymbolInput', 'layerSizeInput', 'layerColorInput']) {
        assertSourceMatch(source, new RegExp(`${field}[\\s\\S]*?(?:scheduleLiveLayerModalSave|applyLiveLayerModalEdits)`),
            `${field} must retain live autosave`);
    }
    for (const field of ['layerNameInput', 'layerTagInput', 'layerTypeInput', 'layerDifficultyInput', 'layerMultiplierInput']) {
        const fieldBlock = source.slice(source.indexOf(field), source.indexOf(field) + 400);
        assert.doesNotMatch(fieldBlock, /(?:scheduleLiveLayerModalSave|applyLiveLayerModalEdits)/,
            `${field} must wait for an explicit commit`);
    }
});

test('catalog actions retain single-select semantics', () => {
    const source = fs.readFileSync(modulePath, 'utf8');

    assertSourceMatch(source, /layerCatalogCard[\s\S]*?openCatalogModal\(\{\s*singleSelect:\s*true\s*\}\)/);
    assertSourceMatch(source, /layerSwapCatalogBtn[\s\S]*?openCatalogModal\(\{\s*singleSelect:\s*true\s*\}\)/);
});

test('dashboard loads the controller before project_takeoff with filemtime cache keys', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const controllerIndex = source.indexOf('takeoff_layer_modal.js');
    const projectIndex = source.indexOf('project_takeoff.js');

    assert.ok(controllerIndex >= 0, 'dashboard must load takeoff_layer_modal.js');
    assert.ok(controllerIndex < projectIndex, 'controller must load before project_takeoff.js');
    assert.match(source, /takeoff_layer_modal\.js\?v=<\?=\s*filemtime\(/);
});
