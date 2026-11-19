import os, re

for root, dirs, files in os.walk('.'):
    if any(p in root for p in ['node_modules', '.git', 'brain', 'vendor']): continue
    for f in files:
        if f.endswith(('.php', '.js')):
            p = os.path.join(root, f)
            with open(p, 'r', encoding='utf-8', errors='ignore') as fh:
                for line_no, line in enumerate(fh, 1):
                    if re.search(r'addEventListener\([\'"]change|onchange', line):
                        print(f"{p}:{line_no}: {line.strip()[:100]}")

