(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TakeoffCollaborationReconciler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const text = value => value == null ? '' : String(value);

    function identity(row) {
        return text(row?.client_uid || row?.id);
    }

    function operationIdentity(row) {
        return text(row?.placement_operation_id || row?.metadata_json?.placement_operation_id);
    }

    function normalizeSet(values) {
        return new Set(Array.from(values || [], text));
    }

    function reconcileCollection(localRows, remoteRows, options = {}) {
        const dirtyIds = normalizeSet(options.dirtyIds);
        const deletedIds = normalizeSet(options.deletedIds);
        const local = Array.isArray(localRows) ? localRows.filter(Boolean) : [];
        const remote = Array.isArray(remoteRows) ? remoteRows.filter(Boolean) : [];
        const remoteById = new Map();
        const remoteByOperation = new Map();

        for (const row of remote) {
            const id = identity(row);
            const operationId = operationIdentity(row);
            if (!id || deletedIds.has(id) || remoteById.has(id)) continue;
            if (operationId && remoteByOperation.has(operationId)) continue;
            remoteById.set(id, row);
            if (operationId) remoteByOperation.set(operationId, row);
        }

        const rows = [];
        const consumedRemoteIds = new Set();
        const resultIds = new Set();
        const resultOperations = new Set();

        const append = row => {
            const id = identity(row);
            const operationId = operationIdentity(row);
            if (!id || resultIds.has(id) || (operationId && resultOperations.has(operationId))) return;
            rows.push(row);
            resultIds.add(id);
            if (operationId) resultOperations.add(operationId);
        };

        for (const localRow of local) {
            const id = identity(localRow);
            const operationId = operationIdentity(localRow);
            if (!id || deletedIds.has(id)) continue;

            if (dirtyIds.has(id)) {
                append(localRow);
                const matchingRemote = remoteById.get(id) || (operationId ? remoteByOperation.get(operationId) : null);
                if (matchingRemote) consumedRemoteIds.add(identity(matchingRemote));
                continue;
            }

            const canonical = remoteById.get(id) || (operationId ? remoteByOperation.get(operationId) : null);
            if (canonical) {
                append(canonical);
                consumedRemoteIds.add(identity(canonical));
            }
            // A clean local row absent from the authoritative snapshot was deleted remotely.
        }

        for (const remoteRow of remoteById.values()) {
            const id = identity(remoteRow);
            if (!consumedRemoteIds.has(id)) append(remoteRow);
        }

        const localIds = new Set(local.map(identity).filter(Boolean));
        const finalIds = new Set(rows.map(identity).filter(Boolean));
        return {
            rows,
            addedIds: [...finalIds].filter(id => !localIds.has(id)),
            removedIds: [...localIds].filter(id => !finalIds.has(id)),
            retainedDirtyIds: [...dirtyIds].filter(id => finalIds.has(id))
        };
    }

    function shouldApplyRevision(appliedRevision, incomingRevision) {
        const applied = Number(appliedRevision || 0);
        const incoming = Number(incomingRevision || 0);
        return Number.isFinite(incoming) && incoming > applied;
    }

    return { identity, operationIdentity, reconcileCollection, shouldApplyRevision };
});
