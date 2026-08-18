const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.resolve(__dirname, '../api/project_estimating.php'), 'utf8');
const saveStart = api.indexOf("if ($action === 'save')");
const saveEnd = api.indexOf("if ($action === 'delete')", saveStart);
const save = api.slice(saveStart, saveEnd);

test('A: PATCH writes only received updates and preserves unrelated estimates', () => {
    assert.match(save, /\$mode = .*\$body\['partial'\].*\? 'patch' : 'replace'/);
    assert.match(save, /\$patchRows = isset\(\$body\['updates'\]\)/);
    assert.match(save, /foreach \(\$incoming as \$estimate\)/);
    assert.match(save, /if \(\$mode === 'replace' && \$workspace && \$keptIds\)/,
        'omission deletion must be unreachable from PATCH');
});

test('B: independent estimate PATCH requests use canonical lock order', () => {
    assert.match(save, /usort\(\$incoming[\s\S]*strcmp/);
    assert.match(save, /return strcmp\([\s\S]*\['id'\]/);
});

test('C: a stale client PATCH cannot delete a concurrently-created estimate', () => {
    const patchBranch = save.slice(save.indexOf("if ($mode === 'patch')"), save.indexOf('} else {', save.indexOf("if ($mode === 'patch')")));
    assert.doesNotMatch(patchBranch, /deleted_at|NOT IN|keptIds/);
    assert.match(save, /if \(\$mode === 'replace'[\s\S]*SET e\.deleted_at=CURRENT_TIMESTAMP/);
});

test('same-estimate stale revision rolls back explicitly and returns structured 409', () => {
    assert.match(api, /class PewRevisionConflict extends RuntimeException/);
    assert.match(api, /throw new PewRevisionConflict\([\s\S]*expectedRevision[\s\S]*currentRevision[\s\S]*current/);
    const conflictCatch = api.slice(api.indexOf('catch (PewRevisionConflict'));
    assert.match(conflictCatch, /inTransaction\(\)\) \$pdo->rollBack\(\)/);
    assert.match(conflictCatch, /'code' => 'revision_conflict'/);
    assert.match(conflictCatch, /'conflicts' => \$e->conflicts/);
    assert.match(conflictCatch, /\), 409\)/);
});

test('replace mode remains the compatibility default for initial workspace migration', () => {
    assert.match(save, /\$mode = .*\$body\['partial'\].*\? 'patch' : 'replace'/);
    assert.match(save, /\$workspace.*\$workspace\['estimates'\]/s);
    assert.match(save, /if \(\$workspace\)[\s\S]*\$workspace\['estimates'\] = \$savedEstimates/);
});
