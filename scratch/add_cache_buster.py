with open('pages/project_dashboard.php', 'r', encoding='utf-8') as f:
    text = f.read()

target = '<script src="../assets/html2pdf.bundle.min.js"></script>'
replacement = '<script src="../assets/html2pdf.bundle.min.js?v=<?= filemtime(__DIR__ . \'/../assets/html2pdf.bundle.min.js\') ?>"></script>'
if target in text:
    text = text.replace(target, replacement, 1)
    with open('pages/project_dashboard.php', 'w', encoding='utf-8') as f:
        f.write(text)
    print('Updated html2pdf cache buster in project_dashboard.php')
else:
    print('Target already has cache buster or not found')

