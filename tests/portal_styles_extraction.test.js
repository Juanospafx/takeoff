const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pages = {
    'archivos.php': 'portal_archivos.css',
    'directorio.php': 'portal_directorio.css',
    'timeline.php': 'portal_timeline.css',
    'index.php': 'portal_index.css',
    'projects.php': 'portal_projects.css',
    'project_create.php': 'portal_project_create.css'
};

test('portal views load extracted styles with content-based cache keys', () => {
    for (const [pageName, assetName] of Object.entries(pages)) {
        const page = fs.readFileSync(path.join(root, 'pages', pageName), 'utf8');
        assert.doesNotMatch(page, /<style\b/i, `${pageName} must not retain an embedded style block`);
        const escapedAsset = assetName.replaceAll('.', '\\.');
        assert.match(page, new RegExp(`${escapedAsset}\\?v=<\\?=\\s*filemtime\\(`),
            `${pageName} must use filemtime for ${assetName}`);
        assert.ok(fs.existsSync(path.join(root, 'assets', assetName)), `${assetName} must exist`);
    }
});

test('extracted assets retain page-specific responsive and component selectors', () => {
    const selectors = {
        'portal_archivos.css': ['.file-cards', '.table-rounded'],
        'portal_directorio.css': ['.user-chip', '.user-role'],
        'portal_timeline.css': ['.timeline-container::before', '.date-separator::before'],
        'portal_index.css': ['.proj-actions', '.folder-grid .col-md-3'],
        'portal_projects.css': ['.proj-cards', '.btn-action.delete:hover'],
        'portal_project_create.css': ['.box-card-compact', '.folder-list::-webkit-scrollbar-thumb']
    };
    for (const [assetName, expectedSelectors] of Object.entries(selectors)) {
        const css = fs.readFileSync(path.join(root, 'assets', assetName), 'utf8');
        for (const selector of expectedSelectors) {
            assert.ok(css.includes(selector), `${assetName} must retain ${selector}`);
        }
    }
});
