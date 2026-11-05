const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8');
const estimating = read('assets/project_estimating.js');
const estimatingCss = read('assets/project_estimating.css');
const calculator = read('assets/estimate_calculation_service.js');
const takeoff = read('assets/project_takeoff.js');
const takeoffCss = read('assets/project_takeoff.css');

for (const [label, source, marker] of [
  ['labor waste column', estimating, "data-item-field=\"laborWaste\""],
  ['difficulty factor column', estimating, "data-item-field=\"difficulty\""],
  ['discount operator UI', estimating, "Subtract (- Discount)"],
  ['assembly formula control', estimating, 'data-assembly-calc-btn'],
  ['manual override styling', estimatingCss, 'is-val-overridden'],
  ['catalog update dialog', estimatingCss, '.est-cu-dialog'],
  ['calculator labor waste', calculator, 'laborWastePercent'],
  ['calculator subtract markup', calculator, "operator === 'subtract'"],
  ['takeoff difficulty persistence', takeoff, "estimating:item-difficulty-updated"],
  ['takeoff override badge', takeoffCss, '.pro-tree-qty-override-badge'],
]) {
  assert(source.includes(marker), `missing ${label}: ${marker}`);
}

for (const path of [
  'api/project_estimating.php',
  'assets/estimate_calculation_service.js',
  'assets/estimating_assembly_expansion_adapter.js',
  'assets/global_tools.js',
  'assets/project_estimating.css',
  'assets/project_estimating.js',
  'assets/project_takeoff.css',
  'assets/project_takeoff.js',
]) {
  const source = read(path);
  assert(!source.includes('<<<<<<<'), `${path} retains a merge conflict`);
  assert(!source.includes('>>>>>>>'), `${path} retains a merge conflict`);
}

console.log('complete Estimating commit integration contract passed');
