(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};

  const DEFAULT_VIEW_SETTINGS = {
    style: "stickball",
    showIndexLabels: false
  };

  const counters = {
    atom: 1,
    bond: 1
  };

  function nextId(prefix, key) {
    return `${prefix}${counters[key]++}`;
  }

  function bumpCounterFromId(id, key) {
    const match = String(id || "").match(/\d+$/);
    if (!match) return;
    const n = Number(match[0]);
    if (Number.isFinite(n) && n >= counters[key]) counters[key] = n + 1;
  }

  function createAtom(data) {
    const atom = {
      id: data.id || nextId("a", "atom"),
      element: data.element || data.elem || "C",
      x: Number(data.x) || 0,
      y: Number(data.y) || 0,
      z: Number(data.z) || 0,
      charge: Number(data.charge) || 0
    };
    bumpCounterFromId(atom.id, "atom");
    return atom;
  }

  function createBond(data) {
    const bond = {
      id: data.id || nextId("b", "bond"),
      atom1: data.atom1,
      atom2: data.atom2,
      order: data.order || 1,
      type: data.type || "covalent",
      source: data.source || "manual"
    };
    bumpCounterFromId(bond.id, "bond");
    return bond;
  }

  function createState(options) {
    const opts = options || {};
    return {
      atoms: (opts.atoms || []).map(createAtom),
      bonds: (opts.bonds || []).map(createBond),
      selectedAtomIds: new Set(opts.selectedAtomIds || []),
      selectedBondIds: new Set(opts.selectedBondIds || []),
      metadata: Object.assign({
        title: "",
        sourceFormat: "xyz",
        bondsInferred: false,
        manualBondIds: []
      }, opts.metadata || {}),
      viewSettings: Object.assign({}, DEFAULT_VIEW_SETTINGS, opts.viewSettings || {})
    };
  }

  function cloneState(state) {
    return createState({
      atoms: state.atoms.map(a => ({
        id: a.id,
        element: a.element,
        x: a.x,
        y: a.y,
        z: a.z,
        charge: a.charge || 0
      })),
      bonds: state.bonds.map(b => ({
        id: b.id,
        atom1: b.atom1,
        atom2: b.atom2,
        order: b.order || 1,
        type: b.type || "covalent",
        source: b.source || "manual"
      })),
      selectedAtomIds: Array.from(state.selectedAtomIds || []),
      selectedBondIds: Array.from(state.selectedBondIds || []),
      metadata: Object.assign({}, state.metadata || {}),
      viewSettings: Object.assign({}, state.viewSettings || {})
    });
  }

  function atomIds(state) {
    return state.atoms.map(atom => atom.id);
  }

  function hasAtom(state, atomId) {
    return state.atoms.some(atom => atom.id === atomId);
  }

  function sanitizeSelection(state) {
    const validAtomIds = new Set(atomIds(state));
    const validBondIds = new Set(state.bonds.map(bond => bond.id));
    state.selectedAtomIds = new Set(Array.from(state.selectedAtomIds || []).filter(id => validAtomIds.has(id)));
    state.selectedBondIds = new Set(Array.from(state.selectedBondIds || []).filter(id => validBondIds.has(id)));
  }

  function normalizeBondKey(atom1, atom2) {
    return [atom1, atom2].sort().join("::");
  }

  function findBondBetween(state, atom1, atom2) {
    const key = normalizeBondKey(atom1, atom2);
    return state.bonds.find(bond => normalizeBondKey(bond.atom1, bond.atom2) === key) || null;
  }

  function setSelectedBonds(state, bondIdList) {
    const validBondIds = new Set(state.bonds.map(bond => bond.id));
    state.selectedBondIds = new Set(bondIdList.filter(id => validBondIds.has(id)));
  }

  function toggleBondSelection(state, bondId, additive) {
    const exists = state.bonds.some(bond => bond.id === bondId);
    if (!exists) return;
    const next = additive ? new Set(state.selectedBondIds) : new Set();
    if (next.has(bondId)) next.delete(bondId);
    else next.add(bondId);
    state.selectedBondIds = next;
  }

  function addOrUpdateBond(state, atom1, atom2, order, type, source) {
    if (!atom1 || !atom2 || atom1 === atom2 || !hasAtom(state, atom1) || !hasAtom(state, atom2)) return null;
    const existing = findBondBetween(state, atom1, atom2);
    if (existing) {
      existing.order = Number(order) || existing.order || 1;
      existing.type = type || existing.type || "covalent";
      existing.source = source || existing.source || "manual";
      return existing;
    }
    const bond = createBond({
      atom1,
      atom2,
      order: Number(order) || 1,
      type: type || "covalent",
      source: source || "manual"
    });
    state.bonds.push(bond);
    return bond;
  }

  function removeSelectedBonds(state) {
    const removed = new Set(state.selectedBondIds);
    state.bonds = state.bonds.filter(bond => !removed.has(bond.id));
    state.selectedBondIds.clear();
  }

  function updateSelectedBonds(state, data) {
    state.bonds.forEach(bond => {
      if (!state.selectedBondIds.has(bond.id)) return;
      if (data.order != null) bond.order = Number(data.order) || 1;
      if (data.type) bond.type = data.type;
      if (data.source) bond.source = data.source;
    });
  }

  function setSelectedAtoms(state, atomIdList) {
    state.selectedAtomIds = new Set(atomIdList.filter(id => hasAtom(state, id)));
  }

  function toggleAtomSelection(state, atomId, additive) {
    if (!hasAtom(state, atomId)) return;
    const next = additive ? new Set(state.selectedAtomIds) : new Set();
    if (next.has(atomId)) next.delete(atomId);
    else next.add(atomId);
    state.selectedAtomIds = next;
  }

  function selectAllAtoms(state) {
    state.selectedAtomIds = new Set(atomIds(state));
  }

  function invertAtomSelection(state) {
    const next = new Set();
    state.atoms.forEach(atom => {
      if (!state.selectedAtomIds.has(atom.id)) next.add(atom.id);
    });
    state.selectedAtomIds = next;
  }

  function removeSelectedAtoms(state) {
    const removed = new Set(state.selectedAtomIds);
    state.atoms = state.atoms.filter(atom => !removed.has(atom.id));
    state.bonds = state.bonds.filter(bond => !removed.has(bond.atom1) && !removed.has(bond.atom2));
    state.selectedAtomIds.clear();
    state.selectedBondIds.clear();
  }

  function replaceBonds(state, bonds, inferred) {
    state.bonds = bonds.map(createBond);
    state.metadata = Object.assign({}, state.metadata, { bondsInferred: Boolean(inferred) });
    sanitizeSelection(state);
  }

  function mergeInferredBonds(state, inferredBonds) {
    const manual = state.bonds.filter(bond => bond.source !== "inferred");
    const occupied = new Set(manual.map(bond => normalizeBondKey(bond.atom1, bond.atom2)));
    const inferred = [];
    inferredBonds.forEach(bond => {
      const key = normalizeBondKey(bond.atom1, bond.atom2);
      if (occupied.has(key)) return;
      inferred.push(createBond(Object.assign({}, bond, { source: "inferred" })));
      occupied.add(key);
    });
    state.bonds = manual.concat(inferred);
    state.metadata = Object.assign({}, state.metadata, {
      bondsInferred: true,
      manualBondIds: manual.map(bond => bond.id)
    });
    sanitizeSelection(state);
  }

  MV.Model = {
    DEFAULT_VIEW_SETTINGS,
    createAtom,
    createBond,
    createState,
    cloneState,
    setSelectedAtoms,
    setSelectedBonds,
    toggleAtomSelection,
    toggleBondSelection,
    selectAllAtoms,
    invertAtomSelection,
    removeSelectedAtoms,
    addOrUpdateBond,
    removeSelectedBonds,
    updateSelectedBonds,
    replaceBonds,
    mergeInferredBonds,
    findBondBetween,
    normalizeBondKey,
    sanitizeSelection
  };
})(window);
