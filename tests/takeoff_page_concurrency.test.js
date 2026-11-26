const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reconciler = require('../assets/takeoff_collaboration_reconciler.js');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api', 'takeoff.php'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');

test('autosave preserves a vertex drag and an open trace through finish or cancellation', async () => {
    class CanvasNode {
        constructor(attributes = {}) {
            this.attributes = { ...attributes };
            this.events = {};
        }
        on(event, handler) { this.events[event] = handler; }
        position(value) {
            if (value) Object.assign(this.attributes, value);
            return { x: this.attributes.x, y: this.attributes.y };
        }
        points(value) { this.attributes.points = value; }
        moveToTop() {}
        text() {}
        destroy() { this.destroyed = true; }
    }
    const noop = () => {};
    const requests = [];
    const sandbox = {
        window: {
            addEventListener: noop,
            TakeoffCollaborationReconciler: reconciler,
            CatalogMetadata: { clone: structuredClone },
            __projectTakeoffEstimateKey: 'estimate'
        },
        document: { readyState: 'loading', addEventListener: noop, querySelectorAll: () => [] },
        Konva: { Line: CanvasNode, Text: CanvasNode, Circle: CanvasNode },
        konvaLayer: { add: noop, batchDraw: noop },
        konvaStage: null,
        pageNum: 1, fileId: 2, canvas: null, queueMicrotask, structuredClone,
        send(body) { return new Promise(resolve => requests.push({ body: structuredClone(body), resolve })); }
    };
    const end = editor.lastIndexOf('})();');
    vm.runInNewContext(editor.slice(0, end) + `
        ensureKonva = () => true;
        bindKonva = () => {};
        createVertexHandleNode = point => new Konva.Circle(point);
        applySegmentLockVisual = renderProperties = renderNodes = renderAll = renderSummary = renderLayers
            = postTakeoffSaveStatus = scheduleTakeoffAutosave = emitProjectState = () => {};
        getPlanScale = () => 10;
        flushKonvaCanvasDraw = updateDrawingStatus = emitToolState = applyTakeoffDrawingInteractivity
            = clearTakeoffSelection = scheduleEditorUiRefresh = emitFastLayerQuantityDelta
            = scheduleEmitProjectState = showToast = () => {};
        request = (_action, body) => send(body);
        globalThis.editorTest = { state, createSegmentNode, trackTakeoffObjects, applyRemoteTakeoffSnapshot,
            buildSaveTakeoffPayload, performSaveTakeoff, addLinearPoint, finishLinear, cancelLinearDraft };
    ` + editor.slice(end), sandbox);
    const runtime = sandbox.editorTest;
    const segment = { client_uid: 'run', type: 'linear', page_number: 1, updated_at: 'previous',
        points_json: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    runtime.state.segments.push(segment);
    runtime.createSegmentNode(segment);
    runtime.trackTakeoffObjects([segment]);
    const oldSave = runtime.performSaveTakeoff(true, true);
    const handle = segment.handles[1];
    handle.events.dragstart({});
    handle.position({ x: 150, y: 0 });
    handle.events.dragmove({});
    assert.equal(segment.node.attributes.points[2], 150);
    const duringDrag = runtime.buildSaveTakeoffPayload().body.segments[0];
    assert.equal(duringDrag.points_json[1].x, 100);
    assert.equal(duringDrag.total_length, 10);

    const saved = { ...requests[0].body.segments[0], updated_at: 'acknowledged' };
    requests[0].resolve({ status: 'success', data: { revision: 2, layers: [], markers: [], segments: [saved] } });
    await oldSave;
    assert.equal(runtime.state.segments[0], segment);
    assert.equal(handle.destroyed, undefined);
    assert.equal(handle.position().x, 150);

    const other = { ...saved, client_uid: 'other' };
    runtime.applyRemoteTakeoffSnapshot({ revision: 3, layers: [], markers: [], segments: [saved, other] });
    assert.equal(runtime.state.segments.length, 1);
    handle.position({ x: 220, y: 0 });
    handle.events.dragmove({});
    handle.events.dragend({});
    await Promise.resolve();

    assert.equal(runtime.state.segments[0], segment);
    assert.equal(runtime.state.segments[1].client_uid, 'other');
    const finalRequest = runtime.performSaveTakeoff(true, true);
    const finalSave = requests[1].body;
    assert.equal(finalSave.segments[0].points_json[1].x, 220);
    assert.equal(finalSave.segments[0].total_length, 22);
    assert.equal(finalSave.dirty_object_ids.join(','), 'run');
    assert.equal(finalSave.object_base_versions.run, 'acknowledged');
    requests[1].resolve({ status: 'success', data: {
        revision: 4, layers: [], markers: [], segments: finalSave.segments
    } });
    assert.equal((await finalRequest).dirtyRemaining, false);
    assert.equal(runtime.state.segments[0].points_json[1].x, 220);

    runtime.state.layers.push({ client_uid: 'layer', type: 'linear', metadata_json: {} });
    runtime.state.selectedLayerUid = 'layer';
    runtime.trackTakeoffObjects([runtime.state.segments[0]]);
    const saveDuringDraft = runtime.performSaveTakeoff(true, true);
    runtime.addLinearPoint({ x: 10, y: 10 });
    runtime.addLinearPoint({ x: 110, y: 10 });
    const draft = runtime.state.draftLine;
    assert.equal(sandbox.window.projectTakeoffCanChangeDrawing(), false);
    assert.equal(sandbox.window.projectTakeoffSetTool('pan'), true);
    assert.equal(runtime.state.draftLine, draft);
    const priorWrite = requests[2].body;
    requests[2].resolve({ status: 'success', data: {
        revision: 5, layers: priorWrite.layers, markers: [], segments: priorWrite.segments
    } });
    await saveDuringDraft;
    assert.equal(runtime.state.draftLine, draft);
    assert.equal(draft.points.length, 2);
    assert.equal(runtime.buildSaveTakeoffPayload().body.segments.length, 2);
    sandbox.window.projectTakeoffSetTool('linear');
    assert.equal(runtime.state.panMode, false);
    runtime.addLinearPoint({ x: 210, y: 10 });
    assert.equal(runtime.finishLinear(), true);
    await Promise.resolve();
    assert.equal(runtime.state.draftLine, null);
    assert.equal(sandbox.window.projectTakeoffCanChangeDrawing(), true);
    const finished = runtime.state.segments.find(row => row.layer_client_uid === 'layer');
    assert.equal(finished.points_json.length, 3);
    assert.equal(finished.total_length, 20);
    assert.ok(runtime.buildSaveTakeoffPayload().body.dirty_object_ids.includes(finished.client_uid));

    runtime.addLinearPoint({ x: 30, y: 20 });
    const remote = { ...other, client_uid: 'remote', page_number: 2 };
    runtime.applyRemoteTakeoffSnapshot({ revision: 6, layers: priorWrite.layers, markers: [], segments: [remote] });
    assert.equal(runtime.state.segments.some(row => row.client_uid === 'remote'), false);
    runtime.cancelLinearDraft();
    await Promise.resolve();
    assert.equal(runtime.state.draftLine, null);
    assert.equal(runtime.state.segments.some(row => row.client_uid === 'remote'), true);
    assert.equal(runtime.state.segments.filter(row => row.layer_client_uid === 'layer').length, 1);
});

test('Takeoff autosave identifies only pages changed by this client', () => {
    assert.match(editor, /const dirtyTakeoffPages = new Set\(\)/);
    assert.match(editor, /dirtyTakeoffPages\.add\(Number\(pageNum \|\| 1\)\)/);
    assert.match(editor, /dirty_page_numbers: fallbackPages/);
    assert.match(editor, /dirtyTakeoffPageGenerations/);
});

test('server serializes and merges dirty pages without replacing other sheets', () => {
    assert.match(api, /function merge_takeoff_pages/);
    assert.match(api, /SELECT state_json FROM takeoff_estimate_states WHERE estimate_key = \? AND drawing_id = \? LIMIT 1 FOR UPDATE/);
    assert.match(api, /merge_takeoff_pages\(\$currentSnapshot, \$snapshot, \$dirtyPages\)/);
    assert.ok(api.indexOf('FOR UPDATE') < api.indexOf('DELETE FROM takeoff_count_markers WHERE layer_id IN'));
});

test('same-page saves merge by stable object id and detect same-object conflicts', () => {
    assert.match(editor, /dirty_object_ids: \[\.\.\.dirtyTakeoffObjects\.keys\(\)\]/);
    assert.match(editor, /deleted_object_ids: \[\.\.\.deletedTakeoffObjects\.keys\(\)\]/);
    assert.match(api, /function merge_takeoff_objects/);
    assert.match(api, /function assert_takeoff_object_versions/);
    assert.match(api, /code' => 'object_conflict'/);
    assert.match(api, /if \(\$dirtyObjectIds \|\| \$deletedObjectIds\)[\s\S]{0,120}merge_takeoff_objects/);
});

test('object-only saves merge into the locked server snapshot instead of a stale browser snapshot', () => {
    const saveCase = api.slice(api.indexOf("case 'save_state':"), api.indexOf("case 'save_catalog_item':"));
    assert.match(saveCase, /if \(!\$dirtyPages && \(\$dirtyObjectIds \|\| \$deletedObjectIds\)\)[\s\S]{0,500}\$snapshot = \$currentSnapshot;/);
    assert.match(saveCase, /merge_takeoff_objects\(\$snapshot, \['layers' => \$layers/);
    assert.match(saveCase, /if \(!\$dirtyPages && \(\$dirtyObjectIds \|\| \$deletedObjectIds\)\)[\s\S]{0,120}\$retrySnapshot = \$latestSnapshot;/);
});

test('server makes placement retries idempotent before calculating quantities', () => {
    assert.match(api, /function normalize_takeoff_snapshot_objects/);
    assert.match(api, /placement_operation_id/);
    assert.match(api, /seenGeometrySignatures/);
    assert.match(api, /geometrySignature/);
    assert.match(api, /\$row\['points_json'\]/);
    assert.match(api, /\$snapshot = normalize_takeoff_snapshot_objects\(\$snapshot\)/);
    assert.ok(
        api.indexOf('$snapshot = normalize_takeoff_snapshot_objects($snapshot)')
            < api.indexOf('$snapshot = recalculate_takeoff_snapshot_quantities($snapshot)'),
        'duplicate operations must be removed before quantity calculation'
    );
});
