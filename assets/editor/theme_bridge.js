(function () {
    var parentTheme = null;
    try {
        if (window.parent && window.parent !== window && window.parent.document) {
            parentTheme = window.parent.document.documentElement.getAttribute('data-theme')
                || (window.parent.document.body?.classList.contains('theme-dark') ? 'dark' : null);
        }
    } catch (e) { }
    var theme = parentTheme || localStorage.getItem('takeoff.theme') || localStorage.getItem('bt_theme') || localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'theme-change') {
            var newTheme = e.data.theme || 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            if (document.body) {
                document.body.classList.toggle('theme-dark', newTheme === 'dark');
                document.body.classList.toggle('theme-light', newTheme === 'light');
            }
        }
    });
    document.addEventListener('DOMContentLoaded', function () {
        var currentTheme = document.documentElement.getAttribute('data-theme') || theme;
        if (document.body) {
            document.body.classList.toggle('theme-dark', currentTheme === 'dark');
            document.body.classList.toggle('theme-light', currentTheme === 'light');
        }
    });
    document.addEventListener('pointerdown', function () {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'project-takeoff-canvas-pointerdown' }, '*');
        }
    }, true);
})();
