(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ProjectOverviewDialogs = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function create(dependencies = {}) {
        const { getElement: $, escapeHtml, showToast } = dependencies;
        const windowRef = dependencies.window || (typeof window !== 'undefined' ? window : globalThis);
        let currentRenameCallback = null;
        let renameBindingsReady = false;

        function bindRenameForm() {
            if (renameBindingsReady) return;
            renameBindingsReady = true;
            $('modalSaveDocRenameBtn')?.addEventListener('click', () => {
                const input = $('modalDocRenameInput');
                const value = input ? input.value.trim() : '';
                if (!value) {
                    showToast('Please enter a valid name.');
                    return;
                }
                $('pdDocRenameModal')?.classList.remove('open');
                if (typeof currentRenameCallback !== 'function') return;
                const callback = currentRenameCallback;
                currentRenameCallback = null;
                callback(value);
            });
            $('modalDocRenameInput')?.addEventListener('keydown', event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                $('modalSaveDocRenameBtn')?.click();
            });
        }

        function openRenameModal({ title = 'Rename', label = 'Name', currentName = '', onSave }) {
            const modal = $('pdDocRenameModal');
            const titleElement = $('docRenameModalTitle');
            const labelElement = $('docRenameInputLabel');
            const input = $('modalDocRenameInput');
            if (!modal || !input) return;
            bindRenameForm();
            if (titleElement) titleElement.innerHTML = `<i class="fas fa-pen" style="color: var(--primary);"></i> ${escapeHtml(title)}`;
            if (labelElement) labelElement.textContent = label;
            input.value = currentName;
            currentRenameCallback = onSave;
            modal.classList.add('open');
            setTimeout(() => {
                input.focus();
                input.select();
            }, 50);
        }

        function showConfirmDialog({
            title = 'Confirm Action',
            message = 'Are you sure you want to proceed?',
            confirmText = 'Delete',
            cancelText = 'Cancel',
            type = 'error',
            badge = 'CONFIRMATION',
            icon = 'fas fa-trash',
            primaryDanger = true
        }) {
            return new Promise(resolve => {
                if (windowRef.TakeoffAnnouncement && typeof windowRef.TakeoffAnnouncement.show === 'function') {
                    let resolved = false;
                    windowRef.TakeoffAnnouncement.show({
                        force: true, type, title, badge, icon, message,
                        primaryText: confirmText,
                        primaryDanger,
                        cancelText,
                        showDontShow: false,
                        onPrimary: () => {
                            if (resolved) return;
                            resolved = true;
                            resolve(true);
                        },
                        onCancel: () => {
                            if (resolved) return;
                            resolved = true;
                            resolve(false);
                        }
                    });
                    return;
                }
                resolve(windowRef.confirm(message));
            });
        }

        function showAlertDialog({
            title = 'Notice',
            message = '',
            buttonText = 'Got It',
            type = 'warning',
            badge = 'NOTICE',
            icon = 'fas fa-circle-exclamation'
        }) {
            if (windowRef.TakeoffAnnouncement && typeof windowRef.TakeoffAnnouncement.show === 'function') {
                windowRef.TakeoffAnnouncement.show({
                    force: true, type, title, badge, icon, message,
                    primaryText: buttonText,
                    cancelText: null,
                    secondaryText: null,
                    showDontShow: false
                });
                return;
            }
            showToast(message);
        }

        return Object.freeze({ bindRenameForm, openRenameModal, showConfirmDialog, showAlertDialog });
    }

    return Object.freeze({ create });
});
