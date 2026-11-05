const fs = require('fs');
const cp = require('child_process');

// 1. Get project 6 API response
const apiOutput = cp.execSync('C:\\xampp\\php\\php.exe scratch/test_api_p6.php', { encoding: 'utf8' });
// Find JSON in output
const jsonStart = apiOutput.indexOf('{"ok":true');
if (jsonStart === -1) {
    console.error('Could not find JSON in test_api_p6.php output');
    process.exit(1);
}
const apiData = JSON.parse(apiOutput.slice(jsonStart));
const estimates = apiData.estimates;
console.log('Got estimates from API:', estimates.length);

const est = estimates[0];
console.log('Testing estimate:', est.name, est.id);

// 2. Load services
// We can extract Calc and Workspace from their files
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

const Calc = sandbox.window.EstimateCalculationService;
const Workspace = sandbox.window.EstimatingWorkspaceService;

console.log('Calc service loaded:', Boolean(Calc));
console.log('Workspace service loaded:', Boolean(Workspace));

const summary = Calc.calculateSummary(est.groups, est.settings);
console.log('Calculated summary total:', summary.estimateTotal);

// 3. Now let's extract notesHtml, summaryHtml, auditHtml, card from project_estimating.js and test them!
const estimatingJs = fs.readFileSync('assets/project_estimating.js', 'utf8');

// Let's create an evaluation environment with mock DOM
const mockRoot = {
    querySelector: () => ({ scrollTop: 0, querySelectorAll: () => [], querySelector: () => null })
};
const mockUi = {
    collapsed: { notes: true, audit: true },
    showAllAudit: false
};

sandbox.current = () => est;
sandbox.summary = () => summary;
sandbox.ui = mockUi;
sandbox.root = mockRoot;
sandbox.$ = (id) => ({ textContent: '', innerHTML: '' });
sandbox.esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
sandbox.money = value => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
sandbox.number = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
sandbox.renderSqftDisplay = () => {};

// Extract functions
const fnNames = ['card', 'notesHtml', 'richEditorToolbar', 'listEditor', 'summaryHtml', 'auditHtml'];
// Let's test running the functions inside sandbox
try {
    vm.runInContext(`
        // Extract card, notesHtml, richEditorToolbar, listEditor, summaryHtml, auditHtml from estimatingJs
        ${estimatingJs.slice(estimatingJs.indexOf('function card('), estimatingJs.indexOf('function renderNotesLibraryModal('))}

        console.log('Testing card...');
        const nHtml = notesHtml(current());
        console.log('notesHtml OK, length:', nHtml.length);

        console.log('Testing summaryHtml...');
        const sHtml = summaryHtml(summary());
        console.log('summaryHtml OK, length:', sHtml.length);

        console.log('Testing auditHtml...');
        const aHtml = auditHtml(current());
        console.log('auditHtml OK, length:', aHtml.length);

        console.log('ALL HTML GENERATORS PASSED!');
    `, sandbox);
} catch (e) {
    console.error('ERROR in HTML generators:', e.message);
    console.error(e.stack);
}

