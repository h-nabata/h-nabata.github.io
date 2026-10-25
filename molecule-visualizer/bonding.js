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
    const bonds=[],radii=atoms.map(a=>COVALENT_RADII[a.element]||0),metal=atoms.map(a=>isMetal(a.element));
    const mic=cell?MV.Periodic.prepareMinimumImage(cell):null;
    const cutoff=2*Math.max(0,...radii)*BOND_DISTANCE_SCALE*(1+1e-12);
    let buckets=null,locations=null,counts=null;
    // Fractional bounds |df_k| <= cutoff*|reciprocal_k| are conservative even
    // for skew cells. Wrapped bucket indices cover crossings of periodic faces.
    if(atoms.length>=96&&cutoff>0){
      buckets=new Map();
      const widths=mic?mic.reciprocalNorms.map(n=>n*cutoff):[cutoff,cutoff,cutoff];
      counts=widths.map((w,k)=>cell?.pbc[k]?Math.max(1,Math.floor(1/w)):0);
      locations=atoms.map(a=>(mic?mic.fractional([a.x,a.y,a.z]):[a.x,a.y,a.z]).map((x,k)=>
        counts[k]?((Math.floor(x*counts[k])%counts[k])+counts[k])%counts[k]:Math.floor(x/widths[k])));
      locations.forEach((p,i)=>{if(!radii[i])return;const key=p.join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);});
    }
    for(let i=0;i<atoms.length;i++){
      if(!radii[i])continue;
      let candidates;
      if(buckets){
        candidates=[];const seen=new Set(),p=locations[i];
        for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
          const q=[p[0]+x,p[1]+y,p[2]+z].map((v,k)=>counts[k]?((v%counts[k])+counts[k])%counts[k]:v),key=q.join(',');
          if(seen.has(key))continue;seen.add(key);
          for(const j of buckets.get(key)||[])if(j>i)candidates.push(j);
        }
        // Stable original pair order preserves inferred-bond identity allocation.
        candidates.sort((a,b)=>a-b);
      }else candidates=null;
      const consider=j=>{
        if(!radii[j])return;
        const a=atoms[i],b=atoms[j],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
        const metalPair=metal[i]||metal[j],limit=(metalPair?METAL_DISTANCE_SCALE:BOND_DISTANCE_SCALE)*(radii[i]+radii[j]);
        const d=mic?mic([dx,dy,dz]).distance:Math.sqrt(dx*dx+dy*dy+dz*dz);
        if(d<MIN_BOND_DISTANCE||d>limit)return;
        bonds.push(Model.createBond({atom1:a.id,atom2:b.id,order:1,type:metalPair?'coordination_candidate':'covalent',source:'inferred'}));
      };
      if(candidates)for(const j of candidates)consider(j);
      else for(let j=i+1;j<atoms.length;j++)consider(j);
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

