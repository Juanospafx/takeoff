const fs = require('fs');

const phpPath = 'api/project_estimating.php';
let php = fs.readFileSync(phpPath, 'utf8');

const oldCode = `    if (!array_key_exists('groups', $snapshot) || !is_array($snapshot['groups'])) {
        $recoveredGroups = pew_relational_groups($pdo, (int)$estimate['id']);
        if ($recoveredGroups) $snapshot['groups'] = $recoveredGroups;
    }`;

const newCode = `    if (!array_key_exists('groups', $snapshot) || !is_array($snapshot['groups']) || empty($snapshot['groups'])) {
        $recoveredGroups = pew_relational_groups($pdo, (int)$estimate['id']);
        if (!empty($recoveredGroups)) $snapshot['groups'] = $recoveredGroups;
    }`;

const oldCodeNorm = oldCode.replace(/\r\n/g, '\n');
const phpNorm = php.replace(/\r\n/g, '\n');

if (phpNorm.includes(oldCodeNorm)) {
    php = phpNorm.replace(oldCodeNorm, newCode.replace(/\r\n/g, '\n'));
    fs.writeFileSync(phpPath, php, 'utf8');
    console.log('Updated api/project_estimating.php successfully');
} else {
    console.error('Could not find oldCode in api/project_estimating.php');
}

