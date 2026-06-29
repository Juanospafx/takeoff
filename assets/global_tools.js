(function () {
    function closeMenus(except) {
        document.querySelectorAll('[data-company-tools-menu].open').forEach(menu => {
            if (menu !== except) menu.classList.remove('open');
        });
        document.querySelectorAll('[data-company-tools-toggle][aria-expanded="true"]').forEach(button => {
            const header = button.closest('[data-global-tools-header]');
            const menu = header?.querySelector('[data-company-tools-menu]');
            if (menu !== except) button.setAttribute('aria-expanded', 'false');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-company-tools-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const header = button.closest('[data-global-tools-header]');
                const menu = header?.querySelector('[data-company-tools-menu]');
                if (!menu) {
                    window.location.href = '/pages/company_tools.php';
                    return;
                }
                const willOpen = !menu.classList.contains('open');
                closeMenus(menu);
                menu.classList.toggle('open', willOpen);
                button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });
        });

        document.querySelectorAll('[data-company-tools-menu]').forEach(menu => {
            menu.addEventListener('click', event => event.stopPropagation());
        });

        document.addEventListener('click', () => closeMenus(null));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeMenus(null);
        });
    });
})();
