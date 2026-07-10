(function (global) {
    function num(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clampMargin(value) {
        return Math.min(99.9, Math.max(-999, num(value)));
    }

    function salesFromCost(cost, rate, mode = 'margin') {
        const c = num(cost);
        const r = num(rate) / 100;
        if (!c) return 0;
        if (mode === 'markup') return c * (1 + r);
        return r >= 0.999 ? c : c / (1 - r);
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

    function calculateItem(item, settings = {}) {
        const quantity = num(item.quantity);
        const wastePercent = Math.max(0, num(item.waste));
        const adjustedQuantity = quantity * (1 + wastePercent / 100);
        const materialCost = adjustedQuantity * num(item.unitMaterialCost ?? item.unitCost);
        const materialSales = salesFromCost(materialCost, clampMargin(item.materialMargin ?? item.margin), settings.marginMode);
        const equipmentCost = num(item.equipmentQuantity) * num(item.unitEquipmentCost);
        const equipmentSales = salesFromCost(equipmentCost, clampMargin(item.equipmentMargin), settings.marginMode);
        const baseLaborHours = adjustedQuantity * unitLaborHours(item);
        const adjustedLaborHours = baseLaborHours * Math.max(0, num(item.difficulty, 1));
        const laborCost = adjustedLaborHours * num(item.laborRate ?? settings.globalLaborCost);
        const laborSales = salesFromCost(laborCost, clampMargin(item.laborMargin), settings.marginMode);
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
            baseLaborHours,
            adjustedLaborHours,
            laborCost,
            laborSales,
            totalCost,
            totalSales,
            profit,
            marginPercent: totalSales ? (profit / totalSales) * 100 : 0
        };
    }

    function markupValue(markup, baseMap) {
        if (markup?.active === false) return 0;
        const base = num(baseMap?.[markup?.base || 'subtotal_sales'] ?? baseMap?.subtotal_sales);
        if (markup?.type === 'fixed_amount') return num(markup.amount ?? markup.percent);
        return base * num(markup?.percent) / 100;
    }

    function calculateSummary(groups = [], settings = {}) {
        const byCategory = {
            Materials: emptyTotals(),
            Labor: emptyTotals(),
            Equipment: emptyTotals()
        };
        const rows = [];
        (groups || []).forEach(group => {
            (group.items || []).forEach(item => {
                const calc = calculateItem(item, settings);
                rows.push({ groupId: group.id, groupName: group.name, item, calc });
                const type = String(item.costCategory || item.type || 'Materials');
                const bucket = type.toLowerCase().includes('labor') ? 'Labor' : (type.toLowerCase().includes('equip') ? 'Equipment' : 'Materials');
                byCategory[bucket] = addTotals(byCategory[bucket], calc);
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
        const preTaxMarkups = (settings.preTaxMarkups || []).map(markup => ({ ...markup, value: markupValue(markup, baseMap) }));
        const preTaxTotal = preTaxMarkups.reduce((sum, markup) => sum + markup.value, 0);
        const taxable = rows.reduce((sum, row) => {
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
        const postTaxMarkups = (settings.postTaxMarkups || []).map(markup => ({ ...markup, value: markupValue(markup, postBaseMap) }));
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

    const service = { num, salesFromCost, emptyTotals, addTotals, calculateItem, calculateSummary };
    global.EstimateCalculationService = service;
    if (typeof module !== 'undefined') module.exports = service;
})(typeof window !== 'undefined' ? window : globalThis);
