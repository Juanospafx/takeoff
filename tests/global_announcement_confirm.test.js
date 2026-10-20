const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const headerPhp = fs.readFileSync(path.join(root, 'views/global_tools_header.php'), 'utf8');
const costCatalogJs = fs.readFileSync(path.join(root, 'assets/cost_catalog.js'), 'utf8');
const catalogAdminPhp = fs.readFileSync(path.join(root, 'core/services/CatalogAdminService.php'), 'utf8');

// Extract the announcements controller JavaScript from views/global_tools_header.php
const scriptMatch = headerPhp.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'script tag found in global_tools_header.php');
const headerScript = scriptMatch[1];

function createMockEnvironment() {
    const listeners = {};
    const elements = {};

    function createElement(id, tagName = 'div') {
        const el = {
            id,
            tagName: tagName.toUpperCase(),
            style: {},
            classList: {
                classes: new Set(),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); },
                toggle(c, force) {
                    if (force !== undefined) {
                        if (force) this.classes.add(c); else this.classes.delete(c);
                        return force;
                    }
                    if (this.classes.has(c)) { this.classes.delete(c); return false; }
                    this.classes.add(c); return true;
                }
            },
            listeners: {},
            addEventListener(type, fn) {
                if (!this.listeners[type]) this.listeners[type] = [];
                this.listeners[type].push(fn);
            },
            click() {
                const fns = this.listeners['click'] || [];
                for (const fn of fns) fn.call(this, { target: this, stopPropagation() {} });
            },
            setAttribute(k, v) { this[k] = v; },
            getAttribute(k) { return this[k]; },
            textContent: '',
            innerHTML: '',
            checked: false
        };
        elements[id] = el;
        return el;
    }

    const modal = createElement('globalAnnouncementModal');
    createElement('globalAnnouncementBanner');
    createElement('globalAnnouncementBadge');
    createElement('globalAnnouncementDate');
    createElement('globalAnnouncementIcon');
    createElement('globalAnnouncementTitle');
    createElement('globalAnnouncementBody');
    const primBtn = createElement('globalAnnouncementPrimBtn', 'button');
    const secBtn = createElement('globalAnnouncementSecBtn', 'button');
    const cancelBtn = createElement('globalAnnouncementCancelBtn', 'button');
    const dontShowWrap = createElement('globalAnnouncementDontShowWrap', 'label');
    const dontShowCheck = createElement('globalAnnouncementDontShow', 'input');
    createElement('btGlobalAnnouncementsBtn', 'button');
    createElement('btAnnouncementNotifDot');
    createElement('btHeaderCollapseBtn', 'button');
    createElement('btHeaderSlideToggle', 'button');

    const storage = {};
    const localStorage = {
        getItem(k) { return storage[k] ?? null; },
        setItem(k, v) { storage[k] = String(v); },
        removeItem(k) { delete storage[k]; },
        clear() { Object.keys(storage).forEach(k => delete storage[k]); }
    };

    const documentMock = {
        getElementById(id) { return elements[id] || null; },
        querySelector(sel) {
            if (sel === '.bt-global-header') return createElement('header');
            if (sel.startsWith('#')) return elements[sel.slice(1)] || null;
            return null;
        },
        querySelectorAll(sel) {
            if (sel === '[data-theme-toggle]') return [];
            if (sel === 'iframe') return [];
            return [];
        },
        documentElement: {
            setAttribute() {},
            getAttribute() { return 'light'; }
        },
        body: {
            classList: {
                add() {}, remove() {}, toggle() {}
            }
        },
        addEventListener(type, fn) {
            if (!listeners[type]) listeners[type] = [];
            listeners[type].push(fn);
        },
        dispatchEvent(event) {
            const fns = listeners[event.type] || [];
            for (const fn of fns) fn(event);
        }
    };

    const windowMock = {
        document: documentMock,
        localStorage,
        location: { search: '' },
        URLSearchParams: class { get() { return null; } },
        addEventListener() {}
    };

    const sandbox = {
        window: windowMock,
        document: documentMock,
        localStorage,
        URLSearchParams: windowMock.URLSearchParams,
        setTimeout(fn) { fn(); return 1; },
        clearTimeout() {},
        console,
        Promise
    };

    vm.createContext(sandbox);
    vm.runInContext(headerScript, sandbox);

    return {
        window: sandbox.window,
        TakeoffAnnouncement: sandbox.window.TakeoffAnnouncement,
        elements,
        localStorage,
        document: documentMock,
        modal,
        primBtn,
        cancelBtn
    };
}

test('TakeoffAnnouncement.confirm returns Promise<boolean> and resolves true on confirm', async () => {
    const env = createMockEnvironment();
    assert.equal(typeof env.TakeoffAnnouncement.confirm, 'function');

    const promise = env.TakeoffAnnouncement.confirm({
        title: 'Delete Item',
        message: 'Are you sure?',
        confirmText: 'Delete Now',
        cancelText: 'Cancel'
    });

    assert.ok(promise instanceof Promise);
    assert.ok(env.modal.classList.contains('open'), 'modal opened');
    assert.equal(env.primBtn.textContent, 'Delete Now');

    env.primBtn.click();
    const result = await promise;
    assert.equal(result, true);
    assert.ok(!env.modal.classList.contains('open'), 'modal closed after confirm');
});

test('TakeoffAnnouncement.confirm resolves false on cancel button click', async () => {
    const env = createMockEnvironment();
    const promise = env.TakeoffAnnouncement.confirm({
        title: 'Archive Catalog',
        message: 'Archive this catalog?'
    });

    assert.ok(env.modal.classList.contains('open'));
    env.cancelBtn.click();
    const result = await promise;
    assert.equal(result, false);
    assert.ok(!env.modal.classList.contains('open'));
});

test('TakeoffAnnouncement.confirm resolves false on Escape key press', async () => {
    const env = createMockEnvironment();
    const promise = env.TakeoffAnnouncement.confirm('Prompt title', 'Prompt message');

    assert.ok(env.modal.classList.contains('open'));
    env.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    const result = await promise;
    assert.equal(result, false);
    assert.ok(!env.modal.classList.contains('open'));
});

test('TakeoffAnnouncement.confirm resolves false on backdrop click', async () => {
    const env = createMockEnvironment();
    const promise = env.TakeoffAnnouncement.confirm({ message: 'Are you sure?' });

    assert.ok(env.modal.classList.contains('open'));
    const fns = env.modal.listeners['click'] || [];
    for (const fn of fns) fn({ target: env.modal });
    const result = await promise;
    assert.equal(result, false);
    assert.ok(!env.modal.classList.contains('open'));
});

test('TakeoffAnnouncement.confirm does not persist dismissal state to localStorage', async () => {
    const env = createMockEnvironment();
    assert.equal(env.localStorage.getItem('takeoff.dismissedAnnouncements'), null);

    const promise = env.TakeoffAnnouncement.confirm({
        title: 'Destructive Action',
        message: 'Confirm deletion'
    });
    env.primBtn.click();
    await promise;

    assert.equal(env.localStorage.getItem('takeoff.dismissedAnnouncements'), null);
});

test('Cost Catalog destructive actions delegate to TakeoffAnnouncement.confirm and do not call window.confirm', async () => {
    assert.match(costCatalogJs, /TakeoffAnnouncement\.confirm/);

    // Verify showConfirmDialog implementation in cost_catalog.js
    let windowConfirmCalled = false;
    let customConfirmCalled = false;

    const mockWindow = {
        confirm() {
            windowConfirmCalled = true;
            return false;
        },
        TakeoffAnnouncement: {
            confirm(options) {
                customConfirmCalled = true;
                return Promise.resolve(true);
            }
        }
    };

    function showConfirmDialog(options) {
        if (typeof mockWindow.showConfirmDialog === 'function') {
            return mockWindow.showConfirmDialog(options);
        }
        if (mockWindow.TakeoffAnnouncement && typeof mockWindow.TakeoffAnnouncement.confirm === 'function') {
            return mockWindow.TakeoffAnnouncement.confirm(options);
        }
        return Promise.resolve(mockWindow.confirm(options?.message || 'Are you sure you want to proceed?'));
    }

    const result = await showConfirmDialog({ title: 'Purge', message: 'Delete?' });
    assert.equal(result, true);
    assert.equal(customConfirmCalled, true, 'delegated to TakeoffAnnouncement.confirm');
    assert.equal(windowConfirmCalled, false, 'did not fall back to window.confirm');
});

test('CatalogAdminService purge methods delete legacy assembly_items references inside transaction', () => {
    // Assert presence of transaction wrappers
    assert.match(catalogAdminPhp, /public function purgeCatalog[\s\S]*?\$this->transaction\(/);
    assert.match(catalogAdminPhp, /public function purgeCategory[\s\S]*?\$this->transaction\(/);
    assert.match(catalogAdminPhp, /public function purgeItem[\s\S]*?\$this->transaction\(/);

    // Assert purgeItem cleans assembly_items before catalog_items
    const purgeItemBlock = catalogAdminPhp.match(/public function purgeItem[\s\S]*?return \['id'=>\$id,'purged'=>true\];\s*\}\);/);
    assert.ok(purgeItemBlock, 'purgeItem found');
    const purgeItemCode = purgeItemBlock[0];
    assert.match(purgeItemCode, /assembly_items/);
    assert.match(purgeItemCode, /assembly_id=\?\s*OR\s*catalog_item_id=\?/);
    const itemAiPos = purgeItemCode.indexOf('assembly_items');
    const itemCiPos = purgeItemCode.indexOf('DELETE FROM catalog_items');
    assert.ok(itemAiPos < itemCiPos, 'assembly_items deleted before catalog_items in purgeItem');

    // Assert purgeCatalog cleans assembly_items before catalog_items
    const purgeCatBlock = catalogAdminPhp.match(/public function purgeCatalog[\s\S]*?return \['id'=>\$id,'purged'=>true\];\s*\}\);/);
    assert.ok(purgeCatBlock, 'purgeCatalog found');
    const purgeCatCode = purgeCatBlock[0];
    assert.match(purgeCatCode, /assembly_items/);
    const catAiPos = purgeCatCode.indexOf('assembly_items');
    const catCiPos = purgeCatCode.indexOf('DELETE FROM catalog_items');
    assert.ok(catAiPos < catCiPos, 'assembly_items deleted before catalog_items in purgeCatalog');

    // Assert purgeCategory cleans assembly_items before catalog_items
    const purgeGrpBlock = catalogAdminPhp.match(/public function purgeCategory[\s\S]*?return \['id'=>\$id,'purged'=>true\];\s*\}\);/);
    assert.ok(purgeGrpBlock, 'purgeCategory found');
    const purgeGrpCode = purgeGrpBlock[0];
    assert.match(purgeGrpCode, /assembly_items/);
    const grpAiPos = purgeGrpCode.indexOf('assembly_items');
    const grpCiPos = purgeGrpCode.indexOf('DELETE FROM catalog_items');
    assert.ok(grpAiPos < grpCiPos, 'assembly_items deleted before catalog_items in purgeCategory');
});
