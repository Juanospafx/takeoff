(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TakeoffColorPalette = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const COLORS = Object.freeze([
        Object.freeze({ label: 'Black', value: '#111827' }),
        Object.freeze({ label: 'Red', value: '#dc2626' }),
        Object.freeze({ label: 'Blue', value: '#2563eb' }),
        Object.freeze({ label: 'Green', value: '#16a34a' }),
        Object.freeze({ label: 'Orange', value: '#f97316' }),
        Object.freeze({ label: 'Purple', value: '#7c3aed' }),
        Object.freeze({ label: 'Yellow', value: '#eab308' })
    ]);

    const normalize = color => String(color || '').trim().toLowerCase();

    function duplicateColor(originalColor, siblingColors = []) {
        const original = normalize(originalColor);
        const used = new Set((siblingColors || []).map(normalize).filter(Boolean));
        const originalIndex = COLORS.findIndex(option => normalize(option.value) === original);
        const start = originalIndex >= 0 ? originalIndex + 1 : 0;

        // Prefer the next palette entry not already used by a sibling. This is
        // deterministic across reloads and produces a useful color sequence
        // when a duplicate is duplicated again.
        for (let offset = 0; offset < COLORS.length; offset += 1) {
            const candidate = COLORS[(start + offset) % COLORS.length].value;
            if (normalize(candidate) !== original && !used.has(normalize(candidate))) return candidate;
        }
        for (let offset = 0; offset < COLORS.length; offset += 1) {
            const candidate = COLORS[(start + offset) % COLORS.length].value;
            if (normalize(candidate) !== original) return candidate;
        }
        return originalColor;
    }

    return Object.freeze({ COLORS, duplicateColor });
});
