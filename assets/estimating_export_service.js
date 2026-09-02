(function (global) {
    'use strict';

    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const text = value => value === null || value === undefined ? '' : String(value);
    const isAssembly = item => item?.isAssembly === true
        || text(item?.itemType ?? item?.item_type).toLowerCase() === 'assembly';
    const parentId = item => text(item?.parentItemId ?? item?.parent_item_id ?? item?.assemblyParentId);
    const catalogId = item => item?.catalogItemId ?? item?.catalog_item_id ?? '';
    const semanticType = item => {
        const type = text(item?.type ?? item?.itemType ?? item?.item_type).toUpperCase();
        return { PART: 'Part', EQUIPMENT: 'Equipment', LABOR: 'Labor', ASSEMBLY: 'Assembly', OTHER: 'Other' }[type]
            || (isAssembly(item) ? 'Assembly' : 'Part');
    };

    function catalogColumns(item, quantity, groupName, type) {
        return {
            Group: text(groupName),
            Type: type,
            'Catalog Item ID': text(catalogId(item)),
            Item: text(item?.name ?? item?.catalog_item_name),
            Description: text(item?.description),
            'Budget Code': text(item?.budgetCode ?? item?.budget_code),
            'Cost Code': text(item?.costCode ?? item?.cost_code),
            Category: text(item?.costCategory ?? item?.cost_type ?? item?.item_type),
            UOM: text(item?.uom ?? item?.unit_of_measure),
            Quantity: number(quantity),
            // The existing CSV column name is retained for compatibility. Its
            // value may represent canonical Equipment pricing for Equipment rows.
            'Unit Material Cost': number(item?.unitMaterialCost ?? item?.unitEquipmentCost ?? item?.unitCost ?? item?.unit_cost),
            'Unit Labor': number(item?.unitLabor ?? item?.unit_labor_time ?? item?.laborHours),
            'Labor Unit': text(item?.laborUnitType ?? item?.laborUnit),
            'Labor Rate': number(item?.laborRate ?? item?.labor_rate),
            Notes: text(item?.notes)
        };
    }

    function normalRows(estimate) {
        const rows = [];
        (estimate?.groups || []).forEach(group => {
            const children = new Map();
            (group.items || []).forEach(item => {
                const parent = parentId(item);
                if (!parent) return;
                if (!children.has(parent)) children.set(parent, []);
                children.get(parent).push(item);
            });
            (group.items || []).forEach(item => {
                if (parentId(item)) return;
                rows.push(catalogColumns(item, item.quantity, group.name, isAssembly(item) ? 'Assembly' : 'Part'));
            });
        });
        return rows;
    }

    function flattenItem(item, multiplier, groupName, siblingChildren, output, ancestry) {
        const id = text(item?.id);
        const embedded = Array.isArray(item?.children) ? item.children
            : (Array.isArray(item?.assemblyItems) ? item.assemblyItems : []);
        const children = embedded.length ? embedded : (siblingChildren.get(id) || []);
        if (isAssembly(item) && children.length) {
            if (id && ancestry.has(id)) return;
            const nextAncestry = new Set(ancestry);
            if (id) nextAncestry.add(id);
            const assemblyMultiplier = multiplier * number(item.quantity);
            children.forEach(child => {
                const childMultiplier = item.childrenQuantitiesExtended ? multiplier : assemblyMultiplier;
                flattenItem(child, childMultiplier, groupName, siblingChildren, output, nextAncestry);
            });
            return;
        }
        output.push({ item, quantity: multiplier * number(item.quantity), groupName });
    }

    function flatRows(estimate) {
        const expanded = [];
        (estimate?.groups || []).forEach(group => {
            const siblingChildren = new Map();
            (group.items || []).forEach(item => {
                const parent = parentId(item);
                if (!parent) return;
                if (!siblingChildren.has(parent)) siblingChildren.set(parent, []);
                siblingChildren.get(parent).push(item);
            });
            (group.items || []).filter(item => !parentId(item))
                .forEach(item => flattenItem(item, 1, group.name, siblingChildren, expanded, new Set()));
        });
        const consolidated = new Map();
        expanded.forEach(row => {
            const item = row.item;
            const key = catalogId(item) !== '' ? `catalog:${catalogId(item)}:${text(item?.uom).toLowerCase()}`
                : ['item', text(item?.costCode ?? item?.cost_code).toLowerCase(),
                    text(item?.name).toLowerCase(), text(item?.uom).toLowerCase()].join(':');
            if (!consolidated.has(key)) consolidated.set(key, { ...row, groups: new Set([row.groupName]) });
            else {
                const current = consolidated.get(key);
                current.quantity += row.quantity;
                current.groups.add(row.groupName);
            }
        });
        return [...consolidated.values()].map(row => catalogColumns(
            row.item, row.quantity, [...row.groups].filter(Boolean).join('; '), semanticType(row.item)
        ));
    }

    function needsCatalog(estimate) {
        return (estimate?.groups || []).some(group => (group.items || []).some(item =>
            isAssembly(item) && catalogId(item) !== ''
            && !(Array.isArray(item.children) && item.children.length)
            && !(Array.isArray(item.assemblyItems) && item.assemblyItems.length)));
    }

    function unresolvedAssemblies(estimate) {
        return (estimate?.groups || []).flatMap(group => (group.items || []).filter(item =>
            isAssembly(item)
            && !(Array.isArray(item.children) && item.children.length)
            && !(Array.isArray(item.assemblyItems) && item.assemblyItems.length)));
    }

    function csv(rows) {
        const headers = Object.keys(rows[0] || catalogColumns({}, 0, '', 'Part'));
        const escape = value => {
            const raw = text(value);
            return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
        };
        return '\uFEFF' + [headers, ...rows.map(row => headers.map(header => row[header]))]
            .map(columns => columns.map(escape).join(',')).join('\r\n');
    }

    const round = (value, decimals = 4) => {
        const num = Number(value) || 0;
        const factor = Math.pow(10, decimals);
        return Math.round((num + Number.EPSILON) * factor) / factor;
    };

    function bomRows(estimate, settings = {}) {
        const globalLaborRate = number(settings?.globalLaborCost);
        const rows = [];

        (estimate?.groups || []).forEach(group => {
            const groupName = text(group.name || 'Unnamed Group');
            const siblingChildren = new Map();
            (group.items || []).forEach(item => {
                const parent = parentId(item);
                if (!parent) return;
                if (!siblingChildren.has(parent)) siblingChildren.set(parent, []);
                siblingChildren.get(parent).push(item);
            });

            const topLevelItems = (group.items || []).filter(item => !parentId(item));

            topLevelItems.forEach(item => {
                const isAsm = isAssembly(item);
                const itemId = text(item.id);
                const embedded = Array.isArray(item.children) && item.children.length ? item.children
                    : (Array.isArray(item.assemblyItems) && item.assemblyItems.length ? item.assemblyItems : []);
                const children = embedded.length ? embedded : (siblingChildren.get(itemId) || []);

                if (isAsm && children.length) {
                    const assemblyQty = number(item.quantity);
                    let asmMatCost = 0, asmLabHours = 0, asmLabCost = 0, asmEquipCost = 0;

                    const childRowData = children.map(child => {
                        const ratio = number(child.quantity ?? 1);
                        const extendedQty = round(item.childrenQuantitiesExtended ? ratio : assemblyQty * ratio, 4);
                        const matCost = round(child.unitMaterialCost ?? child.unitCost ?? child.unit_cost, 4);
                        const labHours = round(child.unitLabor ?? child.unit_labor_time ?? child.laborHours, 4);
                        const labRate = round(child.laborRate ?? child.labor_rate ?? globalLaborRate, 2);
                        const equipCost = round(child.unitEquipmentCost ?? 0, 4);

                        const totalMat = round(extendedQty * matCost, 2);
                        const totalLabHours = round(extendedQty * labHours, 4);
                        const totalLabCost = round(totalLabHours * labRate, 2);
                        const totalEquip = round(extendedQty * equipCost, 2);
                        const totalRowCost = round(totalMat + totalLabCost + totalEquip, 2);

                        asmMatCost += totalMat;
                        asmLabHours += totalLabHours;
                        asmLabCost += totalLabCost;
                        asmEquipCost += totalEquip;

                        return {
                            rowType: 'component',
                            groupName,
                            parentName: text(item.name || item.catalog_item_name),
                            itemCode: text(child.costCode ?? child.cost_code ?? child.budgetCode ?? child.budget_code ?? catalogId(child)),
                            catalogId: text(catalogId(child)),
                            name: text(child.name || child.catalog_item_name),
                            displayName: `  ↳ ${text(child.name || child.catalog_item_name)}`,
                            description: text(child.description),
                            type: 'Assembly Component',
                            category: text(child.costCategory ?? child.cost_type ?? child.item_type ?? 'Material'),
                            uom: text(child.uom ?? child.unit_of_measure ?? 'ea'),
                            quantity: extendedQty,
                            ratio,
                            unitMaterialCost: matCost,
                            totalMaterialCost: totalMat,
                            unitLaborHours: labHours,
                            laborRate: labRate,
                            totalLaborHours: totalLabHours,
                            totalLaborCost: totalLabCost,
                            unitEquipmentCost: equipCost,
                            totalEquipmentCost: totalEquip,
                            unitTotalCost: extendedQty > 0 ? round(totalRowCost / extendedQty, 4) : 0,
                            totalCost: totalRowCost,
                            notes: text(child.notes)
                        };
                    });

                    asmMatCost = round(asmMatCost, 2);
                    asmLabHours = round(asmLabHours, 4);
                    asmLabCost = round(asmLabCost, 2);
                    asmEquipCost = round(asmEquipCost, 2);
                    const totalAssemblyCost = round(asmMatCost + asmLabCost + asmEquipCost, 2);

                    rows.push({
                        rowType: 'assembly',
                        groupName,
                        parentName: '',
                        itemCode: text(item.costCode ?? item.cost_code ?? item.budgetCode ?? item.budget_code ?? catalogId(item)),
                        catalogId: text(catalogId(item)),
                        name: text(item.name || item.catalog_item_name),
                        displayName: `[Assembly] ${text(item.name || item.catalog_item_name)}`,
                        description: text(item.description),
                        type: 'Assembly',
                        category: text(item.costCategory ?? item.cost_type ?? 'Assembly'),
                        uom: text(item.uom ?? item.unit_of_measure ?? 'ea'),
                        quantity: assemblyQty,
                        ratio: 1,
                        unitMaterialCost: assemblyQty > 0 ? round(asmMatCost / assemblyQty, 4) : 0,
                        totalMaterialCost: asmMatCost,
                        unitLaborHours: assemblyQty > 0 ? round(asmLabHours / assemblyQty, 4) : 0,
                        laborRate: globalLaborRate,
                        totalLaborHours: asmLabHours,
                        totalLaborCost: asmLabCost,
                        unitEquipmentCost: assemblyQty > 0 ? round(asmEquipCost / assemblyQty, 4) : 0,
                        totalEquipmentCost: asmEquipCost,
                        unitTotalCost: assemblyQty > 0 ? round(totalAssemblyCost / assemblyQty, 4) : 0,
                        totalCost: totalAssemblyCost,
                        notes: text(item.notes)
                    });

                    rows.push(...childRowData);
                } else {
                    const itemQty = number(item.quantity);
                    const matCost = round(item.unitMaterialCost ?? item.unitCost ?? item.unit_cost, 4);
                    const labHours = round(item.unitLabor ?? item.unit_labor_time ?? item.laborHours, 4);
                    const labRate = round(item.laborRate ?? item.labor_rate ?? globalLaborRate, 2);
                    const equipCost = round(item.unitEquipmentCost ?? 0, 4);

                    const totalMat = round(itemQty * matCost, 2);
                    const totalLabHours = round(itemQty * labHours, 4);
                    const totalLabCost = round(totalLabHours * labRate, 2);
                    const totalEquip = round(itemQty * equipCost, 2);
                    const totalRowCost = round(totalMat + totalLabCost + totalEquip, 2);

                    rows.push({
                        rowType: isAsm ? 'assembly' : 'item',
                        groupName,
                        parentName: '',
                        itemCode: text(item.costCode ?? item.cost_code ?? item.budgetCode ?? item.budget_code ?? catalogId(item)),
                        catalogId: text(catalogId(item)),
                        name: text(item.name || item.catalog_item_name),
                        displayName: text(item.name || item.catalog_item_name),
                        description: text(item.description),
                        type: isAsm ? 'Assembly' : semanticType(item),
                        category: text(item.costCategory ?? item.cost_type ?? item.item_type ?? 'Material'),
                        uom: text(item.uom ?? item.unit_of_measure ?? 'ea'),
                        quantity: itemQty,
                        ratio: 1,
                        unitMaterialCost: matCost,
                        totalMaterialCost: totalMat,
                        unitLaborHours: labHours,
                        laborRate: labRate,
                        totalLaborHours: totalLabHours,
                        totalLaborCost: totalLabCost,
                        unitEquipmentCost: equipCost,
                        totalEquipmentCost: totalEquip,
                        unitTotalCost: itemQty > 0 ? round(totalRowCost / itemQty, 4) : 0,
                        totalCost: totalRowCost,
                        notes: text(item.notes)
                    });
                }
            });
        });

        return rows;
    }

    function bomCsv(rows) {
        const columns = [
            ['Group', row => row.groupName],
            ['Type', row => row.type],
            ['Cost Code', row => row.itemCode],
            ['Item', row => row.displayName],
            ['Description', row => row.description],
            ['Category', row => row.category],
            ['UOM', row => row.uom],
            ['Quantity', row => row.quantity],
            ['Unit Ratio', row => row.ratio],
            ['Unit Material Cost', row => row.unitMaterialCost],
            ['Total Material Cost', row => row.totalMaterialCost],
            ['Unit Labor Hours', row => row.unitLaborHours],
            ['Labor Rate', row => row.laborRate],
            ['Total Labor Hours', row => row.totalLaborHours],
            ['Total Labor Cost', row => row.totalLaborCost],
            ['Unit Equipment Cost', row => row.unitEquipmentCost],
            ['Total Equipment Cost', row => row.totalEquipmentCost],
            ['Unit Total Cost', row => row.unitTotalCost],
            ['Total Cost', row => row.totalCost],
            ['Notes', row => row.notes]
        ];

        const escape = val => {
            const raw = text(val);
            return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
        };

        const headerLine = columns.map(([header]) => escape(header)).join(',');
        const dataLines = rows.map(row => columns.map(([, fn]) => escape(fn(row))).join(','));

        return '\uFEFF' + [headerLine, ...dataLines].join('\r\n');
    }

    function excelXml(estimate, settings = {}) {
        const rows = bomRows(estimate, settings);
        const estimateName = text(estimate?.name || 'Estimate');
        const xmlEsc = val => text(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

        let currentGroup = null;
        let sumMat = 0, sumLabHours = 0, sumLabCost = 0, sumEquip = 0, sumTotal = 0;

        // Calculate grand totals excluding components (since component costs are already inside parent assembly)
        rows.forEach(r => {
            if (r.rowType !== 'component') {
                sumMat += r.totalMaterialCost;
                sumLabHours += r.totalLaborHours;
                sumLabCost += r.totalLaborCost;
                sumEquip += r.totalEquipmentCost;
                sumTotal += r.totalCost;
            }
        });

        const xmlRows = [];

        // Title Block
        xmlRows.push(`
   <Row ss:Height="30">
    <Cell ss:MergeAcross="14" ss:StyleID="sProjectTitle"><Data ss:Type="String">BILL OF MATERIALS (BOM) — ${xmlEsc(estimateName)}</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:MergeAcross="14" ss:StyleID="sProjectSub"><Data ss:Type="String">Generated: ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })} · Total Estimate: $${sumTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Data></Cell>
   </Row>
   <Row ss:Height="8"/>`);

        // Column headers definition
        const columnHeaders = [
            'Group', 'Type', 'Cost Code', 'Item / Component', 'Description',
            'Category', 'UOM', 'Quantity', 'Ratio', 'Unit Material',
            'Total Material', 'Unit Labor (hr)', 'Labor Rate ($)', 'Total Labor (hr)', 'Total Labor Cost',
            'Unit Equip', 'Total Equip', 'Unit Total', 'Total Cost', 'Notes'
        ];

        rows.forEach(row => {
            // Group separator banner when entering a new group
            if (row.groupName !== currentGroup) {
                currentGroup = row.groupName;
                xmlRows.push(`
   <Row ss:Height="24">
    <Cell ss:MergeAcross="19" ss:StyleID="sGroupBanner"><Data ss:Type="String">GROUP: ${xmlEsc(currentGroup)}</Data></Cell>
   </Row>
   <Row ss:Height="22">
    ${columnHeaders.map(h => `<Cell ss:StyleID="sColHeader"><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join('')}
   </Row>`);
            }

            const isAsm = row.rowType === 'assembly';
            const isComp = row.rowType === 'component';
            const rowStylePrefix = isAsm ? 'sAsm' : (isComp ? 'sComp' : 'sItem');

            xmlRows.push(`
   <Row ss:Height="${isAsm ? '21' : (isComp ? '19' : '20')}">
    <Cell ss:StyleID="${rowStylePrefix}Text"><Data ss:Type="String">${xmlEsc(row.groupName)}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Text"><Data ss:Type="String">${xmlEsc(row.type)}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Text"><Data ss:Type="String">${xmlEsc(row.itemCode)}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}ItemName"><Data ss:Type="String">${xmlEsc(row.displayName)}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Text"><Data ss:Type="String">${xmlEsc(row.description)}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Text"><Data ss:Type="String">${xmlEsc(row.category)}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Center"><Data ss:Type="String">${xmlEsc(row.uom)}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Num"><Data ss:Type="Number">${row.quantity}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Num"><Data ss:Type="Number">${row.ratio}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Currency"><Data ss:Type="Number">${row.unitMaterialCost}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Currency"><Data ss:Type="Number">${row.totalMaterialCost}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Num"><Data ss:Type="Number">${row.unitLaborHours}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Currency"><Data ss:Type="Number">${row.laborRate}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Num"><Data ss:Type="Number">${row.totalLaborHours}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Currency"><Data ss:Type="Number">${row.totalLaborCost}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Currency"><Data ss:Type="Number">${row.unitEquipmentCost}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Currency"><Data ss:Type="Number">${row.totalEquipmentCost}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Currency"><Data ss:Type="Number">${row.unitTotalCost}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}CurrencyBold"><Data ss:Type="Number">${row.totalCost}</Data></Cell>
    <Cell ss:StyleID="${rowStylePrefix}Text"><Data ss:Type="String">${xmlEsc(row.notes)}</Data></Cell>
   </Row>`);
        });

        // Grand Total Row at bottom
        xmlRows.push(`
   <Row ss:Height="8"/>
   <Row ss:Height="26">
    <Cell ss:MergeAcross="9" ss:StyleID="sGrandTotalLabel"><Data ss:Type="String">GRAND TOTAL (Excluding component duplicates)</Data></Cell>
    <Cell ss:StyleID="sGrandTotalCurrency"><Data ss:Type="Number">${sumMat}</Data></Cell>
    <Cell ss:StyleID="sGrandTotalText"><Data ss:Type="String">-</Data></Cell>
    <Cell ss:StyleID="sGrandTotalText"><Data ss:Type="String">-</Data></Cell>
    <Cell ss:StyleID="sGrandTotalNum"><Data ss:Type="Number">${sumLabHours}</Data></Cell>
    <Cell ss:StyleID="sGrandTotalCurrency"><Data ss:Type="Number">${sumLabCost}</Data></Cell>
    <Cell ss:StyleID="sGrandTotalText"><Data ss:Type="String">-</Data></Cell>
    <Cell ss:StyleID="sGrandTotalCurrency"><Data ss:Type="Number">${sumEquip}</Data></Cell>
    <Cell ss:StyleID="sGrandTotalText"><Data ss:Type="String">-</Data></Cell>
    <Cell ss:StyleID="sGrandTotalCurrency"><Data ss:Type="Number">${sumTotal}</Data></Cell>
    <Cell ss:StyleID="sGrandTotalText"><Data ss:Type="String"></Data></Cell>
   </Row>`);

        return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>Bill of Materials - ${xmlEsc(estimateName)}</Title>
  <Author>TAKEOFF Estimating</Author>
  <Created>${new Date().toISOString()}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#1E293B"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <!-- Main Title -->
  <Style ss:ID="sProjectTitle">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="15" ss:Bold="1" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="sProjectSub">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Italic="1" ss:Color="#64748B"/>
  </Style>
  <!-- Group Banner -->
  <Style ss:ID="sGroupBanner">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E3A8A" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0F172A"/>
   </Borders>
  </Style>
  <!-- Table Column Header -->
  <Style ss:ID="sColHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Font ss:FontName="Segoe UI" ss:Size="9" ss:Bold="1" ss:Color="#1E293B"/>
   <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>

  <!-- Standard Item Styles -->
  <Style ss:ID="sItemText">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/></Borders>
  </Style>
  <Style ss:ID="sItemItemName">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#0F172A"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/></Borders>
  </Style>
  <Style ss:ID="sItemCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/></Borders>
  </Style>
  <Style ss:ID="sItemNum">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/></Borders>
  </Style>
  <Style ss:ID="sItemCurrency">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="$#,##0.00"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/></Borders>
  </Style>
  <Style ss:ID="sItemCurrencyBold">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#0F172A"/>
   <NumberFormat ss:Format="$#,##0.00"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/></Borders>
  </Style>

  <!-- Assembly Parent Styles -->
  <Style ss:ID="sAsmText">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>
  <Style ss:ID="sAsmItemName">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>
  <Style ss:ID="sAsmCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>
  <Style ss:ID="sAsmNum">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>
  <Style ss:ID="sAsmCurrency">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <NumberFormat ss:Format="$#,##0.00"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>
  <Style ss:ID="sAsmCurrencyBold">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
   <NumberFormat ss:Format="$#,##0.00"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BFDBFE"/>
   </Borders>
  </Style>

  <!-- Assembly Component Styles (indented child items) -->
  <Style ss:ID="sCompText">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="9" ss:Color="#475569"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Dot" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
  </Style>
  <Style ss:ID="sCompItemName">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:Indent="1"/>
   <Font ss:FontName="Segoe UI" ss:Size="9" ss:Color="#334155"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Dot" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
  </Style>
  <Style ss:ID="sCompCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="9" ss:Color="#475569"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Dot" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
  </Style>
  <Style ss:ID="sCompNum">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="9" ss:Color="#475569"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Dot" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
  </Style>
  <Style ss:ID="sCompCurrency">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="9" ss:Color="#475569"/>
   <NumberFormat ss:Format="$#,##0.00"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Dot" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
  </Style>
  <Style ss:ID="sCompCurrencyBold">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="9" ss:Bold="1" ss:Color="#334155"/>
   <NumberFormat ss:Format="$#,##0.00"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders><Border ss:Position="Bottom" ss:LineStyle="Dot" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
  </Style>

  <!-- Grand Total Styles -->
  <Style ss:ID="sGrandTotalLabel">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#000000"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3" ss:Color="#000000"/>
   </Borders>
  </Style>
  <Style ss:ID="sGrandTotalCurrency">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <NumberFormat ss:Format="$#,##0.00"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#000000"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3" ss:Color="#000000"/>
   </Borders>
  </Style>
  <Style ss:ID="sGrandTotalNum">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#000000"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3" ss:Color="#000000"/>
   </Borders>
  </Style>
  <Style ss:ID="sGrandTotalText">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#000000"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3" ss:Color="#000000"/>
   </Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="Bill of Materials">
  <Table ss:DefaultColumnWidth="65" ss:DefaultRowHeight="20">
   <Column ss:Width="110"/> <!-- Group -->
   <Column ss:Width="110"/> <!-- Type -->
   <Column ss:Width="85"/>  <!-- Cost Code -->
   <Column ss:Width="230"/> <!-- Item / Component -->
   <Column ss:Width="180"/> <!-- Description -->
   <Column ss:Width="110"/> <!-- Category -->
   <Column ss:Width="50"/>  <!-- UOM -->
   <Column ss:Width="65"/>  <!-- Quantity -->
   <Column ss:Width="55"/>  <!-- Ratio -->
   <Column ss:Width="95"/>  <!-- Unit Material -->
   <Column ss:Width="105"/> <!-- Total Material -->
   <Column ss:Width="95"/>  <!-- Unit Labor -->
   <Column ss:Width="90"/>  <!-- Labor Rate -->
   <Column ss:Width="95"/>  <!-- Total Labor Hr -->
   <Column ss:Width="105"/> <!-- Total Labor Cost -->
   <Column ss:Width="85"/>  <!-- Unit Equip -->
   <Column ss:Width="90"/>  <!-- Total Equip -->
   <Column ss:Width="95"/>  <!-- Unit Total -->
   <Column ss:Width="110"/> <!-- Total Cost -->
   <Column ss:Width="140"/> <!-- Notes -->
${xmlRows.join('')}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>5</SplitHorizontal>
   <TopRowBottomPane>5</TopRowBottomPane>
   <ActivePane>2</ActivePane>
   <Panes>
    <Pane>
     <Number>3</Number>
    </Pane>
    <Pane>
     <Number>2</Number>
     <ActiveRow>0</ActiveRow>
    </Pane>
   </Panes>
   <ProtectObjects>False</ProtectObjects>
   <ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
    }

    const service = { normalRows, flatRows, needsCatalog, unresolvedAssemblies, csv, bomRows, bomCsv, excelXml };
    global.EstimatingExportService = service;
    if (typeof module !== 'undefined') module.exports = service;
})(typeof window !== 'undefined' ? window : globalThis);
