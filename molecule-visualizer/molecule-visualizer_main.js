(function (global) {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    global.MoleculeVisualizer.App.init();
    global.MoleculeVisualizer.Studio?.init();
    global.MoleculeVisualizer.EnergyProfile?.init();
    global.MoleculeVisualizer.TrajectoryUI?.init();
    global.MoleculeVisualizer.Advanced?.init();
    global.MoleculeVisualizer.GeneratorUI?.init();
    global.MoleculeVisualizer.EngineUI?.init();
    global.MoleculeVisualizer.BatchUI?.init();
    global.MoleculeVisualizer.VibrationUI?.init();
    global.MoleculeVisualizer.PathRefinement?.init();
    global.MoleculeVisualizer.MeasurementUI?.init();
    global.MoleculeVisualizer.AFIRUI?.init();
    global.MoleculeVisualizer.ConstraintUI?.init();
    global.MoleculeVisualizer.PanelLayout?.init();
  });
})(window);

