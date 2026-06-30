(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};
  const Model = MV.Model;

  function History(limit) {
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit || 80;
  }

  History.prototype.push = function (label, state) {
    this.undoStack.push({
      label: label || "edit",
      state: Model.cloneState(state)
    });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  };

  History.prototype.undo = function (currentState) {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push({
      label: "redo",
      state: Model.cloneState(currentState)
    });
    return Model.cloneState(this.undoStack.pop().state);
  };

  History.prototype.redo = function (currentState) {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push({
      label: "undo",
      state: Model.cloneState(currentState)
    });
    return Model.cloneState(this.redoStack.pop().state);
  };

  History.prototype.clear = function () {
    this.undoStack = [];
    this.redoStack = [];
  };

  MV.History = History;
})(window);
