const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiPath = path.join(root, 'api/project_module.php');
const clientPath = path.join(root, 'assets/bid_board.js');

const apiSource = fs.readFileSync(apiPath, 'utf8');
const clientSource = fs.readFileSync(clientPath, 'utf8');

// =============================================================================
// API CONTRACT TESTS (api/project_module.php)
// =============================================================================

test('API contract: runtime requests execute no CREATE TABLE, ALTER TABLE, DROP, migration, or seeds', () => {
    assert.doesNotMatch(apiSource, /CREATE\s+TABLE/i, 'api/project_module.php must not execute CREATE TABLE at runtime');
    assert.doesNotMatch(apiSource, /ALTER\s+TABLE/i, 'api/project_module.php must not execute ALTER TABLE at runtime');
    assert.doesNotMatch(apiSource, /DROP\s+TABLE/i, 'api/project_module.php must not execute DROP TABLE at runtime');
    assert.doesNotMatch(apiSource, /INSERT\s+INTO\s+project_templates/i, 'api/project_module.php must not seed project_templates at runtime');
});

test('API contract: read-only required-table and column check returns sanitized 503 on incomplete schema', () => {
    assert.match(apiSource, /function\s+project_validate_schema\s*\(/i);
    assert.match(apiSource, /project_validate_schema\s*\(\s*\$pdo\s*\)/i);

    assert.match(apiSource, /['"]projects['"]/);
    assert.match(apiSource, /['"]project_templates['"]/);

    const requiredProjectsColumns = [
        'id', 'project_template_id', 'estimator_id', 'project_number',
        'name', 'status', 'client_name', 'job_address', 'bid_due_at',
        'metadata_json', 'updated_at', 'deleted_at'
    ];
    for (const col of requiredProjectsColumns) {
        assert.match(apiSource, new RegExp(`['"]${col}['"]`), `Must validate required projects column: ${col}`);
    }

    const requiredTemplatesColumns = [
        'id', 'name', 'description', 'active', 'deleted_at'
    ];
    for (const col of requiredTemplatesColumns) {
        assert.match(apiSource, new RegExp(`['"]${col}['"]`), `Must validate required project_templates column: ${col}`);
    }

    assert.match(apiSource, /503/);
    assert.match(apiSource, /Database schema is incomplete/i);
});

test('API contract: uses constant generic log marker without logging raw exception messages', () => {
    assert.match(apiSource, /error_log\(['"]Project module error['"]\)/, 'Must use constant generic log marker in catch block');
    assert.doesNotMatch(apiSource, /error_log\([^)]*\$e->getMessage\(\)/, 'Must not log raw exception message ($e->getMessage())');
});

// =============================================================================
// CLIENT CONTRACT TESTS (assets/bid_board.js)
// =============================================================================

test('Client contract: defines explicit finite timeout and uses AbortController signal', () => {
    assert.match(clientSource, /PROJECT_CREATION_TIMEOUT_MS\s*=\s*\d+/);
    assert.match(clientSource, /new\s+AbortController\s*\(\s*\)/);
    assert.match(clientSource, /signal:\s*(?:controller\.)?signal/);
});

test('Client contract: removes unreachable if(false) block and unused draft object from createProjectDraft', () => {
    const fnBlock = clientSource.slice(
        clientSource.indexOf('async function createProjectDraft'),
        clientSource.indexOf('function closeModals')
    );
    assert.doesNotMatch(fnBlock, /if\s*\(\s*false\s*\)/, 'Must remove unreachable if(false) block');
    assert.doesNotMatch(fnBlock, /const\s+draft\s*=/, 'Must remove unused draft object from createProjectDraft');
});

test('Client contract: passes payload data only and { signal: controller.signal } as third argument; never serializes signal', () => {
    assert.match(
        clientSource,
        /postProjectAction\s*\(\s*['"]save['"]\s*,\s*\{[\s\S]*?\}\s*,\s*\{\s*signal:\s*controller\.signal\s*\}\s*\)/,
        'Must call postProjectAction with data only and { signal: controller.signal } as third argument'
    );
    assert.match(
        clientSource,
        /function\s+postProjectAction\s*\(\s*action\s*,\s*payload\s*,\s*options\s*=\s*\{\s*\}\s*\)/,
        'postProjectAction must accept options as third argument'
    );
});

test('Client contract: distinguishes timeout ambiguity, network, and server failures without exposing internals in error block', () => {
    assert.match(clientSource, /timed out/i);
    assert.match(clientSource, /outcome is unknown/i);
    assert.match(clientSource, /project may have been created/i);
    assert.match(clientSource, /reload or check the project list/i);
    assert.match(clientSource, /network/i);
    assert.match(clientSource, /server/i);
});

test('Client contract: submit button retry behavior distinguishes timeout from retryable errors', () => {
    assert.match(clientSource, /disabled\s*=\s*true/);
    assert.match(clientSource, /disabled\s*=\s*false/);
    assert.match(clientSource, /innerHTML\s*=\s*originalButtonHtml/);
});

// =============================================================================
// FOCUSED EXTRACTED-FUNCTION HARNESS & BEHAVIORAL TESTS
// =============================================================================

function extractCreateProjectDraft(source) {
    const start = source.indexOf('async function createProjectDraft');
    if (start === -1) throw new Error('createProjectDraft not found in client source');
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    const fnBody = source.slice(start, end);
    return new Function(
        'state',
        'activeStatus',
        'statusCodes',
        'PROJECT_CREATION_TIMEOUT_MS',
        'postProjectAction',
        'showError',
        'document',
        'window',
        'localStorage',
        `return (${fnBody});`
    );
}

const makeDraftFunction = extractCreateProjectDraft(clientSource);

function createHarness({ postProjectAction, customTimeoutMs } = {}) {
    let currentHref = 'https://takeoff.test/pages/bid_board.php';
    const mockLocation = {
        get href() { return currentHref; },
        set href(val) { currentHref = val; }
    };

    const mockLocalStorage = {
        items: new Map([['takeoff.projectDraft', 'existing-draft']]),
        removeItem(k) { this.items.delete(k); },
        getItem(k) { return this.items.get(k) ?? null; },
        setItem(k, v) { this.items.set(k, v); }
    };

    const errorEl = {
        hidden: true,
        textContent: ''
    };

    const submitBtn = {
        disabled: false,
        innerHTML: '<i class="fas fa-plus"></i> Create Project',
        textContent: 'Create Project'
    };

    const nameInput = { value: 'New Electrical Bid' };
    const templateInput = { value: '1' };
    const stageSelect = { value: 'To Do' };
    const modeRadio = { value: 'template', checked: true };

    const mockDocument = {
        querySelector: (sel) => {
            if (sel.includes('bbProjectMode')) return modeRadio;
            return null;
        },
        getElementById: (id) => {
            if (id === 'bbProjectTemplate') return templateInput;
            if (id === 'bbProjectName') return nameInput;
            if (id === 'bbProjectStage') return stageSelect;
            if (id === 'bbError') return errorEl;
            return null;
        }
    };

    const mockWindow = {
        location: mockLocation,
        PROJECT_CREATION_TIMEOUT_MS: customTimeoutMs || 10000
    };

    let shownError = null;
    const mockShowError = (msg) => {
        shownError = msg;
        errorEl.textContent = msg;
        errorEl.hidden = false;
    };

    const event = {
        preventDefault: () => {},
        target: {
            querySelector: (sel) => {
                if (sel.includes('button[type="submit"]')) return submitBtn;
                return null;
            }
        }
    };

    const state = {
        templates: [{ id: 1, name: 'Electrical Bid Template' }],
        projects: []
    };
    const statusCodes = { 'To Do': 'to_do' };
    const activeStatus = 'To Do';
    const PROJECT_CREATION_TIMEOUT_MS = customTimeoutMs || 10000;

    const fn = makeDraftFunction(
        state,
        activeStatus,
        statusCodes,
        PROJECT_CREATION_TIMEOUT_MS,
        postProjectAction,
        mockShowError,
        mockDocument,
        mockWindow,
        mockLocalStorage
    );

    return {
        run: () => fn(event),
        mockLocation,
        mockLocalStorage,
        errorEl,
        submitBtn,
        getShownError: () => shownError
    };
}

test('Behavioral: successful project creation navigates to project_dashboard.php with valid ID and tab=overview', async () => {
    let capturedAction = null;
    let capturedPayload = null;
    let capturedOptions = null;

    const postProjectAction = async (action, payload, options) => {
        capturedAction = action;
        capturedPayload = payload;
        capturedOptions = options;
        return {
            status: 'success',
            id: 99,
            project_id: 99,
            project: { id: 99, name: 'New Electrical Bid' }
        };
    };

    const harness = createHarness({ postProjectAction });
    assert.equal(harness.submitBtn.disabled, false);

    await harness.run();

    assert.equal(capturedAction, 'save');
    assert.equal(capturedPayload.name, 'New Electrical Bid');
    assert.equal(capturedPayload.status, 'to_do');
    assert.equal(capturedPayload.signal, undefined, 'signal must not be serialized in payload data');
    assert.ok(capturedOptions?.signal, 'options must contain AbortController signal');

    assert.equal(harness.mockLocation.href, 'project_dashboard.php?id=99&tab=overview');
    assert.equal(harness.mockLocalStorage.getItem('takeoff.projectDraft'), null, 'Draft must be cleared on success');
});

test('Behavioral: successful project creation navigates even if localStorage throws', async () => {
    const postProjectAction = async () => {
        return {
            status: 'success',
            id: 101,
            project_id: 101,
            project: { id: 101, name: 'New Electrical Bid' }
        };
    };

    const harness = createHarness({ postProjectAction });
    harness.mockLocalStorage.removeItem = () => {
        throw new Error('Access to localStorage is denied');
    };

    await harness.run();

    assert.equal(harness.mockLocation.href, 'project_dashboard.php?id=101&tab=overview', 'Must still navigate even if localStorage throws');
    assert.equal(harness.errorEl.hidden, true, 'Error banner must remain hidden on success');
});

test('Behavioral: timeout aborts request, displays ambiguous outcome guidance, and keeps repeat submission disabled', async () => {
    const postProjectAction = (action, payload, options) => {
        return new Promise((_, reject) => {
            if (options?.signal) {
                options.signal.addEventListener('abort', () => {
                    const err = new Error('The operation was aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            }
        });
    };

    const harness = createHarness({ postProjectAction, customTimeoutMs: 30 });

    await harness.run();

    // Must NOT navigate
    assert.equal(harness.mockLocation.href, 'https://takeoff.test/pages/bid_board.php');

    // Submit button must remain disabled to reduce duplicate creation risk
    assert.equal(harness.submitBtn.disabled, true, 'Submit button must remain disabled after timeout');

    // Error banner must display timeout message with outcome ambiguity and guidance
    assert.equal(harness.errorEl.hidden, false, 'Error banner must be visible');
    assert.match(harness.getShownError(), /timed out/i, 'Error message must mention timeout');
    assert.match(harness.getShownError(), /outcome is unknown/i, 'Error message must state outcome is unknown');
    assert.match(harness.getShownError(), /project may have been created/i, 'Error message must state project may have been created');
    assert.match(harness.getShownError(), /reload or check the project list/i, 'Error message must instruct user to reload or check project list');
});

test('Behavioral: network failure shows network error and restores submit button', async () => {
    const postProjectAction = async () => {
        throw new TypeError('Failed to fetch');
    };

    const harness = createHarness({ postProjectAction });
    const originalHtml = harness.submitBtn.innerHTML;

    await harness.run();

    assert.equal(harness.mockLocation.href, 'https://takeoff.test/pages/bid_board.php', 'Must not navigate on network failure');
    assert.equal(harness.submitBtn.disabled, false, 'Submit button must be re-enabled on network failure');
    assert.equal(harness.submitBtn.innerHTML, originalHtml, 'Submit button HTML must be restored');

    assert.equal(harness.errorEl.hidden, false);
    assert.match(harness.getShownError(), /network/i, 'Error banner must indicate network issue');
});

test('Behavioral: server 503 schema failure shows sanitized error and restores submit button', async () => {
    const postProjectAction = async () => {
        const err = new Error('Database schema is incomplete');
        err.status = 503;
        throw err;
    };

    const harness = createHarness({ postProjectAction });
    const originalHtml = harness.submitBtn.innerHTML;

    await harness.run();

    assert.equal(harness.mockLocation.href, 'https://takeoff.test/pages/bid_board.php', 'Must not navigate on 503 failure');
    assert.equal(harness.submitBtn.disabled, false, 'Submit button must be re-enabled on 503 failure');
    assert.equal(harness.submitBtn.innerHTML, originalHtml, 'Submit button HTML must be restored');

    assert.equal(harness.errorEl.hidden, false);
    assert.match(harness.getShownError(), /Database schema is incomplete|temporarily unavailable/i);
});
