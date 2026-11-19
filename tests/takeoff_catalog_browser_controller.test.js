const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'assets', 'takeoff_catalog_browser.js');
const projectSource = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');

function element() {
    return {
        hidden: true,
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        focus() {}
    };
}

test('catalog browser owns open, close and normalized catalog loading state', async () => {
    delete require.cache[require.resolve(modulePath)];
    const api = require(modulePath);
    const elements = new Map([
        ['takeoffCatalogModal', element()],
        ['takeoffCreateLayerModal', { ...element(), hidden: true }],
        ['proBrowseItemSearch', element()],
        ['proBrowseCatSearch', element()]
    ]);
    const takeoffState = { pendingCatalogItems: [{ id: 7 }] };
    const catalogState = { loaded: false, loading: false, catalogs: [], groups: [], items: [] };
    let renders = 0;
    const controller = api.create({
        getElement: id => elements.get(id),
        takeoffState,
        catalogState,
        requireWrite: () => true,
        ensureTakeoffModal: () => {},
        ensureCatalogModal: () => {},
        render: () => { renders += 1; },
        getCatalogItemUnitCost: () => 12.5,
        getCatalogItemLaborHours: () => 0.75,
        window: {
            CatalogService: {
                getSnapshot: async () => ({
                    catalogs: [{ id: 1, name: 'Main' }],
                    categories: [{ id: 2, catalogId: 1, name: 'Conduit' }],
                    items: [{ id: 7, name: 'EMT', unit_of_measure: 'ft' }]
                })
            }
        }
    });

    assert.equal(controller.open(), true);
    await controller.load();
    assert.deepEqual([...controller.state.selectedItemIds], ['7']);
    assert.equal(catalogState.items[0].unitCost, 12.5);
    assert.equal(catalogState.items[0].laborHours, 0.75);
    assert.equal(elements.get('takeoffCatalogModal').hidden, false);
    assert.ok(renders >= 2);

    controller.state.itemQuery = 'emt';
    assert.deepEqual(controller.filterItems().map(item => item.id), [7]);
    controller.state.itemQuery = 'missing';
    assert.deepEqual(controller.filterItems(), []);

    controller.close();
    assert.equal(elements.get('takeoffCatalogModal').hidden, true);
    assert.equal(controller.state.singleSelect, false);
});

test('project uses thin catalog wrappers and dashboard loads module before project Takeoff', () => {
    assert.match(projectSource, /const catalogBrowserController = window\.TakeoffCatalogBrowser\.create/);
    assert.match(projectSource, /function openCatalogModal\(options = \{\}\) \{\s*return catalogBrowserController\.open\(options\);\s*\}/);
    assert.match(projectSource, /function closeCatalogModal\(\) \{\s*return catalogBrowserController\.close\(\);\s*\}/);
    assert.doesNotMatch(projectSource, /async function loadCatalogItems/);

    const moduleIndex = dashboardSource.indexOf('takeoff_catalog_browser.js');
    const projectIndex = dashboardSource.indexOf('project_takeoff.js');
    assert.ok(moduleIndex >= 0 && moduleIndex < projectIndex);
    assert.match(dashboardSource, /takeoff_catalog_browser\.js\?v=<\?=\s*filemtime\(/);
});
