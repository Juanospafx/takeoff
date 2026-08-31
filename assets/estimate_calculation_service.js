(function (global) {
    const AssemblyAdapter = global.EstimatingAssemblyExpansionAdapter
        || (typeof require === 'function' ? require('./estimating_assembly_expansion_adapter.js') : null);
    function num(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clampMargin(value) {
        return Math.min(99.999999, Math.max(-999, num(value)));
    }

    function salesFromCost(cost, rate, mode = 'margin') {
        const c = num(cost);
        const r = num(rate) / 100;
        if (!c) return 0;
        if (mode === 'markup') return c * (1 + r);
        return r >= 1 ? c : c / (1 - r);
    }

    function emptyTotals() {
        return {
            baseQuantity: 0,
            wasteQuantity: 0,
            adjustedQuantity: 0,
            materialCost: 0,
            materialSales: 0,
            equipmentCost: 0,
            equipmentSales: 0,
            baseLaborHours: 0,
            adjustedLaborHours: 0,
            laborCost: 0,
            laborSales: 0,
            totalCost: 0,
            totalSales: 0,
            profit: 0,
            marginPercent: 0
        };
    }

    function addTotals(a, b) {
        const result = emptyTotals();
        Object.keys(result).forEach(key => {
            result[key] = num(a?.[key]) + num(b?.[key]);
        });
        result.profit = result.totalSales - result.totalCost;
        result.marginPercent = result.totalSales ? (result.profit / result.totalSales) * 100 : 0;
        return result;
    }

    function unitLaborHours(item) {
        const unit = String(item.laborUnitType || item.laborUnit || 'mins').toLowerCase();
        const value = num(item.unitLabor);
        return unit.includes('hr') ? value : value / 60;
    }

    function isAssembly(item) {
        return item?.isAssembly === true || String(item?.itemType ?? item?.item_type ?? '').toLowerCase() === 'assembly';
    }

    function calculatePart(item, settings = {}) {
        const quantity = num(item.quantity);
        const wastePercent = Math.max(0, num(item.waste));
        const adjustedQuantity = quantity * (1 + wastePercent / 100);
        const materialCost = adjustedQuantity * num(item.unitMaterialCost ?? item.unitCost);
        const materialMargin = num(item.materialMargin ?? item.margin);
        const equipmentMargin = num(item.equipmentMargin);
        const laborMargin = num(item.laborMargin ?? settings.globalLaborMargin);
        const validation = [];
        if (materialMargin >= 100) validation.push({ field: 'materialMargin', code: 'margin_must_be_below_100' });
        if (equipmentMargin >= 100) validation.push({ field: 'equipmentMargin', code: 'margin_must_be_below_100' });
        if (laborMargin >= 100) validation.push({ field: 'laborMargin', code: 'margin_must_be_below_100' });
        const materialSales = salesFromCost(materialCost, materialMargin >= 100 ? 0 : clampMargin(materialMargin), settings.marginMode);
        const isEquipmentItem = String(item.itemType ?? item.item_type ?? item.costCategory ?? '')
            .toLowerCase().includes('equip');
        // Catalog/Takeoff equipment rows use the normal item quantity. The
        // separate equipmentQuantity field remains an optional explicit driver
        // for mixed/manual rows, but its normalized default of zero must not
        // erase a measured Equipment quantity.
        const explicitEquipmentQuantity = num(item.equipmentQuantity);
        const effectiveEquipmentQuantity = explicitEquipmentQuantity !== 0
            ? explicitEquipmentQuantity : (isEquipmentItem ? quantity : 0);
        const equipmentCost = effectiveEquipmentQuantity * num(item.unitEquipmentCost);
        const equipmentSales = salesFromCost(equipmentCost, equipmentMargin >= 100 ? 0 : clampMargin(equipmentMargin), settings.marginMode);
        // Waste is a material allowance. Labor follows the measured/base quantity;
        // difficulty is the only multiplier applied to required labor time.
        const baseLaborHours = quantity * unitLaborHours(item);
        const adjustedLaborHours = baseLaborHours * Math.max(0, num(item.difficulty, 1));
        const laborCost = adjustedLaborHours * num(item.laborRate ?? settings.globalLaborCost);
        const laborSales = salesFromCost(laborCost, laborMargin >= 100 ? 0 : clampMargin(laborMargin), settings.marginMode);
        const totalCost = materialCost + equipmentCost + laborCost;
        const totalSales = materialSales + equipmentSales + laborSales;
        const profit = totalSales - totalCost;
        return {
            baseQuantity: quantity,
            wasteQuantity: quantity * wastePercent / 100,
            adjustedQuantity,
            materialCost,
            materialSales,
            unitMaterialSales: adjustedQuantity ? materialSales / adjustedQuantity : 0,
            equipmentCost,
            equipmentSales,
            equipmentQuantity: effectiveEquipmentQuantity,
            baseLaborHours,
            adjustedLaborHours,
            laborCost,
            laborSales,
            totalCost,
            totalSales,
            profit,
            marginPercent: totalSales ? (profit / totalSales) * 100 : 0,
            validation
        };
    }

    function calculateAssembly(item, settings = {}, explicitChildren) {
        const children = Array.isArray(explicitChildren) ? explicitChildren
            : (Array.isArray(item.children) ? item.children : (Array.isArray(item.assemblyItems) ? item.assemblyItems : []));
        const assemblyQuantity = num(item.quantity);
        let totals = emptyTotals();
        const validation = [];
        const childRows = children.map(child => {
            // Catalog assembly component quantities are per assembly unit. A caller
            // may mark already-extended children to avoid applying the multiplier.
            const quantity = item.childrenQuantitiesExtended ? num(child.quantity) : num(child.quantity) * assemblyQuantity;
            const extended = { ...child, quantity };
            const calc = calculateItem(extended, settings);
            validation.push(...(calc.validation || []).map(error => ({ ...error, childId: child.id || null })));
            totals = addTotals(totals, calc);
            return { item: extended, calc };
        });
        return {
            ...totals,
            baseQuantity: assemblyQuantity,
            adjustedQuantity: assemblyQuantity,
            wasteQuantity: 0,
            unitMaterialCost: assemblyQuantity > 0 ? totals.materialCost / assemblyQuantity : 0,
            unitMaterialSales: assemblyQuantity > 0 ? totals.materialSales / assemblyQuantity : 0,
            isAssembly: true,
            childRows,
            validation
        };
    }

    function calculateCanonicalAssembly(item, settings = {}, groups = []) {
        const expansion = AssemblyAdapter.expand(item, groups, settings);
        if (expansion.errors.length) {
            const fallback = calculateAssembly(item, settings);
            return { ...fallback, expansion: { policy: 'CANONICAL', fallback: 'LEGACY',
                errors: expansion.errors, warnings: expansion.warnings, limitations: [] },
                validation: [...(fallback.validation || []), ...expansion.errors.map(error => ({ field: 'assembly', ...error }))] };
        }
        let totals = emptyTotals();
        const validation = [];
        const childRows = expansion.leaves.map(leaf => {
            const calc = calculatePart(leaf.item, settings);
            totals = addTotals(totals, calc);
            validation.push(...(calc.validation || []).map(error => ({ ...error, componentId: leaf.componentId })));
            return { item: leaf.item, calc, expansion: leaf };
        });
        validation.push(...expansion.errors.map(error => ({ field: 'assembly', ...error })));
        const quantity = num(item.quantity);
        return { ...totals, baseQuantity: quantity, adjustedQuantity: quantity, wasteQuantity: 0,
            unitMaterialCost: quantity > 0 ? totals.materialCost / quantity : 0,
            unitMaterialSales: quantity > 0 ? totals.materialSales / quantity : 0,
            isAssembly: true, childRows, validation,
            expansion: { policy: 'CANONICAL', errors: expansion.errors, warnings: expansion.warnings, limitations: [] } };
    }

    function calculateItem(item, settings = {}, explicitChildren) {
        const embeddedChildren = Array.isArray(item?.children) ? item.children
            : (Array.isArray(item?.assemblyItems) ? item.assemblyItems : []);
        // Preserve legacy aggregate assembly rows that only contain unit cost/labor.
        // They become a true roll-up as soon as component data is available.
        if ((Array.isArray(explicitChildren) && explicitChildren.length) || embeddedChildren.length) {
            return calculateAssembly(item, settings, explicitChildren);
        }
        return calculatePart(item, settings);
    }

    function markupValue(markup, baseMap) {
        if (markup?.active === false) return 0;
        const base = num(baseMap?.[markup?.base || 'subtotal_sales'] ?? baseMap?.subtotal_sales);
        if (markup?.type === 'fixed_amount') return num(markup.amount ?? markup.percent);
        return base * num(markup?.percent) / 100;
    }

    function componentTotals(calc, component) {
        const result = emptyTotals();
        if (component === 'Materials') {
            result.baseQuantity = calc.baseQuantity;
            result.wasteQuantity = calc.wasteQuantity;
            result.adjustedQuantity = calc.adjustedQuantity;
            result.materialCost = calc.materialCost;
            result.materialSales = calc.materialSales;
            result.totalCost = calc.materialCost;
            result.totalSales = calc.materialSales;
        } else if (component === 'Labor') {
            result.baseLaborHours = calc.baseLaborHours;
            result.adjustedLaborHours = calc.adjustedLaborHours;
            result.laborCost = calc.laborCost;
            result.laborSales = calc.laborSales;
            result.totalCost = calc.laborCost;
            result.totalSales = calc.laborSales;
        } else {
            result.equipmentCost = calc.equipmentCost;
            result.equipmentSales = calc.equipmentSales;
            result.totalCost = calc.equipmentCost;
            result.totalSales = calc.equipmentSales;
        }
        result.profit = result.totalSales - result.totalCost;
        result.marginPercent = result.totalSales ? result.profit / result.totalSales * 100 : 0;
        return result;
    }

    function calculateMarkups(markups, initialBaseMap) {
        let previousAdjustments = 0;
        return (markups || []).map(markup => {
            const baseMap = {
                ...initialBaseMap,
                previous_adjustments: previousAdjustments,
                subtotal_plus_previous_adjustments: num(initialBaseMap.subtotal_sales) + previousAdjustments,
                subtotal_with_adjustments: num(initialBaseMap.subtotal_sales) + previousAdjustments
            };
            const value = markupValue(markup, baseMap);
            previousAdjustments += value;
            return { ...markup, value };
        });
    }

    function calculateSummary(groups = [], settings = {}) {
        const byCategory = {
            Materials: emptyTotals(),
            Labor: emptyTotals(),
            Equipment: emptyTotals()
        };
        const rows = [];
        const globalRows = (groups || []).flatMap(group => group.items || []);
        const globalById = new Map(globalRows.map(item => [String(item.id ?? item.catalogItemId ?? ''), item]));
        (groups || []).forEach(group => {
            const items = group.items || [];
            const childrenByParent = new Map();
            items.forEach(item => {
                const parentId = item.parentItemId ?? item.parent_item_id ?? item.assemblyParentId;
                if (parentId === null || parentId === undefined || String(parentId) === '') return;
                const key = String(parentId);
                if (!childrenByParent.has(key)) childrenByParent.set(key, []);
                childrenByParent.get(key).push(item);
            });
            items.forEach(item => {
                const parentId = item.parentItemId ?? item.parent_item_id ?? item.assemblyParentId;
                if (parentId !== null && parentId !== undefined && String(parentId) !== '') {
                    const globalParent = globalById.get(String(parentId));
                    if (!globalParent || !AssemblyAdapter || AssemblyAdapter.itemPolicy(globalParent, settings) === 'CANONICAL'
                        || childrenByParent.has(String(parentId))) return;
                }
                const flatChildren = childrenByParent.get(String(item.id)) || [];
                const canonical = AssemblyAdapter && isAssembly(item)
                    && AssemblyAdapter.itemPolicy(item, settings) === 'CANONICAL';
                const calc = canonical ? calculateCanonicalAssembly(item, settings, groups)
                    : calculateItem(item, settings, flatChildren.length ? flatChildren : undefined);
                rows.push({ groupId: group.id, groupName: group.name, item, calc });
                byCategory.Materials = addTotals(byCategory.Materials, componentTotals(calc, 'Materials'));
                byCategory.Labor = addTotals(byCategory.Labor, componentTotals(calc, 'Labor'));
                byCategory.Equipment = addTotals(byCategory.Equipment, componentTotals(calc, 'Equipment'));
            });
        });
        const direct = Object.values(byCategory).reduce(addTotals, emptyTotals());
        const baseMap = {
            material_cost: byCategory.Materials.materialCost,
            labor_cost: direct.laborCost,
            equipment_cost: byCategory.Equipment.equipmentCost,
            total_cost: direct.totalCost,
            material_sales: byCategory.Materials.materialSales,
            labor_sales: direct.laborSales,
            equipment_sales: byCategory.Equipment.equipmentSales,
            subtotal_sales: direct.totalSales
        };
        const preTaxMarkups = calculateMarkups(settings.preTaxMarkups, baseMap);
        const preTaxTotal = preTaxMarkups.reduce((sum, markup) => sum + markup.value, 0);
        const taxable = rows.reduce((sum, row) => {
            if (row.calc.expansion?.policy === 'CANONICAL' && !row.calc.expansion?.fallback) {
                return row.calc.childRows.reduce((leafSum, childRow) => {
                    const leaf = childRow.item;
                    if (leaf.taxable === false) return leafSum;
                    return {
                        Materials: leafSum.Materials + (leaf.taxMaterial === false ? 0 : childRow.calc.materialSales),
                        Labor: leafSum.Labor + (leaf.taxLabor === false ? 0 : childRow.calc.laborSales),
                        Equipment: leafSum.Equipment + (leaf.taxEquipment === false ? 0 : childRow.calc.equipmentSales)
                    };
                }, sum);
            }
            if (row.item.taxable === false) return sum;
            return {
                Materials: sum.Materials + (row.item.taxMaterial === false ? 0 : row.calc.materialSales),
                Labor: sum.Labor + (row.item.taxLabor === false ? 0 : row.calc.laborSales),
                Equipment: sum.Equipment + (row.item.taxEquipment === false ? 0 : row.calc.equipmentSales)
            };
        }, { Materials: 0, Labor: 0, Equipment: 0 });
        const taxes = {
            Materials: taxable.Materials * num(settings.taxes?.Materials) / 100,
            Labor: taxable.Labor * num(settings.taxes?.Labor) / 100,
            Equipment: taxable.Equipment * num(settings.taxes?.Equipment) / 100
        };
        const totalTax = taxes.Materials + taxes.Labor + taxes.Equipment;
        const postBaseMap = { ...baseMap, subtotal_sales: direct.totalSales + preTaxTotal + totalTax, total_cost: direct.totalCost };
        const postTaxMarkups = calculateMarkups(settings.postTaxMarkups, postBaseMap);
        const postTaxTotal = postTaxMarkups.reduce((sum, markup) => sum + markup.value, 0);
        const estimateTotal = direct.totalSales + preTaxTotal + totalTax + postTaxTotal;
        const profit = estimateTotal - direct.totalCost;
        return {
            rows,
            byCategory,
            direct,
            preTaxMarkups,
            preTaxTotal,
            taxable,
            taxes,
            totalTax,
            postTaxMarkups,
            postTaxTotal,
            totalMarkups: preTaxTotal + postTaxTotal,
            estimateTotal,
            profit,
            marginPercent: estimateTotal ? (profit / estimateTotal) * 100 : 0
        };
    }

    const service = { num, salesFromCost, emptyTotals, addTotals, isAssembly, calculatePart, calculateAssembly,
        calculateCanonicalAssembly, calculateItem, calculateSummary };
    global.EstimateCalculationService = service;
    if (typeof module !== 'undefined') module.exports = service;
})(typeof window !== 'undefined' ? window : globalThis);
