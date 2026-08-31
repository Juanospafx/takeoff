const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');
const js = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'project_takeoff.css'), 'utf8');

test('one Takeoff group owns the same estimating identity before publishing', () => {
    assert.match(js, /const estimatingGroupId = `takeoff_group_\$\{id\}`/);
    assert.match(js, /const group = \{ id, estimatingGroupId, estimateId/);
    assert.match(js, /group: \{ id: estimatingGroupId, takeoffGroupId: group\.id/);
});

test('create group uses an accessible branded dialog instead of a prompt', () => {
    assert.match(page, /id="takeoffGroupModal"/);
    assert.match(page, /role="dialog" aria-modal="true"/);
    assert.match(page, /label class="pro-group-field" for="takeoffGroupName"/);
    assert.doesNotMatch(js, /prompt\('Group name'/);
    assert.match(js, /openTakeoffGroupModal/);
    assert.match(js, /submitTakeoffGroupModal/);
});

test('group dialog validates duplicate names and manages keyboard focus', () => {
    assert.match(js, /A group with this name already exists in this estimate/);
    assert.match(js, /event\.key === 'Escape'[\s\S]*closeTakeoffGroupModal/);
    assert.match(js, /event\.key === 'Tab'/);
    assert.match(js, /takeoffGroupModalReturnFocus/);
    assert.match(css, /\.pro-group-field input:focus/);
    assert.match(css, /@media \(max-width: 430px\)[\s\S]*\.pro-group-modal/);
    assert.match(css, /\[data-theme="dark"\] \.pro-group-dialog/);
});
