import os, re

patterns = [r'proposal-settings', r'proposalModule', r'tab-proposal', r'proposalSettingsPanel', r'proposal-shell']

for root, dirs, files in os.walk('.'):
    if any(p in root for p in ['node_modules', '.git', 'brain', 'vendor']): continue
    for f in files:
        if f.endswith(('.php', '.js', '.css')):
            p = os.path.join(root, f)
            with open(p, 'r', encoding='utf-8', errors='ignore') as fh:
                for line_no, line in enumerate(fh, 1):
                    for pat in patterns:
                        if re.search(pat, line):
                            print(f"{p}:{line_no}: {line.strip()[:100]}")

