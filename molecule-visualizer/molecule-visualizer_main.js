(function (global) {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    global.MoleculeVisualizer.App.init();
    global.MoleculeVisualizer.Studio?.init();
    global.MoleculeVisualizer.Advanced?.init();
    global.MoleculeVisualizer.GeneratorUI?.init();
    global.MoleculeVisualizer.EngineUI?.init();
  });
})(window);

