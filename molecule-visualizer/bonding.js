(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};
  const Model = MV.Model;

  const BOND_DISTANCE_SCALE = 1.25;
  const MIN_BOND_DISTANCE = 0.35;
  const METAL_DISTANCE_SCALE = 1.12;
  const METALS = new Set(["Li", "Na", "K", "Mg", "Al", "Ca", "Fe", "Cu", "Zn"]);

  const COVALENT_RADII = {
    H: 0.31,
    B: 0.85,
    C: 0.76,
    N: 0.71,
    O: 0.66,
    F: 0.57,
    Si: 1.11,
    P: 1.07,
    S: 1.05,
    Cl: 1.02,
    Br: 1.20,
    I: 1.39,
    Li: 1.28,
    Na: 1.66,
    K: 2.03,
    Mg: 1.41,
    Al: 1.21,
    Ca: 1.76,
    Fe: 1.24,
    Cu: 1.32,
    Zn: 1.22
  };

  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function isMetal(element) {
    return METALS.has(element);
  }

  function inferBonds(atoms) {
    const bonds = [];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const a = atoms[i];
        const b = atoms[j];
        const r1 = COVALENT_RADII[a.element];
        const r2 = COVALENT_RADII[b.element];
        if (!r1 || !r2) continue;

        const d = distance(a, b);
        if (d < MIN_BOND_DISTANCE) continue;

        const metalPair = isMetal(a.element) || isMetal(b.element);
        const scale = metalPair ? METAL_DISTANCE_SCALE : BOND_DISTANCE_SCALE;
        if (d <= scale * (r1 + r2)) {
          bonds.push(Model.createBond({
            atom1: a.id,
            atom2: b.id,
            order: 1,
            type: metalPair ? "coordination_candidate" : "covalent",
            source: "inferred"
          }));
        }
      }
    }
    return bonds;
  }

  function refreshInferredBonds(state) {
    Model.mergeInferredBonds(state, inferBonds(state.atoms));
  }

  MV.Bonding = {
    BOND_DISTANCE_SCALE,
    MIN_BOND_DISTANCE,
    METAL_DISTANCE_SCALE,
    COVALENT_RADII,
    distance,
    inferBonds,
    refreshInferredBonds
  };
})(window);
