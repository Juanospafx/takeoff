const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const Quantity = require('../assets/quantity_format_service.js');
const estimating = fs.readFileSync(path.join(root, 'assets', 'project_estimating.js'), 'utf8');
const proposal = fs.readFileSync(path.join(root, 'assets', 'project_proposal.js'), 'utf8');
const takeoff = fs.readFileSync(path.join(root, 'assets', 'editor', 'takeoff.js'), 'utf8');

test('Estimating displays at most two decimals without unnecessary trailing zeros', () => {
    assert.equal(Quantity.estimating(12.674819), '12.67');
    assert.equal(Quantity.estimating(8), '8');
    assert.equal(Quantity.estimating(8.5), '8.5');
    assert.equal(Quantity.estimating(8.567), '8.57');
});

test('Proposal rounds customer quantities to the nearest whole number', () => {
    assert.equal(Quantity.proposal(12.49), '12');
    assert.equal(Quantity.proposal(12.5), '13');
    assert.equal(Quantity.proposal(12.67), '13');
    assert.equal(Quantity.proposal(5), '5');
    assert.equal(Quantity.proposal(4.5), '5');
});

test('count quantities remain integer displays in both contexts', () => {
    assert.equal(Quantity.estimating(5), '5');
    assert.equal(Quantity.proposal(5), '5');
});

test('formatting is presentation-only and calculations retain raw quantity', () => {
    const rawQuantity = 12.674819;
    const unitPrice = 7.25;
    assert.equal(rawQuantity * unitPrice, 91.89243775);
    assert.equal(Quantity.estimating(rawQuantity), '12.67');
    assert.equal(Quantity.proposal(rawQuantity), '13');
    assert.match(estimating, /QuantityFormatService\.estimating\(item\[key\]\)/);
    assert.match(proposal, /QuantityFormatService\.proposal\(item\.quantity\)/);
    assert.doesNotMatch(takeoff, /QuantityFormatService/);
});

test('Proposal print uses the same formatted item table as browser preview', () => {
    assert.match(proposal, /button\.dataset\.proposalExport === 'preview'\) return window\.print\(\)/);
    assert.match(proposal, /function renderItemTable[\s\S]*QuantityFormatService\.proposal/);
});
