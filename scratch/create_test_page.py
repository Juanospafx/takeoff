import urllib.request
import re

resp = urllib.request.urlopen('http://localhost/takeoff/pages/project_dashboard.php?id=9&tab=proposal')
html = resp.read().decode('utf-8', errors='ignore')

# Add a test script right before </body> that tests changing groupBy to all 4 options
test_script = """
<script>
window.testErrors = [];
window.addEventListener('error', (e) => {
    window.testErrors.push({ message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, error: String(e.error) });
});

window.runGroupingTest = function() {
    const results = {};
    const select = document.querySelector('[data-proposal-select="groupBy"]');
    if (!select) {
        return { error: 'select not found' };
    }
    
    const options = ['Item Type', 'Groups', 'Budget Code', 'Catalog Category'];
    options.forEach(opt => {
        select.value = opt;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const doc = document.getElementById('proposalDocument');
        const sheets = doc.querySelectorAll('.proposal-page-sheet');
        const contBody = doc.querySelector('.proposal-document-body');
        const tables = doc.querySelectorAll('.proposal-item-table');
        const rows = doc.querySelectorAll('.proposal-item-table tr');
        results[opt] = {
            htmlLength: doc ? doc.innerHTML.length : 0,
            sheetsCount: sheets.length,
            hasContBody: Boolean(contBody),
            tablesCount: tables.length,
            rowsCount: rows.length,
            firstFewRows: Array.from(rows).slice(0, 4).map(r => r.textContent.trim().replace(/\\s+/g, ' '))
        };
    });
    results.errors = window.testErrors;
    return results;
};

// Auto run after 500ms
setTimeout(() => {
    const res = window.runGroupingTest();
    const div = document.createElement('div');
    div.id = 'TEST_RESULTS';
    div.textContent = JSON.stringify(res);
    document.body.appendChild(div);
}, 600);
</script>
"""

html_with_test = html.replace('</body>', test_script + '</body>')

with open('scratch/test_page.html', 'w', encoding='utf-8') as f:
    f.write(html_with_test)

print("Created scratch/test_page.html with diagnostic test harness.")

