# Apply page density and table capacity optimization

# 1. Update assets/project_proposal.js
with open('assets/project_proposal.js', 'r', encoding='utf-8') as f:
    js_text = f.read()

old_chunk_fn = """    function chunkFlatEntries(entries, maxPerPage = 14) {
        const pages = [];
        const total = entries.length;
        if (total === 0) {
            return pages;
        }

        let idx = 0;
        while (idx < total) {
            const take = Math.min(maxPerPage, total - idx);
            pages.push({
                entries: entries.slice(idx, idx + take),
                hasSummary: false
            });
            idx += take;
        }
        return pages;
    }"""

new_chunk_fn = """    function chunkFlatEntries(entries, maxPerPage = 22, overflowSlack = 3) {
        const pages = [];
        const total = entries.length;
        if (total === 0) {
            return pages;
        }

        let idx = 0;
        while (idx < total) {
            const remaining = total - idx;
            // If remaining entries only slightly exceed maxPerPage, fit them on this page
            // to maximize page usage and prevent near-empty orphan pages.
            if (remaining <= maxPerPage + overflowSlack) {
                pages.push({
                    entries: entries.slice(idx),
                    hasSummary: false
                });
                break;
            } else {
                const take = Math.min(maxPerPage, remaining);
                pages.push({
                    entries: entries.slice(idx, idx + take),
                    hasSummary: false
                });
                idx += take;
            }
        }
        return pages;
    }"""

assert old_chunk_fn in js_text, "old_chunk_fn not found in js"
js_text = js_text.replace(old_chunk_fn, new_chunk_fn)

old_call = "const itemChunks = chunkFlatEntries(flatEntries, 14);"
new_call = "const itemChunks = chunkFlatEntries(flatEntries, 22, 3);"

assert old_call in js_text, "old_call not found in js"
js_text = js_text.replace(old_call, new_call)

with open('assets/project_proposal.js', 'w', encoding='utf-8') as f:
    f.write(js_text)

print("assets/project_proposal.js updated successfully.")

# 2. Update assets/project_proposal.css
with open('assets/project_proposal.css', 'r', encoding='utf-8') as f:
    css_text = f.read()

old_th_td = """.proposal-item-table th {
    background: #f1f5f9 !important;
    color: #475569 !important;
    font-size: 10.5px !important;
    font-weight: 800 !important;
    text-transform: uppercase !important;
    letter-spacing: .04em !important;
    padding: 8px 12px !important;
    border-bottom: 1px solid #cbd5e1 !important;
    text-align: left;
    box-sizing: border-box !important;
}

.proposal-item-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
    background: transparent !important;
    color: #1e293b;
    font-size: 12px;
    font-weight: 400 !important; /* Items without bold */
    vertical-align: top;
    box-sizing: border-box !important;
    word-break: break-word;
    overflow-wrap: break-word;
}"""

new_th_td = """.proposal-item-table th {
    background: #f1f5f9 !important;
    color: #475569 !important;
    font-size: 10.5px !important;
    font-weight: 800 !important;
    text-transform: uppercase !important;
    letter-spacing: .04em !important;
    padding: 6.5px 12px !important;
    border-bottom: 1px solid #cbd5e1 !important;
    text-align: left;
    box-sizing: border-box !important;
}

.proposal-item-table td {
    padding: 6px 12px !important; /* Optimized padding for maximum page height utilization */
    border-bottom: 1px solid #f1f5f9;
    background: transparent !important;
    color: #1e293b;
    font-size: 11.5px;
    font-weight: 400 !important; /* Items without bold */
    vertical-align: middle;
    box-sizing: border-box !important;
    word-break: break-word;
    overflow-wrap: break-word;
}"""

assert old_th_td in css_text, "old_th_td not found in css"
css_text = css_text.replace(old_th_td, new_th_td)

with open('assets/project_proposal.css', 'w', encoding='utf-8') as f:
    f.write(css_text)

print("assets/project_proposal.css updated successfully.")
print("OPTIMIZATIONS APPLIED.")

