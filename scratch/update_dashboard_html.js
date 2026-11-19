const fs = require('fs');

const phpPath = 'pages/project_dashboard.php';
let content = fs.readFileSync(phpPath, 'utf8');

const startTag = '<aside class="est-right" aria-label="Estimate notes and summary">';
const endTag = '</aside>';
const sIdx = content.indexOf(startTag);
const eIdx = content.indexOf(endTag, sIdx);

if (sIdx === -1 || eIdx === -1) {
    console.error('Could not find est-right block in project_dashboard.php');
    process.exit(1);
}

const newBlock = `<aside class="est-right" aria-label="Estimate notes and summary">
                            <div class="est-right-scroll" id="estRightScroll"></div>
                            <div class="est-total-box">
                                <div id="estimateTotal" class="est-total-value">$0.00</div>
                                <div class="est-total-label">Estimate Total</div>
                                <div id="estimateSqft" class="est-total-sub">--/sq ft</div>
                            </div>
                        </aside>`;

content = content.slice(0, sIdx) + newBlock + content.slice(eIdx + endTag.length);
fs.writeFileSync(phpPath, content, 'utf8');
console.log('Successfully updated project_dashboard.php');

