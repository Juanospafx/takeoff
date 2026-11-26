const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'assets', 'project_overview.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'project_presence.php'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '20261125_project_presence.sql'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'pages', 'project_dashboard.php'), 'utf8');
const migrationHarness = fs.readFileSync(path.join(root, 'harness', 'project-members-migration.php'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');
const presenceSource = client.slice(client.indexOf('// Server-backed project presence'),
    client.indexOf("$('projectStatusButton')", client.indexOf('// Server-backed project presence')));

test('project presence is server-backed and does not use localStorage as its transport', () => {
    assert.match(presenceSource, /project_presence\.php/);
    assert.match(presenceSource, /fetchProjectPresence\(heartbeat \? 'heartbeat' : 'list', clientId\)/);
    assert.match(presenceSource, /setInterval\(\(\) => window\.ProjectPresence\.syncRealtime\(\), 2000\)/);
    assert.doesNotMatch(presenceSource, /localStorage/);
});

test('presence API authenticates, enforces project read access, and derives identity from session', () => {
    assert.match(api, /takeoff_guard_api_action/);
    assert.match(api, /'project\.read'/);
    assert.match(api, /takeoff_guard_project_access\(\$pdo, \$user, \$projectId, ProjectAccess::READ\)/);
    assert.match(api, /\$_SESSION\['display_name'\]/);
    assert.doesNotMatch(api, /\$input\['display_name'\]/);
});

test('presence rows are tab-scoped, expire, and are deduplicated per user', () => {
    assert.match(migration, /PRIMARY KEY \(`project_id`, `user_id`, `client_id`\)/);
    assert.match(api, /ON DUPLICATE KEY UPDATE/);
    assert.match(api, /INTERVAL 35 SECOND/);
    assert.match(api, /GROUP BY presence\.user_id/);
    assert.match(api, /INNER JOIN users ON users\.id = presence\.user_id AND users\.active = 1/);
    assert.match(client, /navigator\.sendBeacon/);
    assert.match(dashboard, /\$authUser\['user_id'\]/);
});

test('a viewer registers and both open pages refresh their roster without reloading', async () => {
    const users = new Map();
    const pages = [];
    const markup = '<div id="pdPresenceStack"></div><div id="pdPresenceList"></div><div id="pdPresenceCount"></div>';
    const fetchGuard = dashboard.slice(dashboard.indexOf('var nativeFetch = window.fetch.bind(window)'),
        dashboard.indexOf("document.addEventListener('DOMContentLoaded', function ()", dashboard.indexOf('var nativeFetch = window.fetch.bind(window)')));
    function openProject(id, name, viewer = false) {
        const dom = new JSDOM(markup, { url: 'https://takeoff.test/pages/project_dashboard.php', runScripts: 'outside-only' });
        const { window } = dom;
        pages.push(dom);
        const user = { id, name, initials: name.slice(0, 2), role: viewer ? 'Viewer' : 'Admin' };
        window.ProjectPresenceUser = { ...user, name: name + ' (You)', color: '#5b4364', isSelf: true };
        window.ProjectState = { projectId: 42 };
        window.fetch = async (input, init) => {
            const url = new URL(input, window.location.href);
            const body = init?.body ? JSON.parse(init.body) : null;
            if (body?.action === 'heartbeat') {
                assert.equal(body.project_id, 42);
                users.set(id, user);
            } else {
                assert.equal(url.searchParams.get('action'), 'list');
                assert.equal(url.searchParams.get('project_id'), '42');
            }
            return { ok: true, json: async () => ({
                status: 'success',
                users: Array.from(users.values(), value => ({ ...value, isSelf: value.id === id }))
            }) };
        };
        window.Request = Request;
        window.setInterval = callback => { window.pollPresence = callback; };
        if (viewer) window.eval(fetchGuard);
        window.eval(presenceSource + `
            function $(id) { return document.getElementById(id); }
            function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
        `);
        return window;
    }
    const ready = () => new Promise(resolve => setImmediate(resolve));
    try {
        const admin = openProject(1, 'Ana');
        await ready();
        const viewer = openProject(2, 'Luis "L." <Viewer>', true);
        await ready();
        assert.equal(viewer.ProjectPresence.getUsers().length, 2);
        assert.equal(admin.ProjectPresence.getUsers().length, 1);
        await assert.rejects(viewer.fetch('../api/takeoff.php', { method: 'POST', body: '{}' }), /Read-only/);
        await admin.pollPresence();
        assert.equal(admin.ProjectPresence.getUsers().length, 2);
        const avatar = admin.document.querySelector('[data-pro-tooltip]:not(.self)');
        assert.equal(avatar.getAttribute('data-pro-tooltip'), 'Luis "L." <Viewer>');
        await admin.pollPresence();
        assert.equal(admin.document.querySelector('[data-pro-tooltip]:not(.self)'), avatar);
    } finally {
        pages.forEach(page => page.window.close());
    }
});

test('production deployment creates and verifies the presence table before releasing code', () => {
    assert.match(migrationHarness, /CREATE TABLE IF NOT EXISTS project_presence/);
    assert.match(migrationHarness, /\$result\['project_presence_table'\] = true/);
    assert.match(deployWorkflow, /\.project_presence_table == true/);
});

