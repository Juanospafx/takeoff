const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parentJs = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_takeoff.js'), 'utf8');

test('the drawing selector reconciles stale one-page metadata with the embedded PDF', () => {
    const ensureStart = parentJs.indexOf('async function ensurePageCount');
    const ensureEnd = parentJs.indexOf('const TAKEOFF_TYPES', ensureStart);
    const ensurePageCount = parentJs.slice(ensureStart, ensureEnd);

    assert.ok(ensureStart >= 0 && ensureEnd > ensureStart);
    assert.ok(ensurePageCount.indexOf("callEditor('takeoffGetDocumentInfo')")
        < ensurePageCount.indexOf('if (doc.pageCount) return doc.pageCount'));
    assert.match(parentJs, /takeoff-editor-ready[\s\S]*syncResolvedPageCountToState\(doc, totalPages\)/);
    assert.match(parentJs, /if \(doc && doc\.extension === 'pdf'\) \{\s*ensurePageCount\(doc\)/);
});
