(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};

  const ELEMENT_COLORS = {
    H: "#f7f7f7", C: "#2f3437", N: "#3155d4", O: "#d82424", F: "#49b35d",
    P: "#e88a1a", S: "#d8b11e", Cl: "#2ca24f", Br: "#8b3b21", I: "#6f3d91",
    B: "#d28b6c", Si: "#c5a56a", Li: "#8f6fd6", Na: "#7b5bd6", K: "#6f43c8",
    Mg: "#58a65c", Al: "#9aa0a6", Ca: "#4fa66b", Fe: "#c26b33", Cu: "#bb6a38", Zn: "#8796a8"
  };

  const ELEMENT_RADII = {
    H: 0.28, C: 0.38, N: 0.37, O: 0.36, F: 0.34, P: 0.44, S: 0.44,
    Cl: 0.45, Br: 0.48, I: 0.52
  };

  function Renderer3DMol(containerId) {
    this.containerId = containerId;
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.state = null;
    this.projectedAtoms = [];
    this.projectedBonds = [];
    this.onAtomClick = null;
    this.onBondClick = null;
    this.onAtomDragStart = null;
    this.onAtomsDrag = null;
    this.onDragEnd = null;
    this.onBoxSelect = null;
    this.mode = "select";
    this.rotX = -0.45;
    this.rotY = 0.65;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.currentScale = 80;
    this.pointer = null;
    this.selectionBox = null;
  }

  Renderer3DMol.prototype.ensureViewer = function () {
    if (this.canvas) return;
    this.container = document.getElementById(this.containerId);
    if (!this.container) throw new Error("Viewer container not found.");
    this.container.innerHTML = "";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "mv-canvas";
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.installCanvasEvents();
    this.resize();
  };

  Renderer3DMol.prototype.setInteractionMode = function (mode) {
    this.mode = mode || "select";
  };

  Renderer3DMol.prototype.resize = function () {
    if (!this.canvas || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = global.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Renderer3DMol.prototype.renderState = function (state) {
    this.ensureViewer();
    this.state = state;
    this.resize();
    this.draw();
  };

  Renderer3DMol.prototype.updateSelection = function (state) {
    this.state = state;
    this.draw();
  };

  Renderer3DMol.prototype.render = function () {
    this.draw();
  };

  Renderer3DMol.prototype.center = function () {
    const atoms = this.state && this.state.atoms ? this.state.atoms : [];
    if (atoms.length === 0) return { x: 0, y: 0, z: 0 };
    return atoms.reduce((acc, atom) => ({
      x: acc.x + atom.x / atoms.length,
      y: acc.y + atom.y / atoms.length,
      z: acc.z + atom.z / atoms.length
    }), { x: 0, y: 0, z: 0 });
  };

  Renderer3DMol.prototype.rotate = function (p) {
    const cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);
    const cx = Math.cos(this.rotX), sx = Math.sin(this.rotX);
    const x1 = p.x * cy + p.z * sy;
    const z1 = -p.x * sy + p.z * cy;
    const y2 = p.y * cx - z1 * sx;
    const z2 = p.y * sx + z1 * cx;
    return { x: x1, y: y2, z: z2 };
  };

  Renderer3DMol.prototype.project = function (atom, center, scale, width, height) {
    const rotated = this.rotate({
      x: atom.x - center.x,
      y: atom.y - center.y,
      z: atom.z - center.z
    });
    return {
      atom,
      x: width / 2 + this.panX + rotated.x * scale,
      y: height / 2 + this.panY - rotated.y * scale,
      z: rotated.z,
      radius: Math.max(8, (ELEMENT_RADII[atom.element] || 0.4) * scale * 0.55)
    };
  };

  Renderer3DMol.prototype.draw = function () {
    if (!this.ctx || !this.state) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, width, height);

    const atoms = this.state.atoms || [];
    if (atoms.length === 0) {
      this.drawEmpty(width, height);
      return;
    }
    const center = this.center();
    const span = this.estimateSpan(center);
    const scale = Math.min(width, height) / Math.max(4.2, span * 1.65) * this.zoom;
    this.currentScale = scale;
    this.projectedAtoms = atoms.map(atom => this.project(atom, center, scale, width, height));
    const atomById = new Map(this.projectedAtoms.map(pa => [pa.atom.id, pa]));

    this.projectedBonds = (this.state.bonds || []).map(bond => ({
      bond,
      a: atomById.get(bond.atom1),
      b: atomById.get(bond.atom2)
    })).filter(item => item.a && item.b);

    this.projectedBonds
      .slice()
      .sort((m, n) => ((m.a.z + m.b.z) / 2) - ((n.a.z + n.b.z) / 2))
      .forEach(item => this.drawBond(item));

    this.projectedAtoms
      .slice()
      .sort((a, b) => a.z - b.z)
      .forEach(pa => this.drawAtom(pa));

    if (this.selectionBox) this.drawSelectionBox();
  };

  Renderer3DMol.prototype.drawEmpty = function (width, height) {
    this.ctx.fillStyle = "#6b7280";
    this.ctx.font = "14px Arial, sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText("Paste XYZ/MOL/SDF and load a molecule", width / 2, height / 2);
  };

  Renderer3DMol.prototype.estimateSpan = function (center) {
    let max = 1;
    (this.state.atoms || []).forEach(atom => {
      const dx = atom.x - center.x;
      const dy = atom.y - center.y;
      const dz = atom.z - center.z;
      max = Math.max(max, Math.sqrt(dx * dx + dy * dy + dz * dz));
    });
    return max * 2;
  };

  Renderer3DMol.prototype.drawBond = function (item) {
    const selected = this.state.selectedBondIds && this.state.selectedBondIds.has(item.bond.id);
    const manual = item.bond.source === "manual";
    const order = Math.max(1, Math.min(3, Number(item.bond.order) || 1));
    const dx = item.b.x - item.a.x;
    const dy = item.b.y - item.a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offsets = order === 1 ? [0] : (order === 2 ? [-3.5, 3.5] : [-5, 0, 5]);
    this.ctx.lineCap = "round";
    offsets.forEach(offset => {
      this.ctx.beginPath();
      this.ctx.moveTo(item.a.x + nx * offset, item.a.y + ny * offset);
      this.ctx.lineTo(item.b.x + nx * offset, item.b.y + ny * offset);
      this.ctx.lineWidth = selected ? 7 : (manual ? 5 : 3);
      this.ctx.strokeStyle = selected ? "#ef4444" : (manual ? "#2563eb" : "#5b6472");
      this.ctx.globalAlpha = item.bond.source === "inferred" ? 0.72 : 0.95;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    });
  };

  Renderer3DMol.prototype.drawAtom = function (pa) {
    const selected = this.state.selectedAtomIds && this.state.selectedAtomIds.has(pa.atom.id);
    const color = ELEMENT_COLORS[pa.atom.element] || "#9ca3af";
    const grad = this.ctx.createRadialGradient(pa.x - pa.radius * 0.35, pa.y - pa.radius * 0.45, pa.radius * 0.1, pa.x, pa.y, pa.radius);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.22, color);
    grad.addColorStop(1, "#111827");

    if (selected) {
      this.ctx.beginPath();
      this.ctx.arc(pa.x, pa.y, pa.radius + 7, 0, Math.PI * 2);
      this.ctx.fillStyle = "rgba(255, 212, 0, 0.38)";
      this.ctx.fill();
      this.ctx.lineWidth = 2;
      this.ctx.strokeStyle = "#f59e0b";
      this.ctx.stroke();
    }

    this.ctx.beginPath();
    this.ctx.arc(pa.x, pa.y, pa.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = grad;
    this.ctx.fill();
    this.ctx.lineWidth = 1.4;
    this.ctx.strokeStyle = pa.atom.element === "H" ? "#9ca3af" : "#111827";
    this.ctx.stroke();

    if (this.state.viewSettings && this.state.viewSettings.showIndexLabels) {
      const idx = this.state.atoms.findIndex(atom => atom.id === pa.atom.id) + 1;
      this.ctx.fillStyle = "#111827";
      this.ctx.font = "12px Arial, sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.fillText(String(idx), pa.x, pa.y - pa.radius - 9);
    }
  };

  Renderer3DMol.prototype.installCanvasEvents = function () {
    const self = this;
    this.canvas.addEventListener("pointerdown", function (event) {
      const p = self.eventPoint(event);
      const atom = self.pickAtom(p.x, p.y);
      const bond = atom ? null : self.pickBond(p.x, p.y);
      self.pointer = {
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        canvasX: p.x,
        canvasY: p.y,
        moved: false,
        atomId: atom ? atom.id : null,
        bondId: bond ? bond.id : null,
        action: null,
        historyStarted: false
      };
      if (!atom && !bond && self.mode === "select" && !event.altKey) {
        self.pointer.action = "box";
        self.selectionBox = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      }
      self.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", function (event) {
      if (!self.pointer) return;
      const dx = event.clientX - self.pointer.lastX;
      const dy = event.clientY - self.pointer.lastY;
      const p = self.eventPoint(event);
      self.pointer.lastX = event.clientX;
      self.pointer.lastY = event.clientY;
      if (Math.abs(event.clientX - self.pointer.x) + Math.abs(event.clientY - self.pointer.y) > 4) self.pointer.moved = true;

      if (self.pointer.action === "box") {
        self.selectionBox.x2 = p.x;
        self.selectionBox.y2 = p.y;
        self.draw();
        return;
      }

      if (self.pointer.atomId && (self.mode === "move" || self.mode === "select")) {
        if (!self.pointer.historyStarted && typeof self.onAtomDragStart === "function") {
          self.onAtomDragStart(self.pointer.atomId, event);
          self.pointer.historyStarted = true;
        }
        if (typeof self.onAtomsDrag === "function") {
          self.onAtomsDrag(self.pointer.atomId, self.screenDeltaToWorld(dx, dy, event.shiftKey), event);
        }
        return;
      }

      if (self.mode !== "move" || event.altKey) {
        self.rotY += dx * 0.01;
        self.rotX += dy * 0.01;
        self.draw();
      }
    });
    this.canvas.addEventListener("pointerup", function (event) {
      if (!self.pointer) return;
      const wasClick = !self.pointer.moved;
      const pointer = self.pointer;
      self.pointer = null;
      if (pointer.action === "box") {
        const ids = self.atomIdsInBox(self.selectionBox);
        self.selectionBox = null;
        self.draw();
        if (ids.length > 0 && typeof self.onBoxSelect === "function") self.onBoxSelect(ids, event);
        return;
      }
      if (pointer.historyStarted && typeof self.onDragEnd === "function") self.onDragEnd(event);
      if (wasClick) self.handlePick(event);
    });
    this.canvas.addEventListener("wheel", function (event) {
      event.preventDefault();
      self.zoom *= event.deltaY < 0 ? 1.08 : 0.92;
      self.zoom = Math.max(0.25, Math.min(5, self.zoom));
      self.draw();
    }, { passive: false });
    global.addEventListener("resize", function () {
      self.resize();
      self.draw();
    });
  };

  Renderer3DMol.prototype.screenDeltaToWorld = function (dx, dy, zMode) {
    const scale = this.currentScale || 80;
    const sx = dx / scale;
    const sy = -dy / scale;
    if (zMode) return { x: 0, y: 0, z: sy };

    const cy = Math.cos(this.rotY), syy = Math.sin(this.rotY);
    const cx = Math.cos(this.rotX), sxx = Math.sin(this.rotX);
    const rx = sx;
    const ry = sy;
    const rz = 0;

    const y1 = ry * cx + rz * sxx;
    const z1 = -ry * sxx + rz * cx;
    return {
      x: rx * cy - z1 * syy,
      y: y1,
      z: rx * syy + z1 * cy
    };
  };

  Renderer3DMol.prototype.drawSelectionBox = function () {
    const b = this.selectionBox;
    const x = Math.min(b.x1, b.x2);
    const y = Math.min(b.y1, b.y2);
    const w = Math.abs(b.x2 - b.x1);
    const h = Math.abs(b.y2 - b.y1);
    this.ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
    this.ctx.strokeStyle = "#2563eb";
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([5, 4]);
    this.ctx.fillRect(x, y, w, h);
    this.ctx.strokeRect(x, y, w, h);
    this.ctx.setLineDash([]);
  };

  Renderer3DMol.prototype.atomIdsInBox = function (box) {
    if (!box) return [];
    const x1 = Math.min(box.x1, box.x2);
    const x2 = Math.max(box.x1, box.x2);
    const y1 = Math.min(box.y1, box.y2);
    const y2 = Math.max(box.y1, box.y2);
    return this.projectedAtoms
      .filter(pa => pa.x >= x1 && pa.x <= x2 && pa.y >= y1 && pa.y <= y2)
      .map(pa => pa.atom.id);
  };

  Renderer3DMol.prototype.eventPoint = function (event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  Renderer3DMol.prototype.handlePick = function (event) {
    const p = this.eventPoint(event);
    const atom = this.pickAtom(p.x, p.y);
    if (atom && typeof this.onAtomClick === "function") {
      this.onAtomClick(atom.id, event, this);
      return;
    }
    const bond = this.pickBond(p.x, p.y);
    if (bond && typeof this.onBondClick === "function") this.onBondClick(bond.id, event, this);
  };

  Renderer3DMol.prototype.pickAtom = function (x, y) {
    let best = null;
    let bestD = Infinity;
    this.projectedAtoms.forEach(pa => {
      const dx = x - pa.x;
      const dy = y - pa.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= pa.radius + 9 && d < bestD) {
        best = pa.atom;
        bestD = d;
      }
    });
    return best;
  };

  Renderer3DMol.prototype.pickBond = function (x, y) {
    let best = null;
    let bestD = Infinity;
    this.projectedBonds.forEach(item => {
      const d = pointToSegmentDistance(x, y, item.a.x, item.a.y, item.b.x, item.b.y);
      if (d < 9 && d < bestD) {
        best = item.bond;
        bestD = d;
      }
    });
    return best;
  };

  function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    const x = x1 + t * dx;
    const y = y1 + t * dy;
    const ex = px - x;
    const ey = py - y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  MV.Renderer3DMol = Renderer3DMol;
})(window);
