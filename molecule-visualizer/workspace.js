(function (global) {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const app = document.querySelector('.mv-app');
    const menus = [...app.querySelectorAll('.mv-command-menu, .mv-popover')];

    function close(menu, restoreFocus) {
      menu.open = false;
      if (restoreFocus) menu.querySelector('summary').focus({preventScroll:true});
    }

    app.addEventListener('click', event => {
      const button = event.target.closest('button');
      const menu = button?.closest('.mv-command-menu, .mv-popover');
      if (!menu?.open || button.disabled) return;
      if (button.dataset.engineMethod) {
        global.MoleculeVisualizer.EngineUI.prepareMethod(button.dataset.engineMethod);
      }
      // Leave controls for camera orientation, zoom and size available for repeated adjustments.
      if (menu.id === 'viewportTools' && button.id !== 'btnDataDock') return;

      close(menu, menu.contains(document.activeElement));
      if (button.id === 'btnAFIR' && !document.getElementById('afirPanel').hidden) {
        document.getElementById('afirPanel').scrollIntoView({block:'nearest'});
        document.getElementById('afirName').focus({preventScroll:true});
      }
    });

    document.addEventListener('pointerdown', event => {
      for (const menu of menus) {
        if (menu.open && !menu.contains(event.target)) close(menu, false);
      }
    });
    document.addEventListener('focusin', event => {
      for (const menu of menus) {
        if (menu.open && !menu.contains(event.target)) close(menu, false);
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const menu = menus.find(item => item.open && item.contains(document.activeElement));
      if (menu) {
        close(menu, true);
        event.preventDefault();
      }
    });
  });
})(window);
