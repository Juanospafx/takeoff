const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api/cost_catalog.php'), 'utf8');
const service = fs.readFileSync(path.join(root, 'assets/catalog_service.js'), 'utf8');
const takeoff = fs.readFileSync(path.join(root, 'assets/project_takeoff.js'), 'utf8');
const estimating = fs.readFileSync(path.join(root, 'assets/project_estimating.js'), 'utf8');

test('API advertises and validates admin, active and project availability modes', () => {
    assert.match(api, /\['admin', 'active', 'project'\]/);
    assert.match(api, /availabilityFiltering'=>true/);
    assert.match(api, /'revisioning'=>\$revisioning/);
    assert.match(api, /\$availability === 'admin' && \$includeDeleted/);
});

test('project SQL enforces catalog, complete category ancestry and effective cost book availability', () => {
    assert.match(api, /WITH RECURSIVE group_availability/);
    assert.match(api, /parent\.available=1/);
    assert.match(api, /c\.enabled_for_projects=1/);
    assert.match(api, /ci\.active=1/);
    assert.match(api, /cc\.effective_from<=CURRENT_DATE/);
    assert.match(api, /cc\.effective_to>=CURRENT_DATE/);
});

test('blocked project assemblies expose reasons and are excluded with their components', () => {
    assert.match(api, /'availability'=>'blocked','unavailableComponentIds'/);
    assert.match(api, /projectAssemblies'=>'exclude_blocked'/);
    assert.match(api, /array_filter\(\$allItems[\s\S]*\$blocked/);
});

test('read service and project consumers request explicit availability', () => {
    assert.match(service, /options\.enabledForProjectsOnly\) return 'project'/);
    assert.match(service, /options\.activeOnly\) return 'active'/);
    assert.doesNotMatch(service, /UNSUPPORTED_AVAILABILITY_FILTER/);
    assert.match(takeoff, /CatalogService\.getSnapshot\(\{ enabledForProjectsOnly: true \}\)/);
    assert.ok((estimating.match(/CatalogService\.getSnapshot\(\{ enabledForProjectsOnly: true \}\)/g) || []).length >= 2);
});
