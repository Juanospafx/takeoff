(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TakeoffPlacementGuard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function finite(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function operationId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `placement_${crypto.randomUUID()}`;
        }
        return `placement_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    }

    function createPlacementGuard(options = {}) {
        const windowMs = Math.max(50, finite(options.windowMs, 500));
        const tolerance = Math.max(0, finite(options.coordinateTolerance, 0.5));
        const nativeEvents = new Set();
        let lastEvent = null;

        function samePlacement(left, right) {
            if (!left || !right) return false;
            const pointerMatches = left.pointerId === '' || right.pointerId === ''
                || String(left.pointerId) === String(right.pointerId);
            return String(left.layerId || '') === String(right.layerId || '')
                && Number(left.pageNumber || 1) === Number(right.pageNumber || 1)
                && pointerMatches
                && Math.abs(finite(left.x) - finite(right.x)) <= tolerance
                && Math.abs(finite(left.y) - finite(right.y)) <= tolerance;
        }

        function begin(raw = {}) {
            const event = {
                layerId: String(raw.layerId || ''),
                pageNumber: Math.max(1, Number(raw.pageNumber || 1)),
                pointerId: raw.pointerId ?? '',
                eventType: String(raw.eventType || 'unknown').toLowerCase(),
                eventTimestamp: finite(raw.eventTimestamp, Date.now()),
                x: finite(raw.x),
                y: finite(raw.y)
            };
            const nativeKey = [event.layerId, event.pageNumber, event.pointerId,
                event.eventType, event.eventTimestamp].join(':');
            if (nativeEvents.has(nativeKey)) return null;
            nativeEvents.add(nativeKey);
            if (nativeEvents.size > 64) nativeEvents.delete(nativeEvents.values().next().value);

            const compatibilityDuplicate = lastEvent
                && lastEvent.eventType !== event.eventType
                && Math.abs(event.eventTimestamp - lastEvent.eventTimestamp) <= windowMs
                && samePlacement(lastEvent, event);
            lastEvent = event;
            if (compatibilityDuplicate) return null;
            return operationId();
        }

        function reset() {
            nativeEvents.clear();
            lastEvent = null;
        }

        return { begin, reset };
    }

    return { createPlacementGuard };
});
