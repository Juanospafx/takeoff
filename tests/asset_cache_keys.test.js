const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readPage(name) {
    return fs.readFileSync(path.join(root, 'pages', name), 'utf8');
}

test('high-traffic portal pages use content timestamps instead of per-request cache busting', () => {
    for (const page of ['bid_board.php', 'cost_catalog.php']) {
        const source = readPage(page);
        assert.doesNotMatch(source, /\?v=<\?=\s*time\(\)/, `${page} must remain browser-cacheable`);
    }
});

test('local assets changed by the cache pass use filemtime cache keys', () => {
    const expectations = {
        'bid_board.php': ['global_tools.css', 'global_tools.js'],
        'cost_catalog.php': [
            'global_tools.css',
            'sso_readonly.css',
            'cost_catalog.css',
            'global_tools.js',
            'cost_catalog.js',
            'catalog_admin_service.js'
        ],
        'editor.php': ['runtime.js', 'takeoff_color_palette.js']
    };

    for (const [page, assets] of Object.entries(expectations)) {
        const source = readPage(page);
        for (const asset of assets) {
            const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            assert.match(
                source,
                new RegExp(`${escaped}\\?v=<\\?=\\s*filemtime\\(`),
                `${page} must key ${asset} from its content timestamp`
            );
        }
    }
});
