const fs = require('fs');
const cp = require('child_process');

// 1. Get project 6 API response
const apiOutput = cp.execSync('C:\\xampp\\php\\php.exe scratch/test_api_p6.php', { encoding: 'utf8' });
const jsonStart = apiOutput.indexOf('{"ok":true');
const apiData = JSON.parse(apiOutput.slice(jsonStart));
const estimates = apiData.estimates;
const est = estimates[0];

// 2. Load services
const calcCode = fs.readFileSync('assets/estimate_calculation_service.js', 'utf8');
const workspaceCode = fs.readFileSync('assets/estimating_workspace_service.js', 'utf8');
const footerCode = fs.readFileSync('assets/project_estimating.js', 'utf8');

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

const Calc = sandbox.window.EstimateCalculationService;
const Workspace = sandbox.window.EstimatingWorkspaceService;

console.log('Calc service loaded:', Boolean(Calc));
console.log('Workspace service loaded:', Boolean(Workspace));

const summary = Calc.calculateSummary(est.groups, est.settings);
console.log('Calculated summary total:', summary.estimateTotal);

const estimatingJs = fs.readFileSync('assets/project_estimating.js', 'utf8');

const domElements = {};
const mockGetElementById = (id) => {
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

sandbox.current = () => est;
sandbox.summary = () => summary;
sandbox.state = { estimates, activeEstimateId: est.id };
sandbox.ui = {
    search: '',
    selected: new Set(),
    collapsed: { notes: true, audit: true },
    showAllAudit: false
};
sandbox.root = {
    querySelector: (sel) => mockGetElementById(sel.replace(/^[.#]/, '')),
    querySelectorAll: () => []
};
sandbox.$ = mockGetElementById; sandbox.mockGetElementById = mockGetElementById;
sandbox.esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
sandbox.money = value => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
sandbox.number = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
sandbox.renderSqftDisplay = () => {};
sandbox.resolveSquareFootage = () => 15000;
sandbox.handleEstimateCardAction = () => {};

try {
    vm.runInContext(`
        ${estimatingJs.slice(estimatingJs.indexOf('function card('), estimatingJs.indexOf('function renderNotesLibraryModal('))}
        ${estimatingJs.slice(estimatingJs.indexOf('function renderFooter('), estimatingJs.indexOf('function renderStatus('))}

        // Test renderDetails
        function renderDetails() {
            const aside = root.querySelector('.est-right-scroll');
            if (!aside) return;
            const estimate = current();
            const total = summary();
            aside.innerHTML = \`\${card('notes', 'Notes', notesHtml(estimate))}\${card('summary', 'Summary', summaryHtml(total))}\${card('audit', 'Audit', auditHtml(estimate))}\`;
            const totalElement = $('estimateTotal');
            if (totalElement) totalElement.textContent = money(total.estimateTotal);
            renderSqftDisplay(total);
        }

        renderDetails();
        console.log('renderDetails executed successfully!');
        console.log('aside innerHTML length:', mockGetElementById('est-right-scroll').innerHTML.length);
        console.log('estimateTotal textContent:', mockGetElementById('estimateTotal').textContent);

        renderFooter();
        console.log('renderFooter executed successfully!');
        console.log('versionBar innerHTML length:', mockGetElementById('versionBar').innerHTML.length);
    `, sandbox);
} catch (e) {
    console.error('ERROR during render test:', e.message);
    console.error(e.stack);
}
