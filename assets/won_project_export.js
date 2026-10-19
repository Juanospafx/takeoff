(function () {
    'use strict';

    function initWonProjectExport() {
        let config = window.WonProjectConfig || null;
        if (!config) {
            const configEl = document.getElementById('wonProjectConfigData');
            if (configEl && configEl.textContent) {
                try {
                    config = JSON.parse(configEl.textContent);
                } catch (e) {
                    config = null;
                }
            }
        }

        if (!config || !config.projectId || config.projectId <= 0) {
            return;
        }

        const markAsWonBtn = document.getElementById('markAsWonBtn');
        const retryWonExportBtn = document.getElementById('retryWonExportBtn');
        const statusBadge = document.getElementById('wonExportStatusBadge');
        const statusLabel = document.getElementById('wonExportStatusLabel');
        const statusMeta = document.getElementById('wonExportStatusMeta');
        const alertEl = document.getElementById('wonProjectAlert');
        const statusButton = document.getElementById('projectStatusButton');
        const statusButtonLabel = document.getElementById('projectStatusLabel');

        function showAlert(message, type) {
            if (!alertEl) return;
            alertEl.textContent = message;
            alertEl.className = 'won-export-alert alert-' + (type || 'error');
            alertEl.style.display = 'block';
        }

        function hideAlert() {
            if (!alertEl) return;
            alertEl.style.display = 'none';
            alertEl.textContent = '';
        }

        function updateProjectStatusPill(newStatus) {
            if (!statusButton) return;
            const normalized = (newStatus || '').toLowerCase();
            statusButton.className = statusButton.className.replace(/\bstatus-[a-z0-9_-]+/gi, '').trim() + ' status-' + normalized;
            statusButton.setAttribute('data-status', normalized);
            if (statusButtonLabel) {
                statusButtonLabel.textContent = normalized.toUpperCase();
            }
        }

        function renderOutboxState(outbox, isIntegrationEnabled, projectStatus) {
            if (!statusBadge) return;

            if (projectStatus === 'accepted' && markAsWonBtn) {
                markAsWonBtn.disabled = true;
            }

            if (!isIntegrationEnabled) {
                if (retryWonExportBtn) retryWonExportBtn.style.display = 'none';
                if (projectStatus === 'accepted') {
                    statusBadge.style.display = 'inline-flex';
                    statusBadge.className = 'won-export-status-badge status-disabled';
                    if (statusLabel) statusLabel.textContent = 'Export Disabled';
                    if (statusMeta) statusMeta.textContent = '';
                } else {
                    statusBadge.style.display = 'none';
                }
                return;
            }

            if (!outbox) {
                if (retryWonExportBtn) retryWonExportBtn.style.display = 'none';
                statusBadge.style.display = 'none';
                return;
            }

            const state = outbox.status || '';
            statusBadge.style.display = 'inline-flex';

            if (state === 'pending') {
                statusBadge.className = 'won-export-status-badge status-pending';
                if (statusLabel) statusLabel.textContent = 'Export Pending';
                let metaText = '';
                if (typeof outbox.attempts === 'number' && outbox.attempts > 0) {
                    metaText += ' (Attempt ' + outbox.attempts + ')';
                }
                if (outbox.next_attempt_at) {
                    metaText += ' Next: ' + outbox.next_attempt_at;
                }
                if (statusMeta) statusMeta.textContent = metaText;
                if (retryWonExportBtn) retryWonExportBtn.style.display = 'none';
            } else if (state === 'delivered') {
                statusBadge.className = 'won-export-status-badge status-delivered';
                if (statusLabel) statusLabel.textContent = 'Export Delivered';
                if (statusMeta) {
                    statusMeta.textContent = outbox.delivered_at ? ' at ' + outbox.delivered_at : '';
                }
                if (retryWonExportBtn) retryWonExportBtn.style.display = 'none';
            } else if (state === 'failed') {
                statusBadge.className = 'won-export-status-badge status-failed';
                if (statusLabel) statusLabel.textContent = 'Export Failed';
                if (statusMeta) {
                    statusMeta.textContent = typeof outbox.attempts === 'number' ? ' (' + outbox.attempts + ' attempts)' : '';
                }
                if (config.isAdmin && isIntegrationEnabled && retryWonExportBtn) {
                    retryWonExportBtn.style.display = 'inline-flex';
                } else if (retryWonExportBtn) {
                    retryWonExportBtn.style.display = 'none';
                }
            } else {
                statusBadge.style.display = 'none';
                if (retryWonExportBtn) retryWonExportBtn.style.display = 'none';
            }
        }

        function fetchStatus() {
            const url = '../api/won_project.php?action=status&project_id=' + encodeURIComponent(config.projectId);
            fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            })
                .then(function (res) {
                    return res.json();
                })
                .then(function (data) {
                    if (data && data.status === 'success') {
                        const projectStatus = data.project_status || '';
                        if (projectStatus === 'accepted') {
                            updateProjectStatusPill('accepted');
                        }
                        renderOutboxState(data.outbox, data.integration_enabled, projectStatus);
                    }
                })
                .catch(function () {
                    // Non-blocking background status fetch
                });
        }

        if (markAsWonBtn && config.isAdmin) {
            markAsWonBtn.addEventListener('click', function () {
                hideAlert();
                const confirmed = window.confirm('Are you sure you want to mark this project as won? This will transition the status to Accepted and queue the export.');
                if (!confirmed) {
                    return;
                }

                markAsWonBtn.disabled = true;
                const originalHtml = markAsWonBtn.innerHTML;
                markAsWonBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Processing...</span>';

                fetch('../api/won_project.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRF-Token': config.token
                    },
                    body: JSON.stringify({
                        action: 'mark_won',
                        project_id: config.projectId,
                        csrf_token: config.token
                    })
                })
                    .then(function (res) {
                        return res.json().then(function (json) {
                            return { ok: res.ok, status: res.status, data: json };
                        });
                    })
                    .then(function (result) {
                        markAsWonBtn.innerHTML = originalHtml;
                        if (result.ok && result.data && result.data.status === 'success') {
                            markAsWonBtn.disabled = true;
                            updateProjectStatusPill('accepted');
                            renderOutboxState(result.data.outbox, result.data.integration_enabled, 'accepted');
                            showAlert('Project successfully marked as won.', 'success');
                        } else {
                            const errorMsg = (result.data && result.data.message) || 'Unable to mark project as won.';
                            showAlert(errorMsg, 'error');
                            if (result.data && result.data.project_status === 'accepted') {
                                markAsWonBtn.disabled = true;
                            } else {
                                markAsWonBtn.disabled = false;
                            }
                        }
                    })
                    .catch(function () {
                        markAsWonBtn.innerHTML = originalHtml;
                        markAsWonBtn.disabled = false;
                        showAlert('A network error occurred while communicating with the server.', 'error');
                    });
            });
        }

        if (retryWonExportBtn && config.isAdmin) {
            retryWonExportBtn.addEventListener('click', function () {
                hideAlert();
                const confirmed = window.confirm('Retry export delivery for this project?');
                if (!confirmed) {
                    return;
                }

                retryWonExportBtn.disabled = true;
                const originalHtml = retryWonExportBtn.innerHTML;
                retryWonExportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Retrying...</span>';

                fetch('../api/won_project.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRF-Token': config.token
                    },
                    body: JSON.stringify({
                        action: 'retry',
                        project_id: config.projectId,
                        csrf_token: config.token
                    })
                })
                    .then(function (res) {
                        return res.json().then(function (json) {
                            return { ok: res.ok, status: res.status, data: json };
                        });
                    })
                    .then(function (result) {
                        retryWonExportBtn.innerHTML = originalHtml;
                        if (result.ok && result.data && result.data.status === 'success') {
                            updateProjectStatusPill('accepted');
                            if (markAsWonBtn) markAsWonBtn.disabled = true;
                            renderOutboxState(result.data.outbox, result.data.integration_enabled, 'accepted');
                            showAlert('Export retry successfully scheduled.', 'success');
                        } else {
                            retryWonExportBtn.disabled = false;
                            const errorMsg = (result.data && result.data.message) || 'Unable to retry export.';
                            showAlert(errorMsg, 'error');
                        }
                    })
                    .catch(function () {
                        retryWonExportBtn.innerHTML = originalHtml;
                        retryWonExportBtn.disabled = false;
                        showAlert('A network error occurred while retrying the export.', 'error');
                    });
            });
        }

        fetchStatus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWonProjectExport);
    } else {
        initWonProjectExport();
    }
})();
