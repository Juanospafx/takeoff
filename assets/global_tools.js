(function () {
    function menuFor(button) {
        const name = button.getAttribute('data-global-menu-toggle');
        const header = button.closest('[data-global-tools-header]');
        return header ? header.querySelector('[data-global-menu="' + name + '"]') : null;
    }

    function closeMenus(exceptMenu) {
        document.querySelectorAll('[data-global-menu].open').forEach(menu => {
            if (menu !== exceptMenu) menu.classList.remove('open');
        });

        document.querySelectorAll('[data-global-menu-toggle][aria-expanded="true"]').forEach(button => {
            if (menuFor(button) !== exceptMenu) {
                button.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function keepMenuOnScreen(menu) {
        menu.style.left = '';
        menu.style.right = '';

        const rect = menu.getBoundingClientRect();
        const margin = 12;

        if (rect.right > window.innerWidth - margin) {
            menu.style.left = 'auto';
            menu.style.right = '0';
        }

        if (rect.left < margin) {
            menu.style.left = '0';
            menu.style.right = 'auto';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-global-menu-toggle]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const menu = menuFor(button);
                if (!menu) return;

                const willOpen = !menu.classList.contains('open');
                closeMenus(menu);
                menu.classList.toggle('open', willOpen);
                button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');

                if (willOpen) {
                    keepMenuOnScreen(menu);
                }
            });
        });

        document.querySelectorAll('[data-global-menu]').forEach(menu => {
            menu.addEventListener('click', event => {
                const link = event.target.closest('a');
                const action = event.target.closest('.bt-menu-action');
                if (link || action) {
                    closeMenus(null);
                    return;
                }
                event.stopPropagation();
            });
        });

        document.addEventListener('click', () => closeMenus(null));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeMenus(null);
        });
        window.addEventListener('resize', () => closeMenus(null));
    });
})();
