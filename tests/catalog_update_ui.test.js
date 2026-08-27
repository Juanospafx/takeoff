const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/catalog_update_ui.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'pages/project_dashboard.php'), 'utf8');

const change = (catalogItemId, status, changes = [], extra = {}) => ({
    catalogItemId, status, previousRevision: 1, currentRevision: 2, changes, warnings: [], ...extra
});
const pricing = (field, previousValue, currentValue, overrideValue = null) => ({
    field: `pricing.${field}`, previousValue, currentValue,
    hasOverride: overrideValue !== null, overrideValue,
    effectiveValueAfterIfUpdated: overrideValue ?? currentValue
});

function prepared(strategy = 'UPDATE_IN_PLACE') {
    const itemChanges = [
        change(1, 'OUTDATED', [pricing('materialUnitCost', 4.25, 4.8, 4.1)]),
        change(2, 'OUTDATED', [pricing('equipmentUnitCost', 300, 340)]),
        change(3, 'OUTDATED', [pricing('laborHoursPerUnit', .25, .3), pricing('laborRate', 45, 50)]),
        change(4, 'OUTDATED', [{ field: 'assemblyComponents', componentChanges: [
            { change: 'ADDED', currentValue: { catalogItemId: 44, name: 'Junction Box' } },
            { change: 'CHANGED', field: 'quantity', previousValue: 10, currentValue: 12,
                currentValueObject: { catalogItemId: 45 } }
        ] }]),
        change(5, 'MISSING_IN_CATALOG'),
        change(6, 'LEGACY_NO_SNAPSHOT')
    ];
    const projectedItems = [
        { catalogItemId: 1, name: 'EMT Conduit', catalogSnapshot: { type: 'PART', category: { name: 'Conduit' } } },
        { catalogItemId: 2, name: 'Lift Rental', catalogSnapshot: { type: 'EQUIPMENT', category: { name: 'Equipment' } } },
        { catalogItemId: 3, name: 'Electrician', catalogSnapshot: { type: 'LABOR', category: { name: 'Labor' } } },
        { catalogItemId: 4, name: 'Fire Alarm Assembly', catalogSnapshot: { type: 'ASSEMBLY', category: { name: 'Fire Alarm' } } },
        { catalogItemId: 5, name: 'Old Part', catalogSnapshot: { type: 'PART', category: { name: 'Legacy' } } },
        { catalogItemId: 6, name: 'Legacy Part', itemType: 'part' }
    ];
    return {
        guard: { estimateId: 'e1' }, options: {},
        strategy: { strategy }, currentEstimateRevision: 3,
        projectedEstimateRevision: strategy === 'CREATE_REVISION' ? 4 : 3,
        preview: {
            current: { total: 18450 }, projected: { total: 19230 },
            difference: { amount: 780, percent: 4.2276 }, warnings: [],
            changeSet: { linkedItems: 6, outdatedItems: 4, unversionedItems: 0,
                missingItems: 1, legacyItems: 1,
                changesByType: { pricing: 1, equipment: 1, labor: 2, assemblies: 1 }, itemChanges },
            itemImpacts: [
                { catalogItemId: 1, name: 'EMT Conduit', difference: 0 },
                { catalogItemId: 2, name: 'Lift Rental', difference: 40 },
                { catalogItemId: 3, name: 'Electrician', difference: 65 },
                { catalogItemId: 4, name: 'Fire Alarm Assembly', difference: 675 },
                { catalogItemId: 5, name: 'Old Part', difference: 0 },
                { catalogItemId: 6, name: 'Legacy Part', difference: 0 }
            ],
            projectedEstimate: { groups: [{ items: projectedItems }] }
        }
    };
}

function emptyPrepared() {
    return {
        guard: { estimateId: 'e1' }, options: {}, strategy: { strategy: 'UPDATE_IN_PLACE' },
        currentEstimateRevision: 1, projectedEstimateRevision: 1,
        preview: { current: { total: 100 }, projected: { total: 100 }, difference: { amount: 0, percent: 0 }, warnings: [],
            changeSet: { linkedItems: 1, outdatedItems: 0, unversionedItems: 0, missingItems: 0, legacyItems: 0,
                changesByType: {}, itemChanges: [change(1, 'CURRENT')] }, itemImpacts: [],
            projectedEstimate: { groups: [{ items: [] }] } }
    };
}

function runtime(initialPrepared, applyImpl = async () => ({ strategy: 'UPDATE_IN_PLACE' })) {
    const dom = new JSDOM('<!doctype html><body><div id="estimatingModule"><button data-est-action="catalog-update"><span>Update from Cost Catalog</span></button></div></body>', {
        runScripts: 'outside-only', url: 'https://example.test/project'
    });
    const prepareCalls = [];
    const applyCalls = [];
    dom.window.projectEstimatingPrepareCatalogUpdate = async options => {
        prepareCalls.push(options || {});
        return initialPrepared;
    };
    dom.window.projectEstimatingApplyCatalogUpdate = async (value, options) => {
        applyCalls.push({ value, options });
        return applyImpl(value, options);
    };
    dom.window.console.error = () => {};
    dom.window.eval(source);
    return { dom, window: dom.window, document: dom.window.document, prepareCalls, applyCalls };
}

const settle = (window, delay = 0) => new Promise(resolve => window.setTimeout(resolve, delay));

test('Estimating toolbar exposes one visible Update from Cost Catalog entry point', () => {
    assert.match(dashboard, /data-est-action="catalog-update"[^>]*>[\s\S]*?Update from Cost Catalog/);
    assert.equal((dashboard.match(/data-est-action="catalog-update"/g) || []).length, 1);
});

test('no-change response uses a compact up-to-date state', async () => {
    const app = runtime(emptyPrepared());
    app.document.querySelector('[data-est-action="catalog-update"]').click();
    await settle(app.window);
    assert.match(app.document.body.textContent, /Your estimate is up to date with the Cost Catalog/);
    assert.ok(app.document.querySelector('[data-cu-close]'));
    assert.equal(app.document.querySelector('.est-cu-totals'), null);
    app.dom.window.close();
});

test('checking state prevents duplicate prepare requests', async () => {
    const app = runtime(emptyPrepared());
    const trigger = app.document.querySelector('[data-est-action="catalog-update"]');
    trigger.click(); trigger.click();
    assert.equal(app.prepareCalls.length, 1);
    assert.equal(trigger.disabled, true);
    await settle(app.window);
    app.dom.window.close();
});

test('preview renders totals and semantic Part, Equipment, Labor, Assembly, override, missing and legacy states', async () => {
    const fixture = prepared();
    const before = JSON.stringify(fixture);
    const app = runtime(fixture);
    app.document.querySelector('[data-est-action="catalog-update"]').click();
    await settle(app.window);
    const text = app.document.body.textContent;
    assert.match(text, /Current Estimate/);
    assert.match(text, /\$18,450\.00/);
    assert.match(text, /Projected Estimate/);
    assert.match(text, /\$19,230\.00/);
    assert.match(text, /\+\$780\.00/);
    assert.match(text, /Material Cost/);
    assert.match(text, /Equipment Cost/);
    assert.match(text, /Labor Hours/);
    assert.match(text, /Labor Rate/);
    assert.match(text, /Assembly definition changed/);
    assert.match(text, /Project override preserved/);
    assert.match(text, /No longer available in Cost Catalog/);
    assert.match(text, /Legacy item/);
    assert.equal(app.document.querySelector('[data-cu-select="5"]').disabled, true);
    assert.equal(app.document.querySelector('[data-cu-select="6"]').disabled, true);
    assert.equal(JSON.stringify(fixture), before, 'UI does not mutate domain output');
    app.dom.window.close();
});

test('selection is recalculated through prepare and passed unchanged to apply', async () => {
    const fixture = prepared();
    const app = runtime(fixture);
    app.document.querySelector('[data-est-action="catalog-update"]').click();
    await settle(app.window);
    const first = app.document.querySelector('[data-cu-select="1"]');
    first.checked = false;
    first.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    await settle(app.window, 230);
    assert.equal(JSON.stringify([...app.prepareCalls.at(-1).selectedCatalogItemIds].sort()), JSON.stringify(['2', '3', '4']));
    app.document.querySelector('[data-cu-apply]').click();
    await settle(app.window);
    assert.equal(JSON.stringify([...app.applyCalls[0].options.selectedCatalogItemIds].sort()), JSON.stringify(['2', '3', '4']));
    assert.match(app.document.body.textContent, /Estimate updated successfully/);
    app.dom.window.close();
});

test('strategy controls CTA and revision messaging without UI status inference', async () => {
    const updateApp = runtime(prepared('UPDATE_IN_PLACE'));
    updateApp.document.querySelector('[data-est-action="catalog-update"]').click();
    await settle(updateApp.window);
    assert.match(updateApp.document.querySelector('[data-cu-apply]').textContent, /Update Estimate/);
    updateApp.dom.window.close();

    const revisionApp = runtime(prepared('CREATE_REVISION'));
    revisionApp.document.querySelector('[data-est-action="catalog-update"]').click();
    await settle(revisionApp.window);
    assert.match(revisionApp.document.body.textContent, /A new estimate revision will be created/);
    assert.match(revisionApp.document.body.textContent, /Current revision 3 · New revision 4/);
    assert.match(revisionApp.document.querySelector('[data-cu-apply]').textContent, /Create Updated Revision/);
    revisionApp.dom.window.close();
});

test('stale Estimate, Catalog and option errors provide a Refresh Preview recovery path', async () => {
    for (const code of ['ESTIMATE_CHANGED_SINCE_PREVIEW', 'CATALOG_CHANGED_SINCE_PREVIEW', 'PREVIEW_OPTIONS_CHANGED']) {
        const app = runtime(prepared(), async () => { const error = new Error('internal'); error.code = code; throw error; });
        app.document.querySelector('[data-est-action="catalog-update"]').click();
        await settle(app.window);
        app.document.querySelector('[data-cu-apply]').click();
        await settle(app.window);
        assert.ok(app.document.querySelector('[data-cu-refresh]'));
        assert.doesNotMatch(app.document.querySelector('.est-cu-compact h3').textContent, /ESTIMATE_|CATALOG_/);
        app.dom.window.close();
    }
});

test('modal contract includes dialog semantics, focus trap hooks, Escape and responsive CSS', () => {
    const css = fs.readFileSync(path.join(root, 'assets/project_estimating.css'), 'utf8');
    assert.match(source, /role="dialog" aria-modal="true"/);
    assert.match(source, /event\.key === 'Escape'/);
    assert.match(source, /event\.key !== 'Tab'/);
    assert.match(source, /aria-live="polite"/);
    assert.match(css, /\.est-cu-dialog button:focus-visible/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(source, /CatalogService|getSnapshot\(/, 'UI uses only the prepare/apply orchestration APIs');
});
