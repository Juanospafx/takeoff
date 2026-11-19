import os
import re

print("Applying approved proposal optimizations and cleanups...")

# ==============================================================================
# 1. Update pages/project_dashboard.php: Remove proposalFeatureBanner
# ==============================================================================
with open('pages/project_dashboard.php', 'r', encoding='utf-8') as f:
    php_text = f.read()

banner_html = """                        <div class="proposal-feature-banner" id="proposalFeatureBanner">
                            <span>Enhanced Itemization in Proposal tab - Easily update proposals with: itemized
                                alternates &amp; assembly items, new customer/contact selection, and new toggles to
                                setup proposal.</span>
                            <button type="button" data-proposal-learn>Learn More</button>
                            <button type="button" data-proposal-dismiss-banner aria-label="Dismiss">x</button>
                        </div>"""

assert banner_html in php_text, "banner_html not found in php_text"
php_text = php_text.replace(banner_html + "\n", "")

with open('pages/project_dashboard.php', 'w', encoding='utf-8') as f:
    f.write(php_text)
print("1. pages/project_dashboard.php: Removed #proposalFeatureBanner successfully.")


# ==============================================================================
# 2. Update assets/project_proposal.js:
#    - Unify Group Subtotals switch
#    - Remove banner listeners & bannerKey
#    - Optimize change listener to call renderPreview() directly
# ==============================================================================
with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    js_text = f.read()

# A. Unify Group Subtotals in defaults
old_defaults_mat = """        material: {
            quantity: true,
            assemblyItems: true,
            itemTotalCost: true,
            combinedUnitCost: false,
            groupSubtotals: false,
            manufacturer: false,
            catalogNumber: false,
            description: false
        },"""

new_defaults_mat = """        material: {
            quantity: true,
            assemblyItems: true,
            itemTotalCost: true,
            combinedUnitCost: false,
            manufacturer: false,
            catalogNumber: false,
            description: false
        },"""

assert old_defaults_mat in js_text, "old_defaults_mat not found"
js_text = js_text.replace(old_defaults_mat, new_defaults_mat, 1)

# B. Remove duplicate switch from materialRows in renderSettings()
old_material_rows = """        const materialRows = [
            ['Quantity', 'material.quantity'],
            ['Assembly Items', 'material.assemblyItems'],
            ['Item Total Cost', 'material.itemTotalCost'],
            ['Combined Unit Cost', 'material.combinedUnitCost'],
            ['Group Subtotals', 'material.groupSubtotals'],
            ['Manufacturer', 'material.manufacturer'],
            ['Catalog Number', 'material.catalogNumber'],
            ['Description', 'material.description']
        ].map(([label, path]) => renderToggle(label, path)).join('');"""

new_material_rows = """        const materialRows = [
            ['Quantity', 'material.quantity'],
            ['Assembly Items', 'material.assemblyItems'],
            ['Item Total Cost', 'material.itemTotalCost'],
            ['Combined Unit Cost', 'material.combinedUnitCost'],
            ['Manufacturer', 'material.manufacturer'],
            ['Catalog Number', 'material.catalogNumber'],
            ['Description', 'material.description']
        ].map(([label, path]) => renderToggle(label, path)).join('');"""

assert old_material_rows in js_text, "old_material_rows not found"
js_text = js_text.replace(old_material_rows, new_material_rows, 1)

# C. Update getItemTableConfig to use costItems.groupSubtotals exclusively
old_show_group = "const showGroupCost = hasCostColumns && Boolean(proposalSettings.costItems.groupSubtotals || proposalSettings.material.groupSubtotals);"
new_show_group = "const showGroupCost = hasCostColumns && Boolean(proposalSettings.costItems.groupSubtotals);"

assert old_show_group in js_text, "old_show_group not found"
js_text = js_text.replace(old_show_group, new_show_group, 1)

# D. Remove bannerKey definition and banner element lookup
old_keys = """    const settingsKey = `takeoff.proposal.settings.${projectId || 'draft'}`;
    const bannerKey = `takeoff.proposal.banner.${projectId || 'draft'}`;
    const estimatingKey = `takeoff.estimating.module.${projectId || 'draft'}`;"""

new_keys = """    const settingsKey = `takeoff.proposal.settings.${projectId || 'draft'}`;
    const estimatingKey = `takeoff.estimating.module.${projectId || 'draft'}`;"""

assert old_keys in js_text, "old_keys not found"
js_text = js_text.replace(old_keys, new_keys, 1)

old_banner_lookup = """    const exportToggle = root.querySelector('[data-proposal-export-toggle]');
    const exportMenu = document.getElementById('proposalExportMenu');
    const builderNote = document.getElementById('proposalBuilderNote');
    const banner = document.getElementById('proposalFeatureBanner');
    const estimateFooter = document.getElementById('proposalEstimateTypesFooter');"""

new_banner_lookup = """    const exportToggle = root.querySelector('[data-proposal-export-toggle]');
    const exportMenu = document.getElementById('proposalExportMenu');
    const builderNote = document.getElementById('proposalBuilderNote');
    const estimateFooter = document.getElementById('proposalEstimateTypesFooter');"""

assert old_banner_lookup in js_text, "old_banner_lookup not found"
js_text = js_text.replace(old_banner_lookup, new_banner_lookup, 1)

# E. Remove banner event listener block
old_banner_listener = """    if (banner) {
        banner.hidden = localStorage.getItem(bannerKey) === 'dismissed';
        banner.querySelector('[data-proposal-dismiss-banner]')?.addEventListener('click', () => {
            banner.hidden = true;
            try { localStorage.setItem(bannerKey, 'dismissed'); } catch (error) {}
        });
        banner.querySelector('[data-proposal-learn]')?.addEventListener('click', () => showToast('Proposal itemization and company settings are controlled from the left panel.'));
    }"""

assert old_banner_listener in js_text, "old_banner_listener not found"
js_text = js_text.replace(old_banner_listener + "\n\n", "")

# F. Optimize settings change event listener to call renderPreview() directly
old_change_listener = """    settingsPanel.addEventListener('change', (event) => {
        const checkbox = event.target.closest('[data-proposal-setting]');
        const select = event.target.closest('[data-proposal-select]');
        if (checkbox) setPath(proposalSettings, checkbox.dataset.proposalSetting, checkbox.checked);
        if (select) setPath(proposalSettings, select.dataset.proposalSelect, select.value);
        if (checkbox || select) {
            saveSettings();
            renderAll();
        }
    });"""

new_change_listener = """    settingsPanel.addEventListener('change', (event) => {
        const checkbox = event.target.closest('[data-proposal-setting]');
        const select = event.target.closest('[data-proposal-select]');
        if (checkbox) setPath(proposalSettings, checkbox.dataset.proposalSetting, checkbox.checked);
        if (select) setPath(proposalSettings, select.dataset.proposalSelect, select.value);
        if (checkbox || select) {
            saveSettings();
            // Fast-path 60fps update: re-render document without tearing down sidebar DOM
            renderPreview();
        }
    });"""

assert old_change_listener in js_text, "old_change_listener not found"
js_text = js_text.replace(old_change_listener, new_change_listener, 1)

with open('assets/project_proposal.js', 'w', encoding='utf-8') as f:
    f.write(js_text)
print("2. assets/project_proposal.js: Unified switch, removed banner, and optimized change listener.")


# ==============================================================================
# 3. Update assets/project_proposal.css: Remove unused banner styles & clean total box
# ==============================================================================
with open('assets/project_proposal.css', 'r', encoding='utf-8') as f:
    css_text = f.read()

# A. Remove .proposal-feature-banner CSS rules
old_banner_css = """.proposal-feature-banner {
    width: min(8.5in, 100%);
    margin: 0 auto 14px;
    padding: 11px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid var(--border-soft, #cbd5e1);
    background: var(--bg-panel, #ffffff);
    border-radius: 8px;
    font-size: 12px;
    color: var(--text-main, #0f172a);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
    box-sizing: border-box;
}

.proposal-feature-banner span {
    flex: 1;
    min-width: 0;
}

.proposal-feature-banner button {
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 6px;
    height: 28px;
    padding: 0 10px;
    background: var(--bg-panel, #ffffff);
    color: var(--text-main, #0f172a);
    cursor: pointer;
    font-size: 11.5px;
    font-weight: 600;
    transition: all 0.14s ease;
}

.proposal-feature-banner [data-proposal-learn] {
    color: #0f5d9d;
    border-color: #b7d4ee;
    background: #f3f8fd;
}

.proposal-feature-banner [data-proposal-learn]:hover {
    background: #e2effc;
}"""

if old_banner_css in css_text:
    css_text = css_text.replace(old_banner_css + "\n", "")
    print("3A. Removed .proposal-feature-banner screen CSS.")

# B. Remove responsive banner rule
old_resp_banner = """    .proposal-feature-banner {
        align-items: stretch;
        flex-direction: column;
    }"""
if old_resp_banner in css_text:
    css_text = css_text.replace(old_resp_banner + "\n", "")
    print("3B. Removed responsive banner CSS.")

# C. Remove dark theme banner rules
old_dark_banner = """    [data-theme="dark"] .proposal-feature-banner,
    body.theme-dark .proposal-feature-banner {
        background: #242a38 !important;
        border-color: #2f384a !important;
        color: #cbd5e1 !important;
    }

    [data-theme="dark"] .proposal-feature-banner button,
    body.theme-dark .proposal-feature-banner button {
        background: #1f2633 !important;
        border-color: #2f384a !important;
        color: #ffffff !important;
    }"""
if old_dark_banner in css_text:
    css_text = css_text.replace(old_dark_banner + "\n", "")
    print("3C. Removed dark theme banner CSS.")

# D. Clean up old .proposal-total-box black box rules
old_total_box = """.proposal-total-box {
    width: 100% !important;
    box-sizing: border-box !important;
    margin-top: 18px;
    padding: 16px 20px;
    border-radius: 8px;
    background: #0f172a;
    color: #ffffff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid #1e293b;
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.16);
}

.proposal-total-box .label {
    color: #94a3b8;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
}

.proposal-total-box .sub {
    color: #64748b;
    font-size: 10.5px;
    margin-top: 2px;
}

.proposal-total-box .value {
    color: #ffffff !important;
    font-size: 26px;
    font-weight: 900;
    letter-spacing: -0.02em;
}"""

if old_total_box in css_text:
    css_text = css_text.replace(old_total_box + "\n", "")
    print("3D. Removed obsolete black .proposal-total-box rules.")

with open('assets/project_proposal.css', 'w', encoding='utf-8') as f:
    f.write(css_text)
print("3. assets/project_proposal.css: Cleaned up successfully.")

print("\nALL OPTIMIZATIONS APPLIED CLEANLY.")

