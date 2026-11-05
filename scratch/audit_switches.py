import re

with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    js_text = f.read()

with open('pages/project_dashboard.php', 'r', encoding='utf-8') as f:
    php_text = f.read()

print("--- 1. Defaults object in js ---")
defaults_match = re.search(r'const defaults = ({[\s\S]*?^    };)', js_text, re.MULTILINE)
if defaults_match:
    print(defaults_match.group(1))

print("\n--- 2. Render Settings panel in js ---")
# Where are switches rendered or bound?
bind_match = re.search(r'(function renderSettings[\s\S]*?^    })', js_text, re.MULTILINE)
if bind_match:
    print("Found renderSettings:")
    print(bind_match.group(1)[:1200])
else:
    # check bindSettings
    bind_match2 = re.search(r'(function (?:initSettings|bindSettings|setupSettings)[\s\S]*?^    })', js_text, re.MULTILINE)
    if bind_match2:
        print("Found:", bind_match2.group(1)[:1200])

print("\n--- 3. Search for data-proposal-setting in js ---")
data_settings = re.findall(r'data-proposal-setting="([^"]+)"', js_text)
print("Found data-proposal-setting:", set(data_settings))

print("\n--- 4. Search for data-proposal-setting in php ---")
php_settings = re.findall(r'data-proposal-setting="([^"]+)"', php_text)
print("Found data-proposal-setting in PHP:", set(php_settings))

