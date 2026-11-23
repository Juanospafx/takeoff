(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TakeoffObjectRepairService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const text = value => value == null ? '' : String(value);

    function markerSignature(marker) {
        return JSON.stringify([
            text(marker.layer_client_uid || marker.layer_id),
            Math.max(1, Number(marker.page_number || 1)),
            number(marker.x), number(marker.y),
            text(marker.symbol || 'circle'), text(marker.color || ''),
            text(marker.label), number(marker.multiplier ?? 1),
            number(marker.quantity ?? marker.multiplier ?? 1),
            text(marker.notes), number(marker.symbol_size ?? marker.size),
            Number(marker.locked ?? marker.metadata_json?.element_locked ?? 0),
            text(marker.catalog_item_id), text(marker.assembly_id)
        ]);
    }

    function segmentSignature(segment) {
        const points = Array.isArray(segment.points_json) ? segment.points_json.map(point => [
            number(point?.x), number(point?.y)
        ]) : [];
        return JSON.stringify([
            text(segment.layer_client_uid || segment.layer_id),
            Math.max(1, Number(segment.page_number || 1)),
            points,
            number(segment.measured_length), number(segment.multiplier ?? 1),
            number(segment.total_length), number(segment.total_area),
            text(segment.unit), text(segment.color), number(segment.stroke_width),
            text(segment.label), text(segment.notes),
            text(segment.takeoff_subtype || segment.takeoff_type || segment.type),
            number(segment.drop_length ?? segment.dropLength),
            number(segment.spacing ?? segment.metadata_json?.spacing),
            Number(segment.locked ?? segment.metadata_json?.element_locked ?? 0),
            text(segment.catalog_item_id), text(segment.assembly_id)
        ]);
    }

    function dedupe(rows, signature) {
        const seen = new Set();
        const kept = [];
        const removed = [];
        const affectedPages = new Set();
        for (const row of Array.isArray(rows) ? rows : []) {
            if (!row || typeof row !== 'object') continue;
            const key = signature(row);
            if (seen.has(key)) {
                removed.push(row);
                affectedPages.add(Math.max(1, Number(row.page_number || 1)));
                continue;
            }
            seen.add(key);
            kept.push(row);
        }
        return { kept, removed, affectedPages };
    }

    function repair(markers, segments) {
        const markerResult = dedupe(markers, markerSignature);
        const segmentResult = dedupe(segments, segmentSignature);
        const affectedPages = new Set([
            ...markerResult.affectedPages,
            ...segmentResult.affectedPages
        ]);
        return {
            markers: markerResult.kept,
            segments: segmentResult.kept,
            removedMarkers: markerResult.removed,
            removedSegments: segmentResult.removed,
            affectedPages: [...affectedPages].sort((a, b) => a - b),
            changed: markerResult.removed.length > 0 || segmentResult.removed.length > 0
        };
    }

    return { markerSignature, segmentSignature, repair };
});
