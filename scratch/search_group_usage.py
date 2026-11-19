with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re

# Find any occurrences of `group` or `groupBy`
for m in re.finditer(r'(?:groupBy|groupKey|groupedItems|group\.name|group\.total|group\.children)', text):
    start = max(0, m.start() - 40)
    end = min(len(text), m.start() + 100)
    print(f"L{text[:m.start()].count(chr(10))+1}: {text[start:end].replace(chr(10), ' ')}")

