const test = require('node:test');
const assert = require('node:assert/strict');
const reconciler = require('../assets/takeoff_collaboration_reconciler.js');

const marker = (id, extra = {}) => ({ client_uid: id, x: 1, y: 1, ...extra });

test('receives a remote object while an unrelated local object is dirty', () => {
    const localDirty = marker('local-dirty', { x: 9 });
    const result = reconciler.reconcileCollection(
        [localDirty],
        [marker('remote-new')],
        { dirtyIds: new Set(['local-dirty']) }
    );
    assert.deepEqual(result.rows.map(row => row.client_uid), ['local-dirty', 'remote-new']);
    assert.equal(result.rows[0], localDirty);
});

test('does not overwrite the same dirty object with a remote snapshot', () => {
    const localDirty = marker('same', { x: 22 });
    const result = reconciler.reconcileCollection(
        [localDirty],
        [marker('same', { x: 2 })],
        { dirtyIds: new Set(['same']) }
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].x, 22);
});

test('applies authoritative remote deletion to a clean object', () => {
    const result = reconciler.reconcileCollection([marker('deleted-remotely')], []);
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.removedIds, ['deleted-remotely']);
});

test('a local tombstone prevents a delayed response from resurrecting an object', () => {
    const result = reconciler.reconcileCollection([], [marker('deleted-locally')], {
        deletedIds: new Set(['deleted-locally'])
    });
    assert.deepEqual(result.rows, []);
});

test('placement operation identity prevents duplicates with different client ids', () => {
    const localDirty = marker('local-id', { placement_operation_id: 'operation-1' });
    const remoteCopy = marker('server-id', { metadata_json: { placement_operation_id: 'operation-1' } });
    const result = reconciler.reconcileCollection([localDirty], [remoteCopy], {
        dirtyIds: new Set(['local-id'])
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].client_uid, 'local-id');
});

test('reapplying the same canonical snapshot is idempotent', () => {
    const remote = [marker('a'), marker('b')];
    const first = reconciler.reconcileCollection([], remote).rows;
    const second = reconciler.reconcileCollection(first, remote).rows;
    assert.deepEqual(second, first);
});

test('stale revisions are rejected', () => {
    assert.equal(reconciler.shouldApplyRevision(8, 8), false);
    assert.equal(reconciler.shouldApplyRevision(8, 7), false);
    assert.equal(reconciler.shouldApplyRevision(8, 9), true);
});

test('hundreds of objects reconcile repeatedly without duplication', () => {
    const local = Array.from({ length: 500 }, (_, index) => marker(`local-${index}`));
    const remote = [
        ...local.map(row => ({ ...row })),
        ...Array.from({ length: 500 }, (_, index) => marker(`remote-${index}`))
    ];
    const dirtyIds = new Set(['local-10', 'local-250']);
    local[10].x = 1010;
    local[250].x = 1250;
    const first = reconciler.reconcileCollection(local, remote, { dirtyIds }).rows;
    const second = reconciler.reconcileCollection(first, remote, { dirtyIds }).rows;
    assert.equal(first.length, 1000);
    assert.equal(second.length, 1000);
    assert.equal(new Set(second.map(row => row.client_uid)).size, 1000);
    assert.equal(second.find(row => row.client_uid === 'local-10').x, 1010);
    assert.equal(second.find(row => row.client_uid === 'local-250').x, 1250);
});

test('two clients with alternating unsaved placements converge to one object per click', () => {
    let server = [];
    let clientA = [];
    let clientB = [];

    for (let index = 0; index < 5; index += 1) {
        const fromA = marker(`a-${index}`, { placement_operation_id: `op-a-${index}` });
        clientA.push(fromA);
        clientA = reconciler.reconcileCollection(clientA, server, {
            dirtyIds: new Set([fromA.client_uid])
        }).rows;
        server = [...server, { ...fromA }];
        clientB = reconciler.reconcileCollection(clientB, server).rows;

        const fromB = marker(`b-${index}`, { placement_operation_id: `op-b-${index}` });
        clientB.push(fromB);
        clientB = reconciler.reconcileCollection(clientB, server, {
            dirtyIds: new Set([fromB.client_uid])
        }).rows;
        server = [...server, { ...fromB }];
        clientA = reconciler.reconcileCollection(clientA, server).rows;
        clientB = reconciler.reconcileCollection(clientB, server).rows;
    }

    assert.equal(server.length, 10);
    assert.deepEqual(clientA.map(row => row.client_uid).sort(), server.map(row => row.client_uid).sort());
    assert.deepEqual(clientB.map(row => row.client_uid).sort(), server.map(row => row.client_uid).sort());
});
