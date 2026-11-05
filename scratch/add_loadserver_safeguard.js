const fs = require('fs');

const jsPath = 'assets/project_estimating.js';
let js = fs.readFileSync(jsPath, 'utf8');

const targetStr = `const changedDuringLoad = local.clientUiUpdatedAt !== requestLocalTimestamp;`;
const replacementStr = `const changedDuringLoad = local.clientUiUpdatedAt !== requestLocalTimestamp;

            // If local draft is empty but remote server has full estimates, adopt remote immediately
            const localHasContent = (state.estimates || []).some(est =>
                (est.groups || []).some(g => (g.items || []).length > 0)
            );
            const remoteHasContent = (remote.estimates || []).some(est =>
                (est.groups || []).some(g => (g.items || []).length > 0)
            );
            if (!localHasContent && remoteHasContent) {
                dirtyEstimateIds.clear();
                state = remote;
                restoreDirtyTracking();
                saveLocal();
                ui.loadState = 'saved';
                ui.message = 'Loaded from server';
                render();
                drainPendingTakeoff();
                return;
            }`;

if (js.includes(targetStr)) {
    js = js.replace(targetStr, replacementStr);
    fs.writeFileSync(jsPath, js, 'utf8');
    console.log('Safeguard added to loadServer in project_estimating.js');
} else {
    console.error('Target string not found in project_estimating.js');
}

