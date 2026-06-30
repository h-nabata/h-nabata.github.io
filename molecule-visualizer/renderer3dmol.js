(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};
  const IO = MV.IO;

  function Renderer3DMol(containerId, options) {
    this.containerId = containerId;
    this.options = options || {};
    this.viewer = null;
    this.model = null;
    this.atomIdByModelIndex = new Map();
    this.modelIndexByAtomId = new Map();
    this.onAtomClick = null;
  }

  Renderer3DMol.prototype.ensureViewer = function () {
    if (this.viewer) return;
    if (!global.$3Dmol) throw new Error("3Dmol.js is not loaded.");
    this.viewer = global.$3Dmol.createViewer(this.containerId, {
      defaultcolors: global.$3Dmol.rasmolElementColors
    });
  };

  Renderer3DMol.prototype.renderState = function (state, preserveCamera) {
    this.ensureViewer();

    let view = null;
    if (preserveCamera) {
      try { view = this.viewer.getView(); } catch (_) {}
    }

    this.viewer.removeAllModels();
    this.viewer.removeAllLabels();
    if (typeof this.viewer.removeAllShapes === "function") this.viewer.removeAllShapes();
    this.viewer.addModel(IO.stateToXYZText(state), "xyz");
    this.model = this.viewer.getModel();
    this.rebuildAtomMap(state);
    this.installClickHandler();
    this.applyStyles(state);
    this.drawBondOverlay(state);
    this.updateLabels(state);

    if (view) {
      try { this.viewer.setView(view); } catch (_) {}
    } else {
      this.viewer.zoomTo();
    }
    this.viewer.render();
  };

  Renderer3DMol.prototype.rebuildAtomMap = function (state) {
    this.atomIdByModelIndex.clear();
    this.modelIndexByAtomId.clear();
    const modelAtoms = this.model && this.model.atoms ? this.model.atoms : [];
    state.atoms.forEach((atom, i) => {
      const modelAtom = modelAtoms[i];
      if (!modelAtom) return;
      this.atomIdByModelIndex.set(modelAtom.index, atom.id);
      this.modelIndexByAtomId.set(atom.id, modelAtom.index);
      modelAtom.mvAtomId = atom.id;
    });
  };

  Renderer3DMol.prototype.installClickHandler = function () {
    const self = this;
    if (!this.viewer) return;
    this.viewer.setClickable({}, true, function (atom, viewer, event) {
      const atomId = atom && (atom.mvAtomId || self.atomIdByModelIndex.get(atom.index));
      if (atomId && typeof self.onAtomClick === "function") {
        self.onAtomClick(atomId, event, viewer);
      }
    });
  };

  Renderer3DMol.prototype.baseStyleFor = function (styleName) {
    if (styleName === "stick") return { stick: { radius: 0.25 } };
    if (styleName === "wire") return { line: { linewidth: 2 } };
    if (styleName === "vdw") return { sphere: { scale: 1.0 } };
    return { stick: { radius: 0.2 }, sphere: { scale: 0.3 } };
  };

  Renderer3DMol.prototype.applyStyles = function (state) {
    if (!this.model) return;
    this.model.setStyle({}, this.baseStyleFor(state.viewSettings.style));
    const selectedIndices = Array.from(state.selectedAtomIds || [])
      .map(atomId => this.modelIndexByAtomId.get(atomId))
      .filter(index => Number.isInteger(index));
    if (selectedIndices.length > 0) {
      this.model.setStyle({ index: selectedIndices }, {
        sphere: { scale: 0.55, color: "red" },
        stick: { radius: 0.28, color: "red" }
      });
    }
  };

  Renderer3DMol.prototype.bondColor = function (bond, selected) {
    if (selected) return "red";
    if (bond.source === "manual") return "#1f6feb";
    if (bond.type === "coordination_candidate") return "#b26b00";
    return "#666666";
  };

  Renderer3DMol.prototype.drawBondOverlay = function (state) {
    if (!this.viewer || typeof this.viewer.addCylinder !== "function") return;
    const atomById = new Map(state.atoms.map(atom => [atom.id, atom]));
    state.bonds.forEach(bond => {
      const a = atomById.get(bond.atom1);
      const b = atomById.get(bond.atom2);
      if (!a || !b) return;
      const selected = state.selectedBondIds && state.selectedBondIds.has(bond.id);
      const radius = selected ? 0.085 : (bond.source === "manual" ? 0.055 : 0.032);
      const color = this.bondColor(bond, selected);
      try {
        this.viewer.addCylinder({
          start: { x: a.x, y: a.y, z: a.z },
          end: { x: b.x, y: b.y, z: b.z },
          radius,
          fromCap: 1,
          toCap: 1,
          color
        });
      } catch (_) {}
    });
  };

  Renderer3DMol.prototype.updateSelection = function (state) {
    this.renderState(state, true);
  };

  Renderer3DMol.prototype.updateLabels = function (state) {
    if (!this.viewer) return;
    this.viewer.removeAllLabels();
    if (!state.viewSettings.showIndexLabels) return;

    state.atoms.forEach((atom, i) => {
      this.viewer.addLabel(String(i + 1), {
        position: { x: atom.x, y: atom.y, z: atom.z },
        fontSize: 12,
        backgroundColor: "white",
        fontColor: "black",
        borderColor: "#333",
        borderThickness: 1
      });
    });
  };

  MV.Renderer3DMol = Renderer3DMol;
})(window);
