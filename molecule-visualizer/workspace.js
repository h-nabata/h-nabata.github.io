(function (global) {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.getElementById('calculationControls');
    const menus = [...bar.querySelectorAll('.mv-command-menu')];
    function close(menu, restoreFocus) {
      menu.open = false;
      if (restoreFocus) menu.querySelector('summary').focus({preventScroll:true});
    }
    bar.addEventListener('click', event => {
      const button = event.target.closest('button');
      const menu = button?.closest('.mv-command-menu');
      if (!menu?.open || button.disabled) return;
      if (button.dataset.engineMethod) {
        global.MoleculeVisualizer.EngineUI.prepareMethod(button.dataset.engineMethod);
      }
      // Some commands move focus into a dialog or into the molecular editor.
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
