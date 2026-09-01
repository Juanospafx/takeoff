(function (root, factory) {
    const service = factory();
    if (typeof module === 'object' && module.exports) module.exports = service;
    if (root) root.QuantityFormatService = service;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

    function estimating(value) {
        return number(value).toLocaleString('en-US', {
            useGrouping: false,
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });
    }

    function proposal(value) {
        return String(Math.round(number(value)));
    }

    function format(value, context = 'estimating') {
        return context === 'proposal' ? proposal(value) : estimating(value);
    }

    return Object.freeze({ number, estimating, proposal, format });
});
