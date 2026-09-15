(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};
  const Model = MV.Model;

  const BOND_DISTANCE_SCALE = 1.25;
  const MIN_BOND_DISTANCE = 0.35;
  const METAL_DISTANCE_SCALE = 1.12;
  const METALS = new Set(["Li", "Na", "K", "Mg", "Al", "Ca", "Fe", "Cu", "Zn", "Sc", "Ti", "V", "Cr", "Mn", "Co", "Ni", "Zr", "Nb", "Mo", "Ru", "Rh", "Pd", "Ag", "Cd", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Ce"]);

  const COVALENT_RADII = {
    Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39, Mn: 1.39, Co: 1.26, Ni: 1.24,
    Zr: 1.75, Nb: 1.64, Mo: 1.54, Ru: 1.46, Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44,
    Hf: 1.75, Ta: 1.70, W: 1.62, Re: 1.51, Os: 1.44, Ir: 1.41, Pt: 1.36, Au: 1.36, Hg: 1.32, Ce: 2.04,
    Ge: 1.20, As: 1.19, Se: 1.20, Sn: 1.39, Sb: 1.39, Te: 1.38, Pb: 1.46, Bi: 1.48,
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

  function inferBonds(atoms, cell) {
    const bonds = [];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const a = atoms[i];
        const b = atoms[j];
        const r1 = COVALENT_RADII[a.element];
        const r2 = COVALENT_RADII[b.element];
        if (!r1 || !r2) continue;

        const d = cell ? MV.Periodic.minimumImage([b.x-a.x,b.y-a.y,b.z-a.z],cell).distance : distance(a, b);
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
    Model.mergeInferredBonds(state, inferBonds(state.atoms, state.metadata.cell));
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

