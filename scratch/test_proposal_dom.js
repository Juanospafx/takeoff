const fs = require('fs');

// Simple DOM Mock
class MockElement {
    constructor(tag = 'div', id = '') {
        this.tagName = tag.toUpperCase();
        this.id = id;
        this.className = '';
        this.dataset = {};
        this.children = [];
        this.parentElement = null;
        this._innerHTML = '';
        this.textContent = '';
        this.attributes = {};
        this.hidden = false;
        this.style = {};
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
        this._innerHTML = val;
        this.textContent = val.replace(/<[^>]*>/g, '');
    }
    querySelector(sel) { return null; }
    querySelectorAll(sel) { return []; }
    closest(sel) { return null; }
    addEventListener(evt, fn) {}
    remove() {}
}

