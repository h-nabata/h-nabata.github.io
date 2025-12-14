/* ============================================================
   Molecule Visualizer / Editor (XYZ)
   - Headerless XYZ supported
   - Atom index labels ON/OFF
   - Select / multi-select
   - Move atoms (drag), shift-drag = Z move
   - Add atom
   - Add fragment (paste XYZ)
   - Delete selected
   - Export (copy / download)
   - Undo / Redo
   ============================================================ */

let viewer = null;

// canonical data
let atoms = [];               // [{elem, x, y, z}]
let selected = new Set();     // indices
let showIndex = false;
let moveMode = false;

// drag state
let drag = {
  active: false,
  startClientX: 0,
  startClientY: 0,
  lastClientX: 0,
  lastClientY: 0,
  scaleXY: 0.01,
  scaleZ: 0.01,
  mode: "xy", // "xy" or "z"
  snapshot: null // atoms snapshot for drag start
};

// undo/redo
const history = {
  undo: [],
  redo: [],
  limit: 80
};

function setStatus(msg) {
  const el = document.getElementById("statusBadge");
  if (el) el.textContent = msg;
}

function deepCopyAtoms(a) {
  return a.map(v => ({ elem: v.elem, x: v.x, y: v.y, z: v.z }));
}

function pushHistory(label = "edit") {
  history.undo.push({ label, atoms: deepCopyAtoms(atoms), selected: new Set([...selected]) });
  if (history.undo.length > history.limit) history.undo.shift();
  history.redo = [];
}

function restoreState(state) {
  atoms = deepCopyAtoms(state.atoms);
  selected = new Set([...state.selected]);
  renderFromAtoms(true);
}

function undo() {
  if (history.undo.length === 0) return;
  history.redo.push({ label: "redo", atoms: deepCopyAtoms(atoms), selected: new Set([...selected]) });
  const prev = history.undo.pop();
  restoreState(prev);
  setStatus("Undo");
}

function redo() {
  if (history.redo.length === 0) return;
  history.undo.push({ label: "undo", atoms: deepCopyAtoms(atoms), selected: new Set([...selected]) });
  const next = history.redo.pop();
  restoreState(next);
  setStatus("Redo");
}

// -------------------- XYZ parse / normalize --------------------

function normalizeXYZText(input) {
  const raw = (input || "").trim();
  if (!raw) return "";

  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  const first = lines[0];
  const n = parseInt(first, 10);

  // if first line is an integer AND we have at least (n + 2) lines, treat as XYZ
  if (!isNaN(n) && lines.length >= n + 2) {
    return lines.join("\n") + "\n";
  }

  // otherwise treat as coordinate-only lines and generate header
  // count only valid atom lines (elem x y z)
  const atomLines = [];
  for (const l of lines) {
    const parts = l.split(/\s+/);
    if (parts.length >= 4) atomLines.push(l);
  }

  const count = atomLines.length;
  return [String(count), "Generated from headerless input", ...atomLines].join("\n") + "\n";
}

function parseXYZToAtoms(input) {
  const text = normalizeXYZText(input);
  if (!text) return [];

  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 3) return [];

  const n = parseInt(lines[0], 10);
  const out = [];

  for (let i = 0; i < n; i++) {
    const line = lines[i + 2];
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const elem = parts[0];
    const x = parseFloat(parts[1]);
    const y = parseFloat(parts[2]);
    const z = parseFloat(parts[3]);
    if ([x, y, z].some(v => Number.isNaN(v))) continue;
    out.push({ elem, x, y, z });
  }
  return out;
}

function atomsToXYZText(atomsArr) {
  const n = atomsArr.length;
  const header = [
    String(n),
    "Edited structure"
  ];
  const body = atomsArr.map(a => {
    const x = a.x.toFixed(6);
    const y = a.y.toFixed(6);
    const z = a.z.toFixed(6);
    return `${a.elem} ${x} ${y} ${z}`;
  });
  return [...header, ...body].join("\n") + "\n";
}

// -------------------- Rendering --------------------

function ensureViewer() {
  if (viewer) return;

  viewer = $3Dmol.createViewer("viewer", {
    defaultcolors: $3Dmol.rasmolElementColors
  });

  // click select
  viewer.setClickable({}, true, function (atom, v, event) {
    // 3Dmol atom has "index" (0-based) in the model
    const idx = atom.index;

    const ctrl = event?.ctrlKey || event?.metaKey;
    if (!ctrl) selected.clear();
    if (selected.has(idx) && ctrl) selected.delete(idx);
    else selected.add(idx);

    updateSelectionStyles();
    updateLabels();
    updateAtomTable();
    v.render();
  });
}

function renderFromAtoms(preserveCamera = false) {
  ensureViewer();

  const xyz = atomsToXYZText(atoms);

  // Keep camera if requested
  let view = null;
  if (preserveCamera) {
    try { view = viewer.getView(); } catch (_) { view = null; }
  }

  viewer.removeAllModels();
  viewer.removeAllLabels();

  viewer.addModel(xyz, "xyz");

  // base style
  viewer.setStyle({}, { stick: { radius: 0.2 }, sphere: { scale: 0.3 } });

  // selection styling
  updateSelectionStyles();
  updateLabels();

  if (view) {
    try { viewer.setView(view); } catch (_) {}
  } else {
    viewer.zoomTo();
  }

  viewer.render();
  updateAtomTable();
}

function updateSelectionStyles() {
  if (!viewer) return;
  const model = viewer.getModel();
  if (!model) return;

  // reset first
  model.setStyle({}, { stick: { radius: 0.2 }, sphere: { scale: 0.3 } });

  // highlight selected atoms
  const selIdx = [...selected];
  if (selIdx.length > 0) {
    const sel = { index: selIdx };
    model.setStyle(sel, { sphere: { scale: 0.55, color: "red" }, stick: { radius: 0.28 } });
  }
}

function updateLabels() {
  if (!viewer) return;
  viewer.removeAllLabels();

  if (!showIndex) {
    viewer.render();
    return;
  }

  const model = viewer.getModel();
  if (!model) return;

  const modelAtoms = model.atoms || [];
  for (let i = 0; i < modelAtoms.length; i++) {
    const a = modelAtoms[i];
    const text = String(i + 1);
    viewer.addLabel(text, {
      position: { x: a.x, y: a.y, z: a.z },
      fontSize: 10,
      backgroundColor: "white",
      fontColor: "black",
      borderColor: "#666",
      borderThickness: 1
    });
  }
  viewer.render();
}

// -------------------- UI actions --------------------

function loadFromTextarea() {
  const raw = document.getElementById("xyz_input").value;
  const parsed = parseXYZToAtoms(raw);
  if (parsed.length === 0) {
    setStatus("Parse failed / empty");
    return;
  }
  pushHistory("load");
  atoms = parsed;
  selected.clear();
  renderFromAtoms(false);
  setStatus(`Loaded: ${atoms.length} atoms`);
}

function toggleMoveMode() {
  moveMode = !moveMode;
  const btn = document.getElementById("btnToggleMove");
  if (btn) btn.textContent = `移動モード: ${moveMode ? "ON" : "OFF"}`;
  setStatus(moveMode ? "Move mode ON" : "Move mode OFF");
}

function toggleIndexLabels() {
  showIndex = !showIndex;
  const btn = document.getElementById("btnToggleIndex");
  if (btn) btn.textContent = `原子番号表示: ${showIndex ? "ON" : "OFF"}`;
  updateLabels();
  setStatus(showIndex ? "Index labels ON" : "Index labels OFF");
}

function clearSelection() {
  selected.clear();
  updateSelectionStyles();
  updateLabels();
  updateAtomTable();
  if (viewer) viewer.render();
  setStatus("Selection cleared");
}

function copyXYZ() {
  const text = atomsToXYZText(atoms);
  navigator.clipboard.writeText(text)
    .then(() => setStatus("XYZ copied"))
    .catch(() => setStatus("Clipboard failed"));
}

function downloadXYZ() {
  const text = atomsToXYZText(atoms);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "edited.xyz";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus("XYZ downloaded");
}

function deleteSelected() {
  if (selected.size === 0) return;

  pushHistory("delete");
  const del = new Set([...selected]);
  atoms = atoms.filter((_, i) => !del.has(i));
  selected.clear();
  renderFromAtoms(true);
  setStatus("Deleted selected atoms");
}

function addAtom() {
  const elem = document.getElementById("addElem").value.trim() || "C";
  const mode = document.getElementById("addMode").value;
  const dist = parseFloat(document.getElementById("addDist").value || "1.1");

  let x = parseFloat(document.getElementById("addX").value || "0");
  let y = parseFloat(document.getElementById("addY").value || "0");
  let z = parseFloat(document.getElementById("addZ").value || "0");

  if (mode === "nearSelected" && selected.size > 0) {
    const i = [...selected][0];
    const base = atoms[i];
    // place along +Z direction by default
    x = base.x;
    y = base.y;
    z = base.z + (Number.isFinite(dist) ? dist : 1.1);
  } else if (mode === "origin") {
    x = 0; y = 0; z = 0;
  } else {
    // custom uses the input values
  }

  pushHistory("addAtom");
  atoms.push({ elem, x, y, z });
  selected.clear();
  selected.add(atoms.length - 1);

  renderFromAtoms(true);
  setStatus(`Added atom: ${elem}`);
}

function openFragmentDialog() {
  const dlg = document.getElementById("fragDialog");
  if (dlg) dlg.showModal();
}

function applyFragment() {
  const text = document.getElementById("fragText").value;
  const fragAtoms = parseXYZToAtoms(text);
  if (fragAtoms.length === 0) {
    setStatus("Fragment parse failed");
    return;
  }

  const place = document.getElementById("fragPlace").value;
  const scale = parseFloat(document.getElementById("fragScale").value || "1.0");
  const ox = parseFloat(document.getElementById("fragOX").value || "0");
  const oy = parseFloat(document.getElementById("fragOY").value || "0");
  const oz = parseFloat(document.getElementById("fragOZ").value || "0");
  const jitter = parseFloat(document.getElementById("fragJitter").value || "0");

  let bx = 0, by = 0, bz = 0;
  if (place === "nearSelected" && selected.size > 0) {
    const i = [...selected][0];
    const base = atoms[i];
    bx = base.x; by = base.y; bz = base.z + 1.2;
  }

  pushHistory("addFragment");

  const beforeLen = atoms.length;
  for (const a of fragAtoms) {
    const jx = jitter ? (Math.random() - 0.5) * jitter : 0;
    const jy = jitter ? (Math.random() - 0.5) * jitter : 0;
    const jz = jitter ? (Math.random() - 0.5) * jitter : 0;

    const nx = bx + ox + (a.x * scale) + jx;
    const ny = by + oy + (a.y * scale) + jy;
    const nz = bz + oz + (a.z * scale) + jz;
    atoms.push({ elem: a.elem, x: nx, y: ny, z: nz });
  }

  selected.clear();
  for (let i = beforeLen; i < atoms.length; i++) selected.add(i);

  renderFromAtoms(true);
  setStatus(`Fragment added: +${fragAtoms.length} atoms`);
}

// -------------------- Atom table --------------------

function updateAtomTable() {
  const tbody = document.querySelector("#atomTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  atoms.forEach((a, i) => {
    const tr = document.createElement("tr");
    if (selected.has(i)) tr.classList.add("selected");

    const tdI = document.createElement("td");
    tdI.textContent = String(i + 1);

    const tdE = document.createElement("td");
    tdE.textContent = a.elem;

    const tdX = document.createElement("td");
    tdX.textContent = a.x.toFixed(3);

    const tdY = document.createElement("td");
    tdY.textContent = a.y.toFixed(3);

    const tdZ = document.createElement("td");
    tdZ.textContent = a.z.toFixed(3);

    const tdS = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(i);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(i);
      else selected.delete(i);
      updateSelectionStyles();
      updateLabels();
      if (viewer) viewer.render();
      updateAtomTable();
    });
    tdS.appendChild(cb);

    // click row -> select
    tr.addEventListener("click", (ev) => {
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (!ctrl) selected.clear();
      if (selected.has(i) && ctrl) selected.delete(i);
      else selected.add(i);

      updateSelectionStyles();
      updateLabels();
      if (viewer) viewer.render();
      updateAtomTable();
    });

    tr.appendChild(tdI);
    tr.appendChild(tdE);
    tr.appendChild(tdX);
    tr.appendChild(tdY);
    tr.appendChild(tdZ);
    tr.appendChild(tdS);
    tbody.appendChild(tr);
  });
}

// -------------------- Drag move (simple, robust) --------------------

function onMouseDown(e) {
  if (!moveMode) return;
  if (selected.size === 0) return;

  // Only start drag if mouse down is inside viewer
  const viewerEl = document.getElementById("viewer");
  if (!viewerEl) return;

  const rect = viewerEl.getBoundingClientRect();
  const inside = (e.clientX >= rect.left && e.clientX <= rect.right &&
                  e.clientY >= rect.top && e.clientY <= rect.bottom);
  if (!inside) return;

  drag.active = true;
  drag.startClientX = e.clientX;
  drag.startClientY = e.clientY;
  drag.lastClientX = e.clientX;
  drag.lastClientY = e.clientY;
  drag.mode = e.shiftKey ? "z" : "xy";
  drag.snapshot = deepCopyAtoms(atoms);

  // push history once per drag
  pushHistory("move");
  setStatus(drag.mode === "z" ? "Dragging (Z)" : "Dragging (XY)");
}

function onMouseMove(e) {
  if (!drag.active) return;
  if (!moveMode) return;
  if (selected.size === 0) return;

  const dx = e.clientX - drag.lastClientX;
  const dy = e.clientY - drag.lastClientY;
  drag.lastClientX = e.clientX;
  drag.lastClientY = e.clientY;

  // adjust scale with Alt (fine) or Ctrl (coarse)
  const alt = e.altKey;
  const ctrl = e.ctrlKey || e.metaKey;
  let sXY = drag.scaleXY;
  let sZ = drag.scaleZ;
  if (alt) { sXY *= 0.2; sZ *= 0.2; }
  if (ctrl) { sXY *= 3.0; sZ *= 3.0; }

  const idxs = [...selected];

  if (drag.mode === "xy" && !e.shiftKey) {
    // screen dx -> +x, screen dy -> -y
    for (const i of idxs) {
      atoms[i].x += dx * sXY;
      atoms[i].y -= dy * sXY;
    }
  } else {
    // Z move by vertical mouse movement
    for (const i of idxs) {
      atoms[i].z += (-dy) * sZ;
    }
  }

  // fast update by re-rendering from atoms
  // (確実性優先。必要なら将来 model.updateAtomPositions() に最適化できます)
  renderFromAtoms(true);
}

function onMouseUp() {
  if (!drag.active) return;
  drag.active = false;
  drag.snapshot = null;
  setStatus("Move end");
}

// -------------------- Key bindings --------------------

function onKeyDown(e) {
  if (e.key === "Delete" || e.key === "Backspace") {
    // avoid deleting when typing in textarea
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (tag === "textarea" || tag === "input") return;
    deleteSelected();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
    e.preventDefault();
    redo();
  }
}

// -------------------- Init --------------------

function wireUI() {
  document.getElementById("btnRender").addEventListener("click", loadFromTextarea);
  document.getElementById("btnToggleMove").addEventListener("click", toggleMoveMode);
  document.getElementById("btnToggleIndex").addEventListener("click", toggleIndexLabels);

  document.getElementById("btnCopyXYZ").addEventListener("click", copyXYZ);
  document.getElementById("btnDownloadXYZ").addEventListener("click", downloadXYZ);

  document.getElementById("btnUndo").addEventListener("click", undo);
  document.getElementById("btnRedo").addEventListener("click", redo);

  document.getElementById("btnClearSel").addEventListener("click", clearSelection);
  document.getElementById("btnDeleteSel").addEventListener("click", deleteSelected);

  document.getElementById("btnAddAtom").addEventListener("click", addAtom);
  document.getElementById("btnAddFragment").addEventListener("click", openFragmentDialog);

  const fragApplyBtn = document.getElementById("btnFragApply");
  fragApplyBtn.addEventListener("click", (ev) => {
    ev.preventDefault(); // prevent dialog close by default
    applyFragment();
    document.getElementById("fragDialog").close();
  });

  // Drag move handlers
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  // keyboard
  document.addEventListener("keydown", onKeyDown);
}

document.addEventListener("DOMContentLoaded", () => {
  wireUI();
  ensureViewer();
  setStatus("Ready");

  // optional: load initial example if textarea has XYZ
  const initial = document.getElementById("xyz_input").value.trim();
  if (initial) {
    atoms = parseXYZToAtoms(initial);
    if (atoms.length > 0) renderFromAtoms(false);
  }
});


// let moveMode = false;
// let selectedAtom = null;
// let viewer;

// function toggleMoveMode() {
//     moveMode = !moveMode;
//     console.log("Move mode:", moveMode);
// }

// function renderMolecule() {
//     const xyzData = document.getElementById('xyz_input').value;
//     viewer = $3Dmol.createViewer("viewer", {
//         defaultcolors: $3Dmol.rasmolElementColors
//     });
//     viewer.addModel(xyzData, "xyz");
//     viewer.setStyle({}, {
//         stick: {radius: 0.2},
//         sphere: {scale: 0.3}
//     });
//     viewer.zoomTo();
//     viewer.render();

//     // クリックイベントリスナを設定
//     viewer.setClickable({}, true, function(atom, viewer, event, container) {
//         if (moveMode) {
//             selectedAtom = atom;
//             selectedAtom.style = {sphere: {scale: 0.5, color: 'red'}}; // 選択された原子の色を変更
//             viewer.render();
//             console.log("Selected atom:", selectedAtom);
//         }
//     });

//     console.log("Molecule rendered");
// }

// document.addEventListener('mousemove', function(event) {
//     if (moveMode && selectedAtom) {
//         const {model, index} = selectedAtom;
//         const atom = model.selectedAtoms()[index];
//         if (atom) {
//             atom.x += event.movementX * 0.01; // 移動のスケーリングファクターを調整
//             atom.y -= event.movementY * 0.01;
//             model.updateAtomPositions();
//             viewer.render();
//             console.log("Atom moved:", atom);
//         }
//     }
// });

// document.addEventListener('mouseup', function(event) {
//     if (moveMode && selectedAtom) {
//         selectedAtom.style = {sphere: {scale: 0.3}}; // 選択解除時のスタイルリセット
//         viewer.render();
//         console.log("Atom move ended.");
//         selectedAtom = null;
//     }
// });
