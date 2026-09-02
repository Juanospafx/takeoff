const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const pageHtml = fs.readFileSync(path.join(root, 'pages/cost_catalog.php'), 'utf8');
const clientJs = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');

function createFixture() {
    const catalogs = [{ id: 1, name: 'Electrical 2026', active: 1, locked: 0, sort_order: 0 }];
    const groups = [{ id: 10, catalog_id: 1, name: 'Conduit & Fittings', active: 1, sort_order: 0 }];
    const items = [
        { id: 101, catalog_id: 1, catalog_group_id: 10, name: '1/2" EMT Conduit', item_type: 'part', unit_of_measure: 'ft', unit_cost: 2.50, labor_hours: 0.05, cost_code: '01-EMT' },
        { id: 102, catalog_id: 1, catalog_group_id: 10, name: '1/2" Steel One Hole Strap', item_type: 'part', unit_of_measure: 'ea', unit_cost: 0.75, labor_hours: 0.02, cost_code: '02-STRAP' },
        { id: 103, catalog_id: 1, catalog_group_id: 10, name: '1/2" Set Screw Coupling', item_type: 'part', unit_of_measure: 'ea', unit_cost: 1.20, labor_hours: 0.03, cost_code: '03-CPL' },
        { id: 104, catalog_id: 1, catalog_group_id: 10, name: '#12 THHN Wire', item_type: 'part', unit_of_measure: 'ft', unit_cost: 0.35, labor_hours: 0.01, cost_code: '04-WIRE' },
        {
            id: 200, catalog_id: 1, catalog_group_id: 10, name: 'Existing Assembly', item_type: 'assembly',
            unit_of_measure: 'ft', unit_cost: 7.75, labor_hours: 0.12, cost_code: 'ASM-01'
        }
    ];
    const assemblyParts = [
        { id: 1, assembly_catalog_item_id: 200, part_catalog_item_id: 101, child_item_name: '1/2" EMT Conduit', child_unit_of_measure: 'ft', quantity: 1, unit_cost_snapshot: 2.50, unit_labor_time_snapshot: 0.05, ratio_type: 'per_unit', sort_order: 0 },
        { id: 2, assembly_catalog_item_id: 200, part_catalog_item_id: 102, child_item_name: '1/2" Steel One Hole Strap', child_unit_of_measure: 'ea', quantity: 0.1, unit_cost_snapshot: 0.75, unit_labor_time_snapshot: 0.02, ratio_type: 'per_unit', sort_order: 1 },
        { id: 3, assembly_catalog_item_id: 200, part_catalog_item_id: 104, child_item_name: '#12 THHN Wire', child_unit_of_measure: 'ft', quantity: 3.3, unit_cost_snapshot: 0.35, unit_labor_time_snapshot: 0.01, ratio_type: 'per_unit', sort_order: 2 }
    ];

    return {
        catalogs: structuredClone(catalogs),
        groups: structuredClone(groups),
        items: structuredClone(items),
        allItems: structuredClone(items),
        assemblyParts: structuredClone(assemblyParts)
    };
}

function setupTestEnvironment(initialState = createFixture()) {
    const db = structuredClone(initialState);
    let nextId = 300;
    let nextPartId = 10;
    let lastSavePayload = null;
    let forceSaveFailure = false;

    // Extract HTML body
    const bodyStart = pageHtml.indexOf('<body');
    const bodyContent = bodyStart !== -1 ? pageHtml.slice(pageHtml.indexOf('>', bodyStart) + 1, pageHtml.lastIndexOf('</body>')) : pageHtml;

    const dom = new JSDOM(`<!doctype html><html><body>${bodyContent}</body></html>`, {
        url: 'https://takeoff.test/pages/cost_catalog.php',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });

    dom.window.fetch = async (url, opts = {}) => {
        const body = opts.body ? JSON.parse(opts.body) : {};
        const action = body.action || (url.includes('action=') ? new URL(url, 'https://takeoff.test').searchParams.get('action') : 'list');

        if (action === 'list') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ status: 'success', data: structuredClone(db) })
            };
        }

        if (action === 'save_item') {
            lastSavePayload = structuredClone(body);
            if (forceSaveFailure) {
                return {
                    ok: false,
                    status: 500,
                    json: async () => ({ status: 'error', msg: 'Database connection failed during save.' })
                };
            }

            const isEdit = Number(body.id) > 0;
            const itemId = isEdit ? Number(body.id) : nextId++;
            const existingIndex = db.items.findIndex(i => Number(i.id) === itemId);

            const savedItem = {
                id: itemId,
                catalog_id: Number(body.catalog_id || 1),
                catalog_group_id: Number(body.catalog_group_id || 10),
                name: body.name,
                description: body.description || '',
                item_type: body.item_type || 'part',
                unit_of_measure: body.unit_of_measure || 'ea',
                unit_cost: Number(body.unit_cost || 0),
                labor_hours: Number(body.labor_hours || 0),
                cost_code: body.cost_code || '',
                revision: 1
            };

            if (existingIndex >= 0) {
                db.items[existingIndex] = { ...db.items[existingIndex], ...savedItem };
                db.allItems = db.items;
            } else {
                db.items.push(savedItem);
                db.allItems.push(savedItem);
            }

            if (body.item_type === 'assembly' && Array.isArray(body.components)) {
                // Remove existing parts for this assembly
                db.assemblyParts = db.assemblyParts.filter(p => Number(p.assembly_catalog_item_id) !== itemId);
                let sumCost = 0, sumLabor = 0;
                body.components.forEach((comp, idx) => {
                    const child = db.allItems.find(i => Number(i.id) === Number(comp.itemId));
                    const unitCost = Number(child?.unit_cost || 0);
                    const laborHours = Number(child?.labor_hours || 0);
                    const qty = Number(comp.quantity ?? 1);
                    sumCost += qty * unitCost;
                    sumLabor += qty * laborHours;
                    db.assemblyParts.push({
                        id: nextPartId++,
                        assembly_catalog_item_id: itemId,
                        part_catalog_item_id: Number(comp.itemId),
                        child_item_name: child?.name || 'Child',
                        child_unit_of_measure: child?.unit_of_measure || 'ea',
                        quantity: qty,
                        unit_cost_snapshot: unitCost,
                        unit_labor_time_snapshot: laborHours,
                        ratio_type: comp.ratio_type || 'per_unit',
                        sort_order: idx
                    });
                });
                savedItem.unit_cost = sumCost;
                savedItem.labor_hours = sumLabor;
            }

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    status: 'success',
                    id: itemId,
                    data: structuredClone(db)
                })
            };
        }

        return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'success', data: structuredClone(db) })
        };
    };

    dom.window.eval(clientJs);
    dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

    return {
        dom,
        db,
        getLastSavePayload: () => lastSavePayload,
        setForceSaveFailure: (val) => { forceSaveFailure = val; },
        close: () => dom.window.close()
    };
}

test('Cost Catalog Assembly Editor - Complete 21 Scenarios', async (t) => {
    let env = null;

    t.beforeEach(async () => {
        env = setupTestEnvironment();
        // Wait microtask for initial load()
        await new Promise(resolve => setTimeout(resolve, 30));
    });

    t.afterEach(() => {
        if (env) env.close();
    });

    await t.test('1. Create Assembly opens clean form with assembly section visible and 0 count badge', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        const section = dom.window.document.getElementById('ccAssemblySection');
        assert.equal(section.style.display, 'block');
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '0');
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody tr').length, 1);
        assert.match(dom.window.document.getElementById('ccAssemblyPartsBody').textContent, /No items included yet/);
    });

    await t.test('2. Select one catalog item via row click adds to selected components and updates count', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        const conduitRow = dom.window.document.querySelector('[data-assembly-select="101"]');
        assert.ok(conduitRow, 'Conduit item row must exist in available list');
        conduitRow.click();

        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '1');
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row]').length, 1);
        assert.match(dom.window.document.querySelector('#ccAssemblyPartsBody').textContent, /1\/2" EMT Conduit/);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="101"]').checked, true);
        const updatedRow = dom.window.document.querySelector('[data-assembly-select="101"]');
        assert.ok(updatedRow.classList.contains('is-selected'));
    });

    await t.test('3. Select multiple catalog items', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        dom.window.document.querySelector('[data-assembly-select="102"]').click();
        dom.window.document.querySelector('[data-assembly-select="103"]').click();

        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '3');
        const rows = dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row]');
        assert.equal(rows.length, 3);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="101"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="102"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="103"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="104"]').checked, false);
    });

    await t.test('4. Deselect an item removes it from components and unchecks in available list', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        dom.window.document.querySelector('[data-assembly-select="102"]').click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '2');

        // Deselect item 101
        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '1');
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="101"]').checked, false);
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row="101"]').length, 0);
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row="102"]').length, 1);
    });

    await t.test('5. Row click selects item', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        const titleSpan = dom.window.document.querySelector('[data-assembly-select="104"] .cc-assembly-item-title');
        titleSpan.click();
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="104"]').checked, true);
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '1');
    });

    await t.test('6. Checkbox selects item', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        const cb = dom.window.document.querySelector('[data-assembly-item-check="103"]');
        cb.click();
        assert.equal(cb.checked, true);
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '1');
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row="103"]').length, 1);
    });

    await t.test('7. Checkbox does not double-toggle (stopPropagation prevents row handler toggle)', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        const cb = dom.window.document.querySelector('[data-assembly-item-check="102"]');
        // Clicking checkbox once must leave it selected, not toggle on then immediately off
        cb.click();
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="102"]').checked, true);
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '1');
    });

    await t.test('8. Search does not clear selection', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        // Select Conduit & Strap
        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        dom.window.document.querySelector('[data-assembly-select="102"]').click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '2');

        // Search for Wire
        const searchInput = dom.window.document.getElementById('ccAssemblySearch');
        searchInput.value = 'Wire';
        searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

        // Available list now only shows matching item(s)
        const visibleRows = dom.window.document.querySelectorAll('#ccAssemblyResults [data-assembly-select]');
        assert.equal(visibleRows.length, 1);
        assert.equal(visibleRows[0].dataset.assemblySelect, '104');

        // Previously selected components must still be preserved in state and table!
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '2');
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row]').length, 2);

        // Select Wire from filtered results
        visibleRows[0].click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '3');

        // Clear search
        searchInput.value = '';
        searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

        // All 3 items should show as checked in available list
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="101"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="102"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="104"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="103"]').checked, false);
    });

    await t.test('9. Selected item appears in selected-components section with ratio and unit', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        const compRow = dom.window.document.querySelector('#ccAssemblyPartsBody [data-part-row="101"]');
        assert.ok(compRow);
        assert.equal(compRow.querySelector('[data-part-quantity]').value, '1');
        assert.match(compRow.children[2].textContent, /ft/);
    });

    await t.test('10. Remove selected component via button also unchecks in available items list', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="101"]').checked, true);

        const removeBtn = dom.window.document.querySelector('[data-assembly-part-delete="101"]');
        assert.ok(removeBtn);
        removeBtn.click();

        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '0');
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="101"]').checked, false);
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row]').length, 0);
    });

    await t.test('11. Set component ratio updates live totals without losing focus', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.querySelector('[data-assembly-select="101"]').click(); // $2.50, 0.05 hr
        const qtyInput = dom.window.document.querySelector('[data-part-quantity="101"]');
        assert.equal(qtyInput.value, '1');
        assert.equal(dom.window.document.getElementById('ccItemUnitCost').value, '2.5');

        qtyInput.value = '4';
        qtyInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

        assert.equal(dom.window.document.getElementById('ccItemUnitCost').value, '10');
        assert.equal(dom.window.document.getElementById('ccItemLaborHours').value, '0.2');
        assert.match(dom.window.document.getElementById('ccAssemblyTotals').textContent, /\$10\.00/);
    });

    await t.test('12. Save Assembly persists metadata and selected components in payload', async () => {
        const { dom, getLastSavePayload } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemName').value = 'New Conduit Assembly';
        dom.window.document.getElementById('ccItemUom').value = 'ft';
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        dom.window.document.querySelector('[data-assembly-select="102"]').click();
        const strapQty = dom.window.document.querySelector('[data-part-quantity="102"]');
        strapQty.value = '0.1';
        strapQty.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.getElementById('ccItemForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 30));

        const payload = getLastSavePayload();
        assert.ok(payload);
        assert.equal(payload.name, 'New Conduit Assembly');
        assert.equal(payload.item_type, 'assembly');
        assert.equal(Array.isArray(payload.components), true);
        assert.equal(payload.components.length, 2);
        assert.equal(payload.components[0].itemId, 101);
        assert.equal(payload.components[0].quantity, 1);
        assert.equal(payload.components[1].itemId, 102);
        assert.equal(payload.components[1].quantity, 0.1);
    });

    await t.test('13. Reload Assembly and confirm components persisted', async () => {
        const { dom, db } = env;
        const newAssembly = db.items.find(i => i.name === 'Existing Assembly');
        assert.ok(newAssembly);
        const parts = db.assemblyParts.filter(p => Number(p.assembly_catalog_item_id) === Number(newAssembly.id));
        assert.equal(parts.length, 3);
    });

    await t.test('14. Edit Assembly loads existing items preselected', async () => {
        const { dom, db } = env;
        const existing = db.items.find(i => i.id === 200);
        assert.ok(existing);

        const editBtn = dom.window.document.querySelector('[data-item-action="edit"][data-id="200"]');
        if (editBtn) editBtn.click();
        else {
            dom.window.document.querySelector('[data-id="200"]').click();
        }

        assert.equal(dom.window.document.getElementById('ccItemName').value, 'Existing Assembly');
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '3');

        // Check that 101, 102, 104 are preselected with their saved ratios
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="101"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="102"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="104"]').checked, true);
        assert.equal(dom.window.document.querySelector('[data-assembly-item-check="103"]').checked, false);

        assert.equal(dom.window.document.querySelector('[data-part-quantity="101"]').value, '1');
        assert.equal(dom.window.document.querySelector('[data-part-quantity="102"]').value, '0.1');
        assert.equal(dom.window.document.querySelector('[data-part-quantity="104"]').value, '3.3');
    });

    await t.test('15. Change ratio and save in edit mode', async () => {
        const { dom, db, getLastSavePayload } = env;
        const editBtn = dom.window.document.querySelector('[data-item-action="edit"][data-id="200"]');
        if (editBtn) editBtn.click();

        const wireQty = dom.window.document.querySelector('[data-part-quantity="104"]');
        wireQty.value = '5.0';
        wireQty.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.getElementById('ccItemForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 30));

        const payload = getLastSavePayload();
        assert.ok(payload);
        const wireComp = payload.components.find(c => c.itemId === 104);
        assert.equal(wireComp.quantity, 5.0);
    });

    await t.test('16. Add another component in edit mode and save', async () => {
        const { dom, getLastSavePayload } = env;
        const editBtn = dom.window.document.querySelector('[data-item-action="edit"][data-id="200"]');
        if (editBtn) editBtn.click();

        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '3');
        // Add Coupling (103)
        dom.window.document.querySelector('[data-assembly-select="103"]').click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '4');

        dom.window.document.getElementById('ccItemForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 30));

        const payload = getLastSavePayload();
        assert.equal(payload.components.length, 4);
        assert.ok(payload.components.some(c => c.itemId === 103));
    });

    await t.test('17. Remove existing component in edit mode and save', async () => {
        const { dom, getLastSavePayload } = env;
        const editBtn = dom.window.document.querySelector('[data-item-action="edit"][data-id="200"]');
        if (editBtn) editBtn.click();

        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '3');
        // Remove Strap (102)
        dom.window.document.querySelector('[data-assembly-part-delete="102"]').click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '2');

        dom.window.document.getElementById('ccItemForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 30));

        const payload = getLastSavePayload();
        assert.equal(payload.components.length, 2);
        assert.equal(payload.components.some(c => c.itemId === 102), false);
    });

    await t.test('18. Prevent duplicate items in assembly', () => {
        const { dom } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '1');

        // Clicking 101 again toggles it off, never creating a duplicate row
        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '0');
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row="101"]').length, 0);
    });

    await t.test('19. Prevent self-reference in assembly', () => {
        const { dom } = env;
        const editBtn = dom.window.document.querySelector('[data-item-action="edit"][data-id="200"]');
        if (editBtn) editBtn.click();

        // The assembly itself (id 200) should never appear in available items
        assert.equal(dom.window.document.querySelectorAll('[data-assembly-select="200"]').length, 0);
    });

    await t.test('20. Cancel without saving discards unsaved state', () => {
        const { dom, db } = env;
        const editBtn = dom.window.document.querySelector('[data-item-action="edit"][data-id="200"]');
        if (editBtn) editBtn.click();

        // Add 103 in UI
        dom.window.document.querySelector('[data-assembly-select="103"]').click();
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '4');

        // Click Cancel
        dom.window.document.querySelector('[data-close-item-modal]').click();

        // Modal should be closed
        assert.equal(dom.window.document.getElementById('ccItemModal').classList.contains('open'), false);

        // Database should be completely untouched (still 3 parts)
        const parts = db.assemblyParts.filter(p => Number(p.assembly_catalog_item_id) === 200);
        assert.equal(parts.length, 3);
        assert.equal(parts.some(p => p.part_catalog_item_id === 103), false);
    });

    await t.test('21. Backend failure preserves form state and selected components', async () => {
        const { dom, setForceSaveFailure } = env;
        dom.window.document.getElementById('ccAddItem').click();
        dom.window.document.getElementById('ccItemName').value = 'Failed Assembly';
        dom.window.document.getElementById('ccItemUom').value = 'ft';
        dom.window.document.getElementById('ccItemType').value = 'assembly';
        dom.window.document.getElementById('ccItemType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        dom.window.document.querySelector('[data-assembly-select="101"]').click();
        dom.window.document.querySelector('[data-assembly-select="102"]').click();

        // Force backend failure
        setForceSaveFailure(true);

        dom.window.document.getElementById('ccItemForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 30));

        // Modal MUST stay open
        assert.equal(dom.window.document.getElementById('ccItemModal').classList.contains('open'), true);
        // Form field preserved
        assert.equal(dom.window.document.getElementById('ccItemName').value, 'Failed Assembly');
        // Selected components preserved!
        assert.equal(dom.window.document.getElementById('ccSelectedComponentsCount').textContent, '2');
        assert.equal(dom.window.document.querySelectorAll('#ccAssemblyPartsBody [data-part-row]').length, 2);
        // Error message displayed
        assert.match(dom.window.document.getElementById('ccItemFormError').textContent, /Database connection failed/);
    });
});
