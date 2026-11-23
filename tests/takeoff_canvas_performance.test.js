const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtime = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'runtime.js'), 'utf8');
const takeoff = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');

function bodyBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return source.slice(start, end);
}

test('wheel work is coalesced into one animation-frame commit', () => {
    const nativeWheel = bodyBetween(runtime, "addEventListener('wheel'", "}, { passive: false })");
    const fabricWheel = bodyBetween(runtime, "canvas.on('mouse:wheel'", "window.addEventListener('beforeunload'");
    const scheduler = bodyBetween(runtime, 'function scheduleViewportFrameUpdate', "canvas.on('selection:created'");

    assert.match(nativeWheel, /scheduleViewportFrameUpdate/);
    assert.match(fabricWheel, /scheduleViewportFrameUpdate/);
    assert.doesNotMatch(nativeWheel, /updateTextScales|syncKonvaToFabric|schedulePdfRerender/);
    assert.match(scheduler, /if \(viewportFrameRaf\) return/);
    assert.match(scheduler, /requestAnimationFrame/);
    assert.match(scheduler, /syncKonvaToFabric\(\{ useBatchDraw: true \}\)/);
});

test('page changes mount only visible geometry instead of retaining the whole project', () => {
    const renderNodes = bodyBetween(takeoff, 'function renderNodes()', 'function setTakeoffPage');
    const setPage = bodyBetween(takeoff, 'function setTakeoffPage', 'window.setTakeoffPage');

    assert.doesNotMatch(renderNodes, /state\.markers\.forEach\(createMarkerNode\)/);
    assert.doesNotMatch(renderNodes, /state\.segments\.forEach\(createSegmentNode\)/);
    assert.match(setPage, /if \(!isVisible\)[\s\S]*destroyMarkerNodes/);
    assert.match(setPage, /if \(!isVisible\)[\s\S]*destroySegmentNodes/);
    assert.match(setPage, /if \(!m\.node\) createMarkerNode\(m\)/);
    assert.match(setPage, /if \(!s\.node\) createSegmentNode\(s\)/);
});

test('creating one segment never rescales every previously created segment', () => {
    const createSegment = bodyBetween(takeoff, 'function createSegmentNode', 'function clearNodes');
    assert.doesNotMatch(createSegment, /syncTakeoffHandleScale\(\)/);
});

test('zoom and interaction updates skip unmounted and hidden controls', () => {
    const scaleSync = bodyBetween(takeoff, 'function syncTakeoffHandleScale', 'function destroySegmentNodes');
    const segmentScale = bodyBetween(takeoff, 'function scaleSegmentInteractionNodes', 'function syncTakeoffHandleScale');
    const interactionSync = bodyBetween(takeoff, 'function applyTakeoffDrawingInteractivity', 'function isColorLight');

    assert.match(scaleSync, /scaleSegmentInteractionNodes\(segment, factor, true\)/);
    assert.match(segmentScale, /if \(!segment\?\.node\) return/);
    assert.match(segmentScale, /visibleOnly[\s\S]*!handle\.visible\(\)/);
    assert.match(interactionSync, /buildTakeoffLayerLookup\(\)/);
    assert.match(interactionSync, /if \(!segment\.node\) return/);
    assert.match(interactionSync, /if \(!marker\.node\) return/);
});

