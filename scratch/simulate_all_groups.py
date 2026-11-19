import json

with open('scratch/estimate_items_13.json', 'r', encoding='utf-8') as f:
    db_items = json.load(f)

def num(val):
    try:
        return float(val) if val is not None else 0.0
    except:
        return 0.0

def firstValue(candidates):
    for c in candidates:
        if c is not None and str(c).strip() != '':
            return c
    return ''

def esc(val):
    return str(val or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

def itemFromEstimate(item):
    quantity = num(item.get('quantity') or item.get('qty') or 0)
    unitCost = num(item.get('unit_cost') or item.get('unit_price') or item.get('cost_each') or 0)
    total = num(item.get('total_cost') or (quantity * unitCost))
    item_type = item.get('item_type')
    cost_type = item.get('cost_type')
    type_val = firstValue([item_type, cost_type, 'Cost Item'])
    return {
        'name': firstValue([item.get('name'), item.get('description'), 'Cost item']),
        'group': firstValue([item.get('group_name'), item.get('groupName'), type_val, 'Ungrouped']),
        'budgetCode': firstValue([item.get('budget_code'), item.get('cost_code')]),
        'itemType': type_val,
        'category': firstValue([item.get('category'), item.get('catalog_category')]),
        'quantity': quantity,
        'uom': firstValue([item.get('unit_of_measure'), item.get('uom')]),
        'unitCost': unitCost,
        'total': total,
        'isAssemblyChild': False
    }

real_items = [itemFromEstimate(it) for it in db_items]

def groupKey(item, groupBy):
    if groupBy == 'Budget Code':
        return item.get('budgetCode') or 'No Budget Code'
    if groupBy == 'Item Type':
        return item.get('itemType') or 'Uncategorized'
    if groupBy == 'Catalog Category':
        return item.get('category') or 'Uncategorized'
    return item.get('group') or 'Ungrouped'

def groupedItems(items, groupBy):
    groups = {}
    for item in items:
        key = groupKey(item, groupBy)
        if key not in groups:
            groups[key] = []
        groups[key].append(item)
    return [{'name': k, 'children': v, 'total': sum(num(i['total']) for i in v)} for k, v in groups.items()]

def chunkFlatEntries(entries, maxPerPage=22, overflowSlack=3):
    pages = []
    total = len(entries)
    if total == 0:
        return pages
    idx = 0
    while idx < total:
        remaining = total - idx
        if remaining <= maxPerPage + overflowSlack:
            pages.append({'entries': entries[idx:], 'hasSummary': False})
            break
        else:
            take = min(maxPerPage, remaining)
            pages.append({'entries': entries[idx:idx+take], 'hasSummary': False})
            idx += take
    return pages

for gb in ['Groups', 'Budget Code', 'Item Type', 'Catalog Category']:
    print(f"\n=================== TESTING groupBy: {gb} ===================")
    groups = groupedItems(real_items, gb)
    print(f"Group count: {len(groups)}")
    for g in groups:
        print(f"  Group: '{g['name']}', children: {len(g['children'])}, total: {g['total']}")

    flatEntries = []
    for g in groups:
        flatEntries.append({'type': 'group', 'group': g, 'name': g['name'], 'total': g['total']})
        for child in g['children']:
            flatEntries.append({'type': 'item', 'item': child, 'group': g})
    
    print(f"Total flatEntries: {len(flatEntries)}")
    chunks = chunkFlatEntries(flatEntries, 22, 3)
    print(f"Chunks count (pages): {len(chunks)}")
    for i, c in enumerate(chunks):
        first_type = c['entries'][0]['type']
        print(f"  Page {i+1}: {len(c['entries'])} entries, starts with: {first_type}")
        if first_type == 'item':
            print(f"    Item in page {i+1} has group: {c['entries'][0]['group']['name']}")

