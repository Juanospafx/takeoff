(function () {
    const apiUrl = '../api/company_settings.php';
    let state = { settings: {}, costTypes: [], projectStatuses: [], estimateTypes: [], users: [] };
    const settingKeys = [
        'company_name', 'logo_url', 'address', 'phone', 'email', 'default_currency',
        'default_tax_labor_rate', 'default_tax_material_rate', 'default_overhead_percentage',
        'default_profit_percentage', 'default_waste_percentage', 'proposal_template',
        'pdf_header_footer', 'logo_visibility', 'signature_block'
    ];

    function getTakeoffAuth() {
        if (typeof window !== 'undefined' && window.TakeoffAuth) {
            return window.TakeoffAuth;
        }
        if (typeof document !== 'undefined') {
            try {
                const el = document.getElementById('takeoff-auth-metadata');
                if (el && el.textContent) {
                    const parsed = JSON.parse(el.textContent);
                    if (typeof window !== 'undefined') {
                        window.TakeoffAuth = Object.freeze(Object.assign({}, parsed));
                    }
                    return parsed;
                }
            } catch (_) {}
            try {
                const headerEl = document.querySelector('[data-global-tools-header]') || document.querySelector('.bt-global-header') || document.body;
                if (headerEl && typeof headerEl.getAttribute === 'function') {
                    const role = headerEl.getAttribute('data-user-role') || 'viewer';
                    const canWriteVal = headerEl.getAttribute('data-can-write') === 'true' || headerEl.getAttribute('data-can-mutate') === 'true';
                    const readOnlyVal = headerEl.getAttribute('data-read-only') === 'true' || !canWriteVal;
                    const auth = {
                        displayName: headerEl.getAttribute('data-display-name') || '',
                        role: role,
                        canWrite: canWriteVal,
                        readOnly: readOnlyVal
                    };
                    if (typeof window !== 'undefined') {
                        window.TakeoffAuth = Object.freeze(Object.assign({}, auth));
                    }
                    return auth;
                }
            } catch (_) {}
        }
        return null;
    }

    function canWrite() {
        const auth = getTakeoffAuth();
        return Boolean(auth && auth.canWrite === true);
    }

    function isReadOnly() {
        return !canWrite();
    }

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[ch]));

    function request(action, payload = {}) {
        if (action !== 'list' && !canWrite()) {
            const error = new Error('Read-only mode: mutations are not permitted.');
            showError(error.message);
            return Promise.reject(error);
        }
        return fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        }).then(r => r.json()).then(data => {
            if (data.status !== 'success') throw new Error(data.msg || 'Settings request failed');
            return data;
        });
    }

    function load() {
        fetch(`${apiUrl}?action=list`)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') throw new Error(data.msg || 'Settings could not load');
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function render() {
        const writable = canWrite();
        settingKeys.forEach(key => {
            const el = document.getElementById(key);
            if (el) {
                el.value = state.settings[key] ?? '';
                if (!writable) {
                    el.disabled = true;
                    el.setAttribute('readonly', 'readonly');
                    el.classList.add('viewer-control-disabled');
                }
            }
        });

        const saveBtn = document.getElementById('csSaveSettings');
        if (saveBtn && !writable) {
            saveBtn.disabled = true;
            saveBtn.style.display = 'none';
        }

        if (!writable) {
            document.querySelectorAll('[data-add-list], #csAddUser').forEach(btn => {
                btn.disabled = true;
                btn.style.display = 'none';
            });
        }

        renderList('costTypesList', 'cost_types', state.costTypes);
        renderList('projectStatusesList', 'project_statuses', state.projectStatuses);
        renderList('estimateTypesList', 'estimate_types', state.estimateTypes);
        renderUsers();
    }

    function renderList(rootId, listName, rows) {
        const root = document.getElementById(rootId);
        if (!root) return;
        const writable = canWrite();
        root.innerHTML = rows.map(row => `
            <div class="cs-list-row">
                <div><strong>${esc(row.name)}</strong><br><small>${Number(row.active) ? 'Active' : 'Inactive'} · Sort ${esc(row.sort_order || 0)}</small></div>
                ${writable ? `
                <button class="cs-btn" data-edit-list="${listName}" data-id="${row.id}">Edit</button>
                <button class="cs-btn danger" data-delete-list="${listName}" data-id="${row.id}">Delete</button>
                ` : ''}
            </div>
        `).join('') || '<div class="cs-list-row"><small>No entries yet.</small></div>';
        if (writable) {
            root.querySelectorAll('[data-edit-list]').forEach(btn => btn.addEventListener('click', () => editListItem(btn.dataset.editList, Number(btn.dataset.id))));
            root.querySelectorAll('[data-delete-list]').forEach(btn => btn.addEventListener('click', () => deleteListItem(btn.dataset.deleteList, Number(btn.dataset.id))));
        }
    }

    function renderUsers() {
        const root = document.getElementById('usersList');
        if (!root) return;
        const writable = canWrite();
        root.innerHTML = state.users.map(user => `
            <div class="cs-list-row">
                <div><strong>${esc(user.display_name)}</strong><br><small>${esc(user.email || '-')} · ${esc(user.role_name)} · ${esc(user.status)} · ${Number(user.estimator_flag) ? 'Estimator' : 'No estimator flag'}</small></div>
                ${writable ? `
                <button class="cs-btn" data-edit-user="${user.id}">Edit</button>
                <button class="cs-btn danger" data-delete-user="${user.id}">Delete</button>
                ` : ''}
            </div>
        `).join('') || '<div class="cs-list-row"><small>No configured users yet.</small></div>';
        if (writable) {
            root.querySelectorAll('[data-edit-user]').forEach(btn => btn.addEventListener('click', () => editUser(Number(btn.dataset.editUser))));
            root.querySelectorAll('[data-delete-user]').forEach(btn => btn.addEventListener('click', () => deleteUser(Number(btn.dataset.deleteUser))));
        }
    }

    function saveSettings() {
        if (!canWrite()) {
            showError('Read-only mode: mutations are not permitted.');
            return;
        }
        const settings = {};
        settingKeys.forEach(key => {
            const el = document.getElementById(key);
            if (el) settings[key] = el.value;
        });
        request('save_settings', { settings })
            .then(data => {
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function editListItem(listName, id = 0) {
        if (!canWrite()) {
            showError('Read-only mode: mutations are not permitted.');
            return;
        }
        const collection = listName === 'cost_types' ? state.costTypes : (listName === 'project_statuses' ? state.projectStatuses : state.estimateTypes);
        const row = collection.find(item => Number(item.id) === Number(id));
        const name = prompt('Name', row?.name || '');
        if (!name) return;
        const sort = prompt('Sort order', row?.sort_order || '0') || '0';
        const active = confirm('Should this entry be active?');
        request('save_list_item', { list: listName, id, name, sort_order: sort, active: active ? 1 : 0 })
            .then(data => {
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function deleteListItem(listName, id) {
        if (!canWrite()) {
            showError('Read-only mode: mutations are not permitted.');
            return;
        }
        if (!confirm('Delete this entry?')) return;
        request('delete_list_item', { list: listName, id })
            .then(data => {
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function editUser(id = 0) {
        if (!canWrite()) {
            showError('Read-only mode: mutations are not permitted.');
            return;
        }
        const user = state.users.find(row => Number(row.id) === Number(id));
        const displayName = prompt('Name', user?.display_name || '');
        if (!displayName) return;
        const email = prompt('Email', user?.email || '') || '';
        const roleName = prompt('Role', user?.role_name || 'Estimator') || 'Estimator';
        const status = prompt('Status', user?.status || 'Active') || 'Active';
        const estimatorFlag = confirm('Estimator flag?');
        request('save_user', { id, display_name: displayName, email, role_name: roleName, status, estimator_flag: estimatorFlag ? 1 : 0 })
            .then(data => {
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function deleteUser(id) {
        if (!canWrite()) {
            showError('Read-only mode: mutations are not permitted.');
            return;
        }
        if (!confirm('Delete this configured user?')) return;
        request('delete_user', { id })
            .then(data => {
                state = data.data;
                render();
            })
            .catch(err => showError(err.message));
    }

    function switchTab(tab) {
        document.querySelectorAll('[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
        document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === tab));
    }

    function showError(message) {
        const el = document.getElementById('csError');
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
        if (canWrite() === true) {
            document.querySelectorAll('[data-add-list]').forEach(btn => btn.addEventListener('click', () => editListItem(btn.dataset.addList)));
            document.querySelector('#csAddUser')?.addEventListener('click', () => editUser());
            document.querySelector('#csSaveSettings')?.addEventListener('click', saveSettings);
        } else {
            const saveBtn = document.querySelector('#csSaveSettings');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.style.display = 'none';
            }
            document.querySelectorAll('[data-add-list], #csAddUser').forEach(btn => {
                btn.disabled = true;
                btn.style.display = 'none';
            });
        }
        load();
    });

    if (typeof window !== 'undefined') {
        window.CompanySettingsClient = {
            canWrite,
            isReadOnly,
            saveSettings,
            editListItem,
            deleteListItem,
            editUser,
            deleteUser,
            request
        };
    }
})();
