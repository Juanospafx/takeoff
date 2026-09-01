const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'editor', 'takeoff.js'), 'utf8');

function snap(start, cursor, enabled = true) {
    const begin = source.indexOf('function snapPointTo45');
    const end = source.indexOf('function linearPointForPointer', begin);
    assert.ok(begin >= 0 && end > begin);
    const sandbox = { start, cursor, enabled, result: null, Math };
    vm.runInNewContext(`${source.slice(begin, end)}; result = snapPointTo45(start, cursor, enabled);`, sandbox);
    return sandbox.result;
}

const angleDegrees = (start, point) => {
    const raw = Math.atan2(point.y - start.y, point.x - start.x) * 180 / Math.PI;
    return (raw + 360) % 360;
};

test('Shift snaps horizontal, vertical, and diagonal segments to exact 45 degree increments', () => {
    const start = { x: 10, y: 20 };
    const cases = [
        [{ x: 110, y: 24 }, 0],
        [{ x: 106, y: 110 }, 45],
        [{ x: 14, y: 120 }, 90],
        [{ x: -80, y: 116 }, 135],
        [{ x: -90, y: 16 }, 180],
        [{ x: -78, y: -72 }, 225],
        [{ x: 8, y: -80 }, 270],
        [{ x: 100, y: -74 }, 315]
    ];
    cases.forEach(([cursor, expected]) => {
        const point = snap(start, cursor);
        assert.ok(Math.abs(angleDegrees(start, point) - expected) < 1e-9, `${expected} degrees`);
    });
});

test('without Shift the world-coordinate cursor remains unchanged', () => {
    const cursor = { x: 31.25, y: -9.75 };
    assert.deepEqual(snap({ x: 4, y: 8 }, cursor, false), cursor);
});

test('preview and committed point use the same last-vertex snapping path', () => {
    const click = source.slice(source.indexOf("konvaStage.on('click tap'"), source.indexOf("konvaStage.on('dblclick dbltap'"));
    const move = source.slice(source.indexOf("konvaStage.on('mousemove touchmove'"), source.indexOf('function renderShell'));
    assert.match(click, /const world = screenToWorld\(pos\)[\s\S]*addLinearPoint\(linearPointForPointer\(world/);
    assert.match(move, /const world = screenToWorld\(pos\)[\s\S]*renderLinearPreview\(world, linearShiftPressed\)/);
    const pointer = source.slice(source.indexOf('function linearPointForPointer'), source.indexOf('function renderLinearPreview'));
    assert.match(pointer, /points\[points\.length - 1\]/);
});

test('pressing and releasing Shift refreshes an in-progress preview immediately', () => {
    const keyboard = source.slice(source.indexOf("window.addEventListener('keydown'"), source.indexOf('window.projectTakeoffCopySelection'));
    assert.match(keyboard, /e\.key === 'Shift'[\s\S]*linearShiftPressed = true[\s\S]*renderLinearPreview\(\)/);
    assert.match(keyboard, /addEventListener\('keyup'[\s\S]*linearShiftPressed = false[\s\S]*renderLinearPreview\(\)/);
});
