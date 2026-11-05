const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_estimating.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'project_estimating.css'), 'utf8');

for (const contract of [
    'est-search-box', 'est-toolbar-actions', 'est-icon-btn', 'optionsMenu', 'estSplitResizer',
    'est-toggle-right-btn', 'est-total-label', 'bb-table-scroll', 'est-save-status'
]) assert.match(js, new RegExp(contract), `design contract includes ${contract}`);

assert.match(js, /data-est-action="fullscreen"/, 'fullscreen control is wired');
assert.match(js, /data-est-action="toggle-right"/, 'summary collapse control is wired');
assert.match(js, /takeoff\.estimatingRightWidth/, 'summary width is persisted');
assert.match(css, /@media\s*\(max-width:\s*(?:720|820|860)px\)/, 'tablet/mobile breakpoint exists');
assert.match(css, /\.est-toolbar-actions/, 'toolbar action system is styled');
assert.match(css, /\.est-table-wrap\.bb-table-scroll/, 'dense table scroll surface is styled');
assert.match(css, /prefers-reduced-motion/, 'reduced motion is respected');

console.log('estimating design port contract passed');
