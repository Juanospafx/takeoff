const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const globalTools = read('assets/global_tools.js');
const takeoffJs = read('assets/project_takeoff.js');
const takeoffCss = read('assets/project_takeoff.css');
const dashboard = read('pages/project_dashboard.php');

assert.match(globalTools, /function closeAllOpenPopouts\(exceptElement = null\)/,
    'global popout exclusivity helper must exist');
assert.match(globalTools, /window\.closeAllOpenPopouts = closeAllOpenPopouts/,
    'global popout exclusivity helper must be exported');
assert.match(globalTools, /selectEl\.closest\('\.pro-create-layer-modal'\)/,
    'Create Layer native selects must not be replaced by the global enhancer');
assert.match(globalTools, /selectEl\.closest\('\.pro-layer-modal'\)/,
    'Edit Layer native selects must not be replaced by the global enhancer');

assert.match(dashboard, /<aside class="pro-layer-drawer" id="takeoffLayerModal"[^>]*hidden><\/aside>/,
    'dashboard must provide the source drawer container');
assert.match(takeoffJs, /modal\.className = 'pro-layer-drawer'/,
    'Edit Layer must render as the source side drawer');
assert.match(takeoffJs, /function repositionLayerModal\(\)/,
    'drawer must reposition with the responsive workspace');
assert.match(takeoffJs, /window\.closeAllOpenPopouts\(\)/,
    'Takeoff must close competing popouts before opening another');
assert.match(takeoffCss, /\.pro-takeoff-workspace:not\(\.has-layer-drawer\) #takeoffLayerModal\.pro-layer-drawer/,
    'drawer visibility must be tied to workspace state');
assert.match(takeoffCss, /@media \(max-width: 768px\)[\s\S]*#takeoffLayerModal\.pro-layer-popout-backdrop/,
    'drawer must retain the source responsive mobile presentation');

console.log('Takeoff modal source fidelity contract: PASS');
