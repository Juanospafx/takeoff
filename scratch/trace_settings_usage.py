import re

with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    text = f.read()

settings_list = [
    # Quick Simplification
    'groupsOnly',
    'lumpSum',
    'quantityOnly',
    # Material Details
    'material.quantity',
    'material.assemblyItems',
    'material.itemTotalCost',
    'material.combinedUnitCost',
    'material.groupSubtotals',
    'material.manufacturer',
    'material.catalogNumber',
    'material.description',
    # Grouping
    'groupBy',
    # Summary & Totals
    'summary.laborMaterials',
    'summary.taxes',
    'summary.overhead',
    'summary.profit',
    'summary.acceptedBy',
    'summary.date',
    'summary.showDecimals',
    'summary.roundTotal',
    'summary.priceSqft',
    # Cost Items
    'costItems.groupSubtotals',
    'costItems.summary',
    'costItems.estimateTotal',
    # Edit & Tools
    'proposalBuilder',
    # Layout & Pages
    'pageMode',
    'pageWidth',
    'coverPage',
    'appendixPage',
    # Company & Meta
    'company.address',
    'company.phone',
    'company.email',
    'company.preparedBy',
    'metaOverrides.quoteNumber',
    'metaOverrides.title',
]

print("=== SETTINGS USAGE AUDIT ===")
for s in settings_list:
    parts = s.split('.')
    if len(parts) == 1:
        pattern = r'proposalSettings\.' + parts[0]
    else:
        pattern = r'proposalSettings\.' + parts[0] + r'\.' + parts[1]
    
    matches = list(re.finditer(pattern, text))
    count = len(matches)
    print(f"\n[{s}] -> {count} occurrences")
    for m in matches:
        line_num = text[:m.start()].count('\n') + 1
        line = text[m.start()-30:m.start()+80].replace('\n', ' ')
        print(f"   L{line_num}: ...{line}...")

