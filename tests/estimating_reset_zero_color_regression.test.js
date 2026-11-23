const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const estimating = fs.readFileSync(path.join(root, 'assets', 'project_estimating.js'), 'utf8');
const takeoff = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.js'), 'utf8');
const syncService = require(path.join(root, 'assets', 'takeoff_estimating_sync_service.js'));

function extractFunction(source, name, nextName) {
    const start = source.indexOf(`function ${name}`);
    const end = source.indexOf(`function ${nextName}`, start);
    assert.ok(start >= 0, `${name} must exist`);
    assert.ok(end > start, `${nextName} must follow ${name}`);
    return source.slice(start, end);
}

test('Takeoff layers created from Estimating retain explicit and catalog default colors', () => {
    const block = extractFunction(takeoff, 'resolveEstimatingItemTakeoffColor', 'syncEstimatingItemsToTakeoff');
    const sandbox = { result: null };
    vm.runInNewContext(`${block}
        result = [
            resolveEstimatingItemTakeoffColor({ color: '#abcdef', catalogMetadata: { takeoffDefaults: { color: '#112233' } } }),
            resolveEstimatingItemTakeoffColor({ catalogMetadata: { takeoffDefaults: { color: '#112233' } } }),
            resolveEstimatingItemTakeoffColor({ catalogSnapshot: { takeoffDefaults: { color: '#445566' } } }),
            resolveEstimatingItemTakeoffColor({})
        ];`, sandbox);
    assert.deepEqual(Array.from(sandbox.result), ['#abcdef', '#112233', '#445566', '#2563eb']);

    const syncBlock = takeoff.slice(takeoff.indexOf('function syncEstimatingItemsToTakeoff'), takeoff.indexOf('function estimateLineFromLayer'));
    assert.match(syncBlock, /color:\s*resolveEstimatingItemTakeoffColor\(item\)/);
    assert.match(syncBlock, /mayRestoreEstimatingColor[\s\S]*color:\s*resolvedColor/,
        'existing layers must recover their Estimating color too');
    assert.match(syncBlock, /layer\.colorSource !== 'takeoff-user'/,
        'manual Takeoff colors, including the default blue, must not be overwritten');
    assert.ok(syncBlock.indexOf('scopedLayers.find(matchesTakeoffIdentity)')
        < syncBlock.indexOf("scopedLayers.find(row => String(row.estimatingItemId"),
    'the persisted Takeoff identity must win over a shared Estimating item alias');
    assert.match(syncBlock, /String\(item\.takeoffLayerId \|\| ''\) !== String\(layer\.id\)[\s\S]*pendingLinks\.push/,
        'fallback aliases must relink Estimating to the chosen canonical layer');
    assert.match(syncBlock, /seenLayerObjects\.has\(layer\)/,
        'only the canonical layer object may survive reconciliation');
    assert.match(syncBlock, /purgeableLayerTrackingKeys\(layer, canonicalLayerKeys\)/,
        'duplicate cleanup must not purge tracking keys owned by the canonical layer');
    assert.match(takeoff, /layer\.colorSource = 'takeoff-user'/,
        'a user-selected Takeoff color must remain authoritative');
    assert.doesNotMatch(syncBlock, /size:\s*'Medium',\s*color:\s*'#2563eb'/);
});

test('duplicate cleanup never purges a tracking key owned by the canonical layer', () => {
    const start = takeoff.indexOf('function collectLayerTrackingKeys');
    const end = takeoff.indexOf('function queueDeletedLayersForEstimate', start);
    const sandbox = { result: null, Set };
    vm.runInNewContext(`${takeoff.slice(start, end)}
        const canonical = { id: 'layer-1', client_uid: 'canonical-client' };
        const duplicate = { id: 'layer-1', client_uid: 'duplicate-client' };
        const protectedKeys = new Set(collectLayerTrackingKeys(canonical));
        result = purgeableLayerTrackingKeys(duplicate, protectedKeys);`, sandbox);
    assert.deepEqual(Array.from(sandbox.result), ['duplicate-client']);
});

test('linked-only reconciliation removes legacy duplicate rows idempotently', () => {
    const existing = [{ id: 'g1', name: 'Electrical', items: [
        { id: 'first', takeoffLayerId: 'layer-1', name: 'Fixture', quantity: 1 },
        { id: 'duplicate', takeoffLayerId: 'layer-1', name: 'Fixture copy', quantity: 2 }
    ] }];
    const incoming = [{ id: 'g1', name: 'Electrical', items: [
        { id: 'layer-1', takeoffLayerId: 'layer-1', name: 'Fixture', quantity: 7 }
    ] }];
    const once = syncService.reconcileLinkedOnly(existing, incoming);
    const twice = syncService.reconcileLinkedOnly(once, incoming);
    assert.equal(once[0].items.length, 1);
    assert.equal(once[0].items[0].quantity, 7);
    assert.deepEqual(twice, once);
});

test('quantity reset means zero and preserves Takeoff measurement as an override', () => {
    const block = extractFunction(estimating, 'zeroEstimatingItemQuantity', 'handleActionPopoverClick');
    const sandbox = {
        Workspace: { numeric: value => Number.isFinite(Number(value)) ? Number(value) : 0 },
        result: null
    };
    vm.runInNewContext(`${block}
        const linked = { quantity: 14, takeoffLayerId: 'layer-1', originalQuantity: 12, lastSyncedTakeoffQuantity: 14 };
        const manual = { quantity: 9, originalQuantity: 9 };
        zeroEstimatingItemQuantity(linked);
        zeroEstimatingItemQuantity(manual);
        result = { linked, manual };`, sandbox);

    assert.equal(sandbox.result.linked.quantity, 0);
    assert.equal(sandbox.result.linked.quantityOverride, true);
    assert.equal(sandbox.result.linked.pendingTakeoffQuantity, 14);
    assert.equal(sandbox.result.linked.lastSyncedTakeoffQuantity, 14);
    assert.equal(sandbox.result.linked.quantitySyncStatus, 'overridden');
    assert.equal(sandbox.result.manual.quantity, 0);
    assert.equal(sandbox.result.manual.quantityOverride, false);
    assert.equal(sandbox.result.manual.quantitySyncStatus, 'manual');
    assert.equal(sandbox.result.manual._manualFields.quantity, true);
});

test('individual, group and global reset paths share the zero helper', () => {
    const occurrences = estimating.match(/zeroEstimatingItemQuantity\(/g) || [];
    assert.ok(occurrences.length >= 6, 'helper plus every duplicated reset path must use the same behavior');
    const globalReset = estimating.slice(estimating.indexOf("if (action === 'reset-quantities')"), estimating.indexOf("if (action === 'fullscreen')"));
    assert.match(globalReset, /zeroEstimatingItemQuantity\(item\)/);
});

test('empty overwrite permission is attached only to explicit item or group deletion paths', () => {
    const changedBlock = extractFunction(estimating, 'changed', 'reactiveChanged');
    assert.match(changedBlock, /options\.allowEmptyGroupsReplace === true/);
    assert.doesNotMatch(changedBlock, /startsWith\('Deleted'\)/);
    assert.match(estimating, /changed\('Deleted group', \{ allowEmptyGroupsReplace: true \}\)/);
    assert.match(estimating, /changed\('Deleted markup'\);/);
});
