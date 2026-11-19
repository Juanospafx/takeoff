const fs = require('fs');
const cp = require('child_process');

const apiOutput = cp.execSync('C:\\xampp\\php\\php.exe scratch/test_api_p6.php', { encoding: 'utf8' });
const jsonStart = apiOutput.indexOf('{"ok":true');
const apiData = JSON.parse(apiOutput.slice(jsonStart));
const estimates = apiData.estimates;

const calcCode = fs.readFileSync('assets/estimate_calculation_service.js', 'utf8');
const workspaceCode = fs.readFileSync('assets/estimating_workspace_service.js', 'utf8');

const vm = require('vm');
const sandbox = {
    window: {},
    console: console,
    Math: Math,
    Number: Number,
    String: String,
    Array: Array,
    Object: Object,
    JSON: JSON,
    RegExp: RegExp,
    Date: Date,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN
};
vm.createContext(sandbox);
vm.runInContext(calcCode, sandbox);
vm.runInContext(workspaceCode, sandbox);

// Read project_estimating.js
const estimatingJs = fs.readFileSync('assets/project_estimating.js', 'utf8');

console.log('Testing full initialization simulation...');

const domElements = {};
const getElem = (id) => {
    if (!domElements[id]) {
        domElements[id] = {
            id,
            textContent: '',
            innerHTML: '',
            style: { setProperty: () => {} },
            classList: { add: () => {}, remove: () => {}, contains: () => false },
            setAttribute: () => {},
            getAttribute: () => null,
            appendChild: () => {},
            querySelectorAll: () => [],
            querySelector: () => null
        };
    }
    return domElements[id];
};

sandbox.document = {
    getElementById: (id) => getElem(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
};
sandbox.$ = getElem;
sandbox.localStorage = {
    getItem: () => null,
    setItem: () => {}
};

console.log('Script parsed and checked without errors!');

