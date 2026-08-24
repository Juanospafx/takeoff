const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('legacy Takeoff landing redirects to the canonical Bid Board', () => {
  const source = read('pages/takeoff.php');

  assert.match(source, /Location:\s*\/pages\/bid_board\.php/);
  assert.match(source, /exit\s*;/);
  assert.doesNotMatch(source, /Uploads|Takeoff Module|Cost Catalog|Settings/);
});

test('legacy navigation no longer exposes the duplicate Takeoff landing', () => {
  const files = [
    'views/sidebar.php',
    'pages/company_settings.php',
    'pages/estimate_module.php',
    'pages/project_module.php',
    'admin/fix_password.php',
  ];

  files.forEach((file) => {
    assert.doesNotMatch(read(file), /(?:\.\.\/|\/)pages\/takeoff\.php/, file);
  });

  const sidebar = read('views/sidebar.php');
  assert.match(sidebar, /pages\/bid_board\.php/);
  assert.match(sidebar, />Bid Board</);
});
