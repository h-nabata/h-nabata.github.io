(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};
  const Model = MV.Model;
  const Bonding = MV.Bonding;

  function normalizeXYZText(input) {
    const raw = (input || "").trim();
    if (!raw) return "";

    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return "";

    const n = parseInt(lines[0], 10);
    if (!Number.isNaN(n) && lines.length >= n + 2) {
      return lines.slice(0, n + 2).join("\n") + "\n";
    }

    const atomLines = lines.filter(line => line.split(/\s+/).length >= 4);
    return [String(atomLines.length), "Generated from headerless input", ...atomLines].join("\n") + "\n";
  }

  function parseXYZAtoms(input) {
    const text = normalizeXYZText(input);
    if (!text) return { atoms: [], title: "" };

    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length < 3) return { atoms: [], title: "" };

    const n = parseInt(lines[0], 10);
    const title = lines[1] || "";
    const atoms = [];

    for (let i = 0; i < n; i++) {
      const line = lines[i + 2];
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (![x, y, z].every(Number.isFinite)) continue;
      atoms.push(Model.createAtom({
        element: parts[0],
        x,
        y,
        z
      }));
    }

    return { atoms, title };
  }

  function parseXYZToState(input) {
    const parsed = parseXYZAtoms(input);
    const state = Model.createState({
      atoms: parsed.atoms,
      metadata: {
        title: parsed.title || "Untitled",
        sourceFormat: "xyz",
        bondsInferred: true
      }
    });
    Bonding.refreshInferredBonds(state);
    return state;
  }

  function atomsToXYZText(atoms, title) {
    const header = [String(atoms.length), title || "Edited structure"];
    const body = atoms.map(atom => {
      return `${atom.element} ${atom.x.toFixed(6)} ${atom.y.toFixed(6)} ${atom.z.toFixed(6)}`;
    });
    return [...header, ...body].join("\n") + "\n";
  }

  function stateToXYZText(state) {
    return atomsToXYZText(state.atoms, state.metadata && state.metadata.title ? state.metadata.title : "Edited structure");
  }

  function parseMolCounts(line) {
    return {
      atomCount: Number(line.slice(0, 3).trim()) || 0,
      bondCount: Number(line.slice(3, 6).trim()) || 0
    };
  }

  function parseMolToState(input) {
    const raw = (input || "").replace(/\r/g, "");
    const molText = raw.split(/\n\$\$\$\$/)[0];
    const lines = molText.split("\n");
    if (lines.length < 4) return Model.createState();

    const title = (lines[0] || "MOL structure").trim();
    const counts = parseMolCounts(lines[3] || "");
    const atoms = [];
    const atomIdByMolIndex = new Map();

    for (let i = 0; i < counts.atomCount; i++) {
      const line = lines[4 + i] || "";
      const atom = Model.createAtom({
        x: Number(line.slice(0, 10).trim()) || 0,
        y: Number(line.slice(10, 20).trim()) || 0,
        z: Number(line.slice(20, 30).trim()) || 0,
        element: line.slice(31, 34).trim() || "C"
      });
      atoms.push(atom);
      atomIdByMolIndex.set(i + 1, atom.id);
    }

    const bonds = [];
    const bondOffset = 4 + counts.atomCount;
    for (let i = 0; i < counts.bondCount; i++) {
      const line = lines[bondOffset + i] || "";
      const a1 = Number(line.slice(0, 3).trim());
      const a2 = Number(line.slice(3, 6).trim());
      const order = Number(line.slice(6, 9).trim()) || 1;
      const atom1 = atomIdByMolIndex.get(a1);
      const atom2 = atomIdByMolIndex.get(a2);
      if (atom1 && atom2) {
        bonds.push(Model.createBond({
          atom1,
          atom2,
          order,
          type: "covalent",
          source: "manual"
        }));
      }
    }

    return Model.createState({
      atoms,
      bonds,
      metadata: {
        title,
        sourceFormat: raw.includes("$$$$") ? "sdf" : "mol",
        bondsInferred: false,
        manualBondIds: bonds.map(bond => bond.id)
      }
    });
  }

  function padLeft(value, width) {
    return String(value).padStart(width, " ");
  }

  function atomLine(atom) {
    const x = atom.x.toFixed(4).padStart(10, " ");
    const y = atom.y.toFixed(4).padStart(10, " ");
    const z = atom.z.toFixed(4).padStart(10, " ");
    return `${x}${y}${z} ${atom.element.padEnd(3, " ")} 0  0  0  0  0  0  0  0  0  0  0  0`;
  }

  function bondLine(bond, atomIndexById) {
    const a1 = atomIndexById.get(bond.atom1) || 0;
    const a2 = atomIndexById.get(bond.atom2) || 0;
    const order = Math.max(1, Math.min(3, Number(bond.order) || 1));
    return `${padLeft(a1, 3)}${padLeft(a2, 3)}${padLeft(order, 3)}  0  0  0  0`;
  }

  function stateToMolText(state) {
    const atomIndexById = new Map();
    state.atoms.forEach((atom, i) => atomIndexById.set(atom.id, i + 1));
    const validBonds = state.bonds.filter(bond => atomIndexById.has(bond.atom1) && atomIndexById.has(bond.atom2));
    const title = (state.metadata && state.metadata.title) || "Edited structure";
    const lines = [
      title,
      "Molecule Visualizer",
      "",
      `${padLeft(state.atoms.length, 3)}${padLeft(validBonds.length, 3)}  0  0  0  0            999 V2000`
    ];
    state.atoms.forEach(atom => lines.push(atomLine(atom)));
    validBonds.forEach(bond => lines.push(bondLine(bond, atomIndexById)));
    lines.push("M  END");
    return lines.join("\n") + "\n";
  }

  function stateToSDFText(state) {
    return stateToMolText(state) + "$$$$\n";
  }

  MV.IO = {
    normalizeXYZText,
    parseXYZAtoms,
    parseXYZToState,
    parseMolToState,
    atomsToXYZText,
    stateToXYZText,
    stateToMolText,
    stateToSDFText
  };
})(window);
