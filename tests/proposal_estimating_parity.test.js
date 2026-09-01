const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const proposal = fs.readFileSync(path.join(root, 'assets', 'project_proposal.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');

test('Proposal uses the canonical Estimating calculator for rows and final totals', () => {
    assert.match(proposal, /window\.EstimateCalculationService/);
    assert.match(proposal, /calculator\.calculateSummary\(estimate\.groups \|\| \[\], estimate\.settings \|\| \{\}\)/);
    assert.match(proposal, /material: num\(canonical\.direct\?\.materialSales\)/);
    assert.match(proposal, /total: num\(canonical\.estimateTotal\)/);
    assert.match(proposal, /row\.calc\.totalSales/);
    assert.ok(dashboard.indexOf('estimate_calculation_service.js') < dashboard.indexOf('project_proposal.js'),
        'the canonical calculator must load before Proposal');
});

test('Proposal formats customer quantities as whole numbers without changing raw totals', () => {
    assert.match(proposal, /QuantityFormatService\.proposal\(item\.quantity\)/);
    assert.match(proposal, /const quantity = num\(item\.quantity \?\? item\.qty\)/);
    assert.match(proposal, /quantity \* unitCost/);
    assert.ok(dashboard.indexOf('quantity_format_service.js') < dashboard.indexOf('project_proposal.js'));
});

test('Proposal shows estimate items by default and expands assembly detail without double counting', () => {
    assert.match(proposal, /schemaVersion: 2/);
    assert.match(proposal, /groupsOnly: false/);
    assert.match(proposal, /assemblyItems: true/);
    assert.match(proposal, /!saved\.schemaVersion[\s\S]*migrated\.groupsOnly = false/);
    assert.match(proposal, /item\.isAssemblyChild \? 0 : num\(item\.total\)/);
    assert.match(proposal, /if \(!proposalSettings\.groupsOnly\)/);
});
