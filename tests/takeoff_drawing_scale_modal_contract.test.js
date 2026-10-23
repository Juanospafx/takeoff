const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'assets/global_tools.css'), 'utf8');
const globalTools = fs.readFileSync(path.join(root, 'assets/global_tools.js'), 'utf8');
const takeoff = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');

assert.match(css, /UNIFIED PRO CUSTOM DROPDOWN \/ SELECT SYSTEM/,
    'the shared custom-select system from the accepted source commit must exist');
assert.match(css, /\.pro-custom-dropdown\.cc-custom-select[\s\S]*?display:\s*block/,
    'enhanced selects must have a positioned visible wrapper');
assert.match(css, /\.pro-custom-dropdown-menu\.pcd-select-menu[\s\S]*?display:\s*none/,
    'the custom menu must be styled and closed by default');
assert.match(css, /\.pro-custom-dropdown\.is-open \.pro-custom-dropdown-menu\.pcd-select-menu\s*\{[\s\S]*?display:\s*block/,
    'the custom menu must become visible when its wrapper opens');
assert.match(css, /\.pro-scale-panel \.cc-custom-select \.pro-custom-dropdown-trigger\s*\{[\s\S]*?height:\s*28px[\s\S]*?font-size:\s*0\.76rem[\s\S]*?padding:\s*0 8px/,
    'Drawing Scale dropdown triggers must match the accepted compact design');
assert.match(css, /\.pro-scale-panel \.cc-custom-select\s*\{[\s\S]*?margin-bottom:\s*6px/,
    'Drawing Scale dropdowns must retain the accepted vertical rhythm');
assert.match(css, /body\.theme-dark \.pcd-select-item\.is-selected[\s\S]*?color:\s*#fb5a3a/,
    'selected options must remain legible in dark mode');

assert.match(globalTools, /function initCustomSelects\(root = document\)[\s\S]*?selects\.forEach\(enhanceSelect\)/,
    'the existing select enhancer must remain enabled');
assert.match(takeoff, /function openScalePanel\(mode\)[\s\S]*?if \(!requireWrite\(\)\) return false;/,
    'Drawing Scale must preserve the existing write guard');

console.log('Takeoff Drawing Scale modal contract: PASS');
