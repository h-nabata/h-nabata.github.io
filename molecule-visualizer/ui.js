(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};
  const Model = MV.Model;
  const Bonding = MV.Bonding;
  const Geometry = MV.Geometry;
  const IO = MV.IO;
  const History = MV.History;
  const Renderer3DMol = MV.Renderer3DMol;

  let state = Model.createState();
  let renderer = null;
  let history = new History(120);
  let moveMode = false;
  const drag = {
    active: false,
    lastClientX: 0,
    lastClientY: 0,
    scaleXY: 0.01,
    scaleZ: 0.01,
    mode: "xy"
  };

  function byId(id) { return document.getElementById(id); }
  function setStatus(msg) { const el = byId("statusBadge"); if (el) el.textContent = msg; }
  function setMeasure(msg) { const el = byId("measureBadge"); if (el) el.textContent = msg; }
  function pushHistory(label) { history.push(label, state); }

  function atomLabel(atom) {
    const idx = state.atoms.findIndex(a => a.id === atom.id);
    return `${idx + 1}:${atom.element}`;
  }

  function selectedAtoms() {
    return Array.from(state.selectedAtomIds)
      .map(id => state.atoms.find(atom => atom.id === id))
      .filter(Boolean);
  }

  function render(preserveCamera) {
    renderer.renderState(state, Boolean(preserveCamera));
    updateAtomTable();
    updateBondTable();
  }

  function setState(nextState, preserveCamera) {
    state = nextState;
    Model.sanitizeSelection(state);
    render(preserveCamera);
  }

  function rerenderSelectionOnly() {
    renderer.updateSelection(state);
    updateAtomTable();
    updateBondTable();
  }

  function refreshBondsAndRender(preserveCamera) {
    Bonding.refreshInferredBonds(state);
    render(preserveCamera);
  }

  function loadFromTextarea() {
    const nextState = IO.parseXYZToState(byId("xyz_input").value);
    if (nextState.atoms.length === 0) {
      setStatus("XYZ parse failed / empty");
      return;
    }
    pushHistory("loadXYZ");
    nextState.viewSettings = Object.assign({}, state.viewSettings);
    setState(nextState, false);
    setStatus(`Loaded XYZ: ${state.atoms.length} atoms, ${state.bonds.length} bonds`);
  }

  function loadMolFromTextarea() {
    const nextState = IO.parseMolToState(byId("xyz_input").value);
    if (nextState.atoms.length === 0) {
      setStatus("MOL/SDF parse failed / empty");
      return;
    }
    pushHistory("loadMol");
    nextState.viewSettings = Object.assign({}, state.viewSettings);
    setState(nextState, false);
    setStatus(`Loaded MOL/SDF: ${state.atoms.length} atoms, ${state.bonds.length} bonds`);
  }

  function toggleMoveMode() {
    moveMode = !moveMode;
    const btn = byId("btnToggleMove");
    if (btn) btn.textContent = `移動モード: ${moveMode ? "ON" : "OFF"}`;
    setStatus(moveMode ? "Move mode ON" : "Move mode OFF");
  }

  function toggleIndexLabels() {
    state.viewSettings.showIndexLabels = !state.viewSettings.showIndexLabels;
    const btn = byId("btnToggleIndex");
    if (btn) btn.textContent = `原子番号表示: ${state.viewSettings.showIndexLabels ? "ON" : "OFF"}`;
    renderer.updateSelection(state);
    setStatus(state.viewSettings.showIndexLabels ? "Index labels ON" : "Index labels OFF");
  }

  function onStyleChange() {
    state.viewSettings.style = byId("styleSelect").value;
    renderer.updateSelection(state);
    setStatus(`Style: ${state.viewSettings.style}`);
  }

  function copyText(text, okMessage) {
    if (!navigator.clipboard) {
      setStatus("Clipboard unavailable");
      return;
    }
    navigator.clipboard.writeText(text).then(() => setStatus(okMessage)).catch(() => setStatus("Clipboard failed"));
  }

  function copyXYZ() { copyText(IO.stateToXYZText(state), "XYZ copied"); }
  function copyMol() { copyText(IO.stateToMolText(state), "MOL copied"); }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadXYZ() {
    downloadText(IO.stateToXYZText(state), "edited.xyz");
    setStatus("XYZ downloaded");
  }

  function downloadSDF() {
    downloadText(IO.stateToSDFText(state), "edited.sdf");
    setStatus("SDF downloaded");
  }

  function clearSelection() {
    Model.setSelectedAtoms(state, []);
    Model.setSelectedBonds(state, []);
    rerenderSelectionOnly();
    setStatus("Selection cleared");
  }

  function deleteSelected() {
    if (state.selectedAtomIds.size === 0) return;
    pushHistory("deleteAtoms");
    Model.removeSelectedAtoms(state);
    refreshBondsAndRender(true);
    setStatus("Deleted selected atoms");
  }

  function changeSelectedElement() {
    if (state.selectedAtomIds.size === 0) return;
    const newElem = byId("editElem").value.trim();
    if (!newElem) return;
    pushHistory("changeElem");
    state.atoms.forEach(atom => {
      if (state.selectedAtomIds.has(atom.id)) atom.element = newElem;
    });
    refreshBondsAndRender(true);
    setStatus(`Element changed to ${newElem}`);
  }

  function selectAll() {
    Model.selectAllAtoms(state);
    rerenderSelectionOnly();
    setStatus("Selected all atoms");
  }

  function selectNone() { clearSelection(); }

  function selectInvert() {
    Model.invertAtomSelection(state);
    rerenderSelectionOnly();
    setStatus("Atom selection inverted");
  }

  function selectByElement() {
    const element = byId("selByElem").value.trim();
    if (!element) return;
    Model.setSelectedAtoms(state, state.atoms.filter(atom => atom.element === element).map(atom => atom.id));
    rerenderSelectionOnly();
    setStatus(`Selected element: ${element}`);
  }

  function addAtom() {
    const element = byId("addElem").value.trim() || "C";
    const mode = byId("addMode").value;
    const dist = Number(byId("addDist").value || "1.1");
    let x = Number(byId("addX").value || "0");
    let y = Number(byId("addY").value || "0");
    let z = Number(byId("addZ").value || "0");

    if (mode === "nearSelected" && state.selectedAtomIds.size > 0) {
      const base = selectedAtoms()[0];
      if (base) { x = base.x; y = base.y; z = base.z + (Number.isFinite(dist) ? dist : 1.1); }
    } else if (mode === "origin") {
      x = 0; y = 0; z = 0;
    }

    pushHistory("addAtom");
    const atom = Model.createAtom({ element, x, y, z });
    state.atoms.push(atom);
    Model.setSelectedAtoms(state, [atom.id]);
    refreshBondsAndRender(true);
    setStatus(`Added atom: ${element}`);
  }

  function openFragmentDialog() {
    const dlg = byId("fragDialog");
    if (dlg) dlg.showModal();
  }

  function centroid(atoms) {
    if (atoms.length === 0) return { x: 0, y: 0, z: 0 };
    return atoms.reduce((acc, atom) => ({
      x: acc.x + atom.x / atoms.length,
      y: acc.y + atom.y / atoms.length,
      z: acc.z + atom.z / atoms.length
    }), { x: 0, y: 0, z: 0 });
  }

  function applyFragment() {
    const parsed = IO.parseXYZAtoms(byId("fragText").value);
    if (parsed.atoms.length === 0) {
      setStatus("Fragment parse failed");
      return;
    }

    const place = byId("fragPlace").value;
    const scale = Number(byId("fragScale").value || "1.0");
    const ox = Number(byId("fragOX").value || "0");
    const oy = Number(byId("fragOY").value || "0");
    const oz = Number(byId("fragOZ").value || "0");
    const jitter = Number(byId("fragJitter").value || "0");
    const anchorIndex = Math.max(1, Number(byId("fragAnchorIndex").value || "1")) - 1;
    const bondDistance = Number(byId("fragBondDistance").value || "1.45");
    const bondOrder = Number(byId("fragBondOrder").value || "1");
    const hostAnchor = selectedAtoms()[0] || null;
    const fragAnchor = parsed.atoms[anchorIndex] || parsed.atoms[0];

    let bx = 0, by = 0, bz = 0;
    if ((place === "nearSelected" || place === "anchorBond") && hostAnchor) {
      bx = hostAnchor.x;
      by = hostAnchor.y;
      bz = hostAnchor.z + 1.2;
    }
    if (place === "anchorBond" && hostAnchor && fragAnchor) {
      bx = hostAnchor.x - fragAnchor.x * scale;
      by = hostAnchor.y - fragAnchor.y * scale;
      bz = hostAnchor.z + bondDistance - fragAnchor.z * scale;
    }

    pushHistory("addFragment");
    const addedIds = [];
    let newAnchorId = null;
    parsed.atoms.forEach((atom, i) => {
      const jx = jitter ? (Math.random() - 0.5) * jitter : 0;
      const jy = jitter ? (Math.random() - 0.5) * jitter : 0;
      const jz = jitter ? (Math.random() - 0.5) * jitter : 0;
      const newAtom = Model.createAtom({
        element: atom.element,
        x: bx + ox + atom.x * scale + jx,
        y: by + oy + atom.y * scale + jy,
        z: bz + oz + atom.z * scale + jz
      });
      state.atoms.push(newAtom);
      addedIds.push(newAtom.id);
      if (i === anchorIndex) newAnchorId = newAtom.id;
    });

    if (place === "anchorBond" && hostAnchor && newAnchorId) {
      Model.addOrUpdateBond(state, hostAnchor.id, newAnchorId, bondOrder, "covalent", "manual");
    }
    Model.setSelectedAtoms(state, addedIds);
    refreshBondsAndRender(true);
    setStatus(`Fragment added: +${addedIds.length} atoms${place === "anchorBond" ? ", anchored" : ""}`);
  }

  function addBondFromSelection() {
    const atoms = selectedAtoms();
    if (atoms.length !== 2) {
      setStatus("Select exactly 2 atoms to add a bond");
      return;
    }
    pushHistory("addBond");
    const bond = Model.addOrUpdateBond(state, atoms[0].id, atoms[1].id, byId("bondOrder").value, byId("bondType").value, "manual");
    Model.setSelectedBonds(state, bond ? [bond.id] : []);
    render(true);
    setStatus("Manual bond added/updated");
  }

  function updateSelectedBonds() {
    if (state.selectedBondIds.size === 0) return;
    pushHistory("updateBond");
    Model.updateSelectedBonds(state, {
      order: byId("bondOrder").value,
      type: byId("bondType").value,
      source: "manual"
    });
    render(true);
    setStatus("Selected bonds updated");
  }

  function deleteSelectedBonds() {
    if (state.selectedBondIds.size === 0) return;
    pushHistory("deleteBond");
    Model.removeSelectedBonds(state);
    render(true);
    setStatus("Selected bonds deleted");
  }

  function reinferBonds() {
    pushHistory("reinferBonds");
    refreshBondsAndRender(true);
    setStatus("Inferred bonds refreshed; manual bonds preserved");
  }

  function applyDistance() {
    const atoms = selectedAtoms();
    if (atoms.length !== 2) { setStatus("Select exactly 2 atoms for distance"); return; }
    const target = Number(byId("targetDistance").value);
    if (!Number.isFinite(target) || target <= 0) return;
    pushHistory("setDistance");
    const moved = Geometry.setDistance(atoms[0], atoms[1], target);
    Object.assign(atoms[1], moved);
    refreshBondsAndRender(true);
    setMeasure(`d=${Geometry.distance(atoms[0], atoms[1]).toFixed(3)} A`);
    setStatus("Distance constraint applied");
  }

  function measureDistance() {
    const atoms = selectedAtoms();
    if (atoms.length !== 2) { setStatus("Select exactly 2 atoms for distance"); return; }
    const value = Geometry.distance(atoms[0], atoms[1]);
    byId("targetDistance").value = value.toFixed(3);
    setMeasure(`d=${value.toFixed(3)} A`);
  }

  function applyAngle() {
    const atoms = selectedAtoms();
    if (atoms.length !== 3) { setStatus("Select exactly 3 atoms for angle A-B-C"); return; }
    const target = Number(byId("targetAngle").value);
    if (!Number.isFinite(target)) return;
    pushHistory("setAngle");
    Object.assign(atoms[2], Geometry.setAngle(atoms[0], atoms[1], atoms[2], target));
    refreshBondsAndRender(true);
    setMeasure(`angle=${Geometry.angle(atoms[0], atoms[1], atoms[2]).toFixed(2)} deg`);
    setStatus("Angle constraint applied");
  }

  function measureAngle() {
    const atoms = selectedAtoms();
    if (atoms.length !== 3) { setStatus("Select exactly 3 atoms for angle A-B-C"); return; }
    const value = Geometry.angle(atoms[0], atoms[1], atoms[2]);
    byId("targetAngle").value = value.toFixed(2);
    setMeasure(`angle=${value.toFixed(2)} deg`);
  }

  function applyDihedral() {
    const atoms = selectedAtoms();
    if (atoms.length !== 4) { setStatus("Select exactly 4 atoms for dihedral A-B-C-D"); return; }
    const target = Number(byId("targetDihedral").value);
    if (!Number.isFinite(target)) return;
    pushHistory("setDihedral");
    Object.assign(atoms[3], Geometry.setDihedral(atoms[0], atoms[1], atoms[2], atoms[3], target));
    refreshBondsAndRender(true);
    setMeasure(`dihedral=${Geometry.dihedral(atoms[0], atoms[1], atoms[2], atoms[3]).toFixed(2)} deg`);
    setStatus("Dihedral constraint applied");
  }

  function measureDihedral() {
    const atoms = selectedAtoms();
    if (atoms.length !== 4) { setStatus("Select exactly 4 atoms for dihedral A-B-C-D"); return; }
    const value = Geometry.dihedral(atoms[0], atoms[1], atoms[2], atoms[3]);
    byId("targetDihedral").value = value.toFixed(2);
    setMeasure(`dihedral=${value.toFixed(2)} deg`);
  }

  function undo() {
    const previous = history.undo(state);
    if (!previous) return;
    setState(previous, true);
    setStatus("Undo");
  }

  function redo() {
    const next = history.redo(state);
    if (!next) return;
    setState(next, true);
    setStatus("Redo");
  }

  function updateAtomTable() {
    const tbody = document.querySelector("#atomTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    state.atoms.forEach((atom, i) => {
      const tr = document.createElement("tr");
      if (state.selectedAtomIds.has(atom.id)) tr.classList.add("selected");
      [String(i + 1), atom.element, atom.x.toFixed(3), atom.y.toFixed(3), atom.z.toFixed(3)].forEach(value => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      const tdS = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.selectedAtomIds.has(atom.id);
      cb.addEventListener("click", ev => ev.stopPropagation());
      cb.addEventListener("change", ev => {
        ev.stopPropagation();
        const next = new Set(state.selectedAtomIds);
        if (cb.checked) next.add(atom.id); else next.delete(atom.id);
        Model.setSelectedAtoms(state, Array.from(next));
        rerenderSelectionOnly();
      });
      tdS.appendChild(cb);
      tr.appendChild(tdS);
      tr.addEventListener("click", ev => {
        Model.toggleAtomSelection(state, atom.id, ev.ctrlKey || ev.metaKey);
        rerenderSelectionOnly();
      });
      tbody.appendChild(tr);
    });
  }

  function updateBondTable() {
    const tbody = document.querySelector("#bondTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    state.bonds.forEach((bond, i) => {
      const a1 = state.atoms.find(atom => atom.id === bond.atom1);
      const a2 = state.atoms.find(atom => atom.id === bond.atom2);
      const tr = document.createElement("tr");
      if (state.selectedBondIds.has(bond.id)) tr.classList.add("selected");
      [String(i + 1), a1 ? atomLabel(a1) : "?", a2 ? atomLabel(a2) : "?", String(bond.order), bond.type, bond.source].forEach(value => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      const tdS = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.selectedBondIds.has(bond.id);
      cb.addEventListener("click", ev => ev.stopPropagation());
      cb.addEventListener("change", ev => {
        ev.stopPropagation();
        const next = new Set(state.selectedBondIds);
        if (cb.checked) next.add(bond.id); else next.delete(bond.id);
        Model.setSelectedBonds(state, Array.from(next));
        rerenderSelectionOnly();
      });
      tdS.appendChild(cb);
      tr.appendChild(tdS);
      tr.addEventListener("click", ev => {
        Model.toggleBondSelection(state, bond.id, ev.ctrlKey || ev.metaKey);
        Model.setSelectedAtoms(state, [bond.atom1, bond.atom2]);
        byId("bondOrder").value = String(bond.order || 1);
        byId("bondType").value = bond.type || "covalent";
        rerenderSelectionOnly();
      });
      tbody.appendChild(tr);
    });
  }

  function onMouseDown(e) {
    if (!moveMode || state.selectedAtomIds.size === 0) return;
    const viewerEl = byId("viewer");
    if (!viewerEl) return;
    const rect = viewerEl.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) return;
    drag.active = true;
    drag.lastClientX = e.clientX;
    drag.lastClientY = e.clientY;
    drag.mode = e.shiftKey ? "z" : "xy";
    pushHistory("move");
    setStatus(drag.mode === "z" ? "Dragging (Z)" : "Dragging (XY)");
  }

  function onMouseMove(e) {
    if (!drag.active || !moveMode || state.selectedAtomIds.size === 0) return;
    const dx = e.clientX - drag.lastClientX;
    const dy = e.clientY - drag.lastClientY;
    drag.lastClientX = e.clientX;
    drag.lastClientY = e.clientY;
    let sXY = drag.scaleXY;
    let sZ = drag.scaleZ;
    if (e.altKey) { sXY *= 0.2; sZ *= 0.2; }
    if (e.ctrlKey || e.metaKey) { sXY *= 3.0; sZ *= 3.0; }
    state.atoms.forEach(atom => {
      if (!state.selectedAtomIds.has(atom.id)) return;
      if (drag.mode === "xy" && !e.shiftKey) { atom.x += dx * sXY; atom.y -= dy * sXY; }
      else atom.z += -dy * sZ;
    });
    refreshBondsAndRender(true);
  }

  function onMouseUp() {
    if (!drag.active) return;
    drag.active = false;
    setStatus("Move end");
  }

  function onKeyDown(e) {
    const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
    const editingText = tag === "textarea" || tag === "input" || tag === "select";
    if ((e.key === "Delete" || e.key === "Backspace") && !editingText) {
      if (state.selectedBondIds.size > 0) deleteSelectedBonds();
      else deleteSelected();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
  }

  function bind(id, event, handler) {
    const el = byId(id);
    if (el) el.addEventListener(event, handler);
  }

  function wireUI() {
    bind("btnRender", "click", loadFromTextarea);
    bind("btnImportMol", "click", loadMolFromTextarea);
    bind("btnToggleMove", "click", toggleMoveMode);
    bind("btnToggleIndex", "click", toggleIndexLabels);
    bind("btnCopyXYZ", "click", copyXYZ);
    bind("btnDownloadXYZ", "click", downloadXYZ);
    bind("btnCopyMol", "click", copyMol);
    bind("btnDownloadSdf", "click", downloadSDF);
    bind("btnUndo", "click", undo);
    bind("btnRedo", "click", redo);
    bind("btnClearSel", "click", clearSelection);
    bind("btnDeleteSel", "click", deleteSelected);
    bind("btnChangeElem", "click", changeSelectedElement);
    bind("btnAddAtom", "click", addAtom);
    bind("btnAddFragment", "click", openFragmentDialog);
    bind("btnSelectAll", "click", selectAll);
    bind("btnSelectNone", "click", selectNone);
    bind("btnSelectInvert", "click", selectInvert);
    bind("btnSelectByElem", "click", selectByElement);
    bind("styleSelect", "change", onStyleChange);
    bind("btnAddBond", "click", addBondFromSelection);
    bind("btnUpdateBond", "click", updateSelectedBonds);
    bind("btnDeleteBond", "click", deleteSelectedBonds);
    bind("btnReinferBonds", "click", reinferBonds);
    bind("btnApplyDistance", "click", applyDistance);
    bind("btnMeasureDistance", "click", measureDistance);
    bind("btnApplyAngle", "click", applyAngle);
    bind("btnMeasureAngle", "click", measureAngle);
    bind("btnApplyDihedral", "click", applyDihedral);
    bind("btnMeasureDihedral", "click", measureDihedral);
    bind("btnFragApply", "click", ev => {
      ev.preventDefault();
      applyFragment();
      byId("fragDialog").close();
    });
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);
  }

  function init() {
    renderer = new Renderer3DMol("viewer");
    renderer.ensureViewer();
    renderer.onAtomClick = function (atomId, event, viewer) {
      Model.toggleAtomSelection(state, atomId, Boolean(event && (event.ctrlKey || event.metaKey)));
      rerenderSelectionOnly();
      if (viewer) viewer.render();
    };
    wireUI();
    setStatus("Ready");
    const styleSelect = byId("styleSelect");
    if (styleSelect) styleSelect.value = state.viewSettings.style;
    const initial = byId("xyz_input").value.trim();
    if (initial) loadFromTextarea();
  }

  MV.App = {
    init,
    getState: function () { return state; },
    setState
  };
})(window);
