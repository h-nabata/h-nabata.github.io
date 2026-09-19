(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};

  // Element weights: Open Babel 3.1.1 / Blue Obelisk element reference.
  const atomicMasses={"H":1.00794,"He":4.002602,"Li":6.941,"Be":9.012182,"B":10.811,"C":12.0107,"N":14.0067,"O":15.9994,"F":18.9984032,"Ne":20.1797,"Na":22.98977,"Mg":24.305,"Al":26.981538,"Si":28.0855,"P":30.973761,"S":32.065,"Cl":35.453,"Ar":39.948,"K":39.0983,"Ca":40.078,"Sc":44.95591,"Ti":47.867,"V":50.9415,"Cr":51.9961,"Mn":54.938049,"Fe":55.845,"Co":58.9332,"Ni":58.6934,"Cu":63.546,"Zn":65.38,"Ga":69.723,"Ge":72.64,"As":74.9216,"Se":78.96,"Br":79.904,"Kr":83.798,"Rb":85.4678,"Sr":87.62,"Y":88.90585,"Zr":91.224,"Nb":92.90638,"Mo":95.96,"Tc":98,"Ru":101.07,"Rh":102.9055,"Pd":106.42,"Ag":107.8682,"Cd":112.411,"In":114.818,"Sn":118.701,"Sb":121.76,"Te":127.6,"I":126.90447,"Xe":131.293,"Cs":132.90545,"Ba":137.327,"La":138.9055,"Ce":140.116,"Pr":140.90765,"Nd":144.24,"Pm":145,"Sm":150.36,"Eu":151.964,"Gd":157.25,"Tb":158.92534,"Dy":162.5,"Ho":164.93032,"Er":167.259,"Tm":168.93421,"Yb":173.054,"Lu":174.9668,"Hf":178.49,"Ta":180.9479,"W":183.84,"Re":186.207,"Os":190.23,"Ir":192.217,"Pt":195.078,"Au":196.96655,"Hg":200.59,"Tl":204.3833,"Pb":207.2,"Bi":208.9804,"Po":209,"At":210,"Rn":222,"Fr":223,"Ra":226,"Ac":227,"Th":232.0381,"Pa":231.03588,"U":238.02891,"Np":237.05,"Pu":244.06,"Am":243.06,"Cm":247.07,"Bk":247.07,"Cf":251.08,"Es":252.08,"Fm":257.1,"Md":258.1,"No":259.1,"Lr":262.11,"Rf":265.12,"Db":268.13,"Sg":271.13,"Bh":270,"Hs":277.15,"Mt":276.15,"Ds":281.16,"Rg":280.16,"Cn":285.17,"Nh":284.18,"Fl":289.19,"Mc":288.19,"Lv":293,"Ts":294,"Og":294};
  function centerOfMass(atoms){
    if(!atoms.length)throw Error('原子がありません。');
    let mass=0,x=0,y=0,z=0;
    for(const a of atoms){const m=Number(a.mol?.props?.MASS)||atomicMasses[a.element];if(!Number.isFinite(m)||m<=0)throw Error('原子質量を取得できません: '+a.element);mass+=m;x+=m*a.x;y+=m*a.y;z+=m*a.z;}
    return {x:x/mass,y:y/mass,z:z/mass};
  }
  function vsub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function vadd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function vscale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) {
    const n = norm(a);
    if (n < 1e-9) return { x: 1, y: 0, z: 0 };
    return vscale(a, 1 / n);
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function degToRad(v) { return v * Math.PI / 180; }
  function radToDeg(v) { return v * 180 / Math.PI; }

  function distance(a, b) {
    return norm(vsub(a, b));
  }

  function angle(a, b, c) {
    if (distance(a,b)<1e-9 || distance(b,c)<1e-9) throw new Error("同じ座標の原子を含む角度は定義できません。");
    const ba = unit(vsub(a, b));
    const bc = unit(vsub(c, b));
    return radToDeg(Math.acos(clamp(dot(ba, bc), -1, 1)));
  }

  function rotateAroundAxis(point, origin, axis, degrees) {
    const theta = degToRad(degrees);
    const u = unit(axis);
    const p = vsub(point, origin);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const term1 = vscale(p, cos);
    const term2 = vscale(cross(u, p), sin);
    const term3 = vscale(u, dot(u, p) * (1 - cos));
    return vadd(origin, vadd(vadd(term1, term2), term3));
  }

  function dihedral(a, b, c, d) {
    const b1 = vsub(b, a);
    const b2 = vsub(c, b);
    const b3 = vsub(d, c);
    if (norm(cross(b1,b2))<1e-9 || norm(cross(b2,b3))<1e-9) throw new Error("一直線または同じ座標の原子を含む二面角は定義できません。");
    const n1 = unit(cross(b1, b2));
    const n2 = unit(cross(b2, b3));
    const m1 = cross(n1, unit(b2));
    return radToDeg(Math.atan2(dot(m1, n2), dot(n1, n2)));
  }

  function setDistance(a, b, target) {
    const dir = unit(vsub(b, a));
    return vadd(a, vscale(dir, target));
  }

  function setAngle(a, b, c, targetDegrees) {
    const current = angle(a, b, c);
    let axis = cross(vsub(a, b), vsub(c, b));
    if (norm(axis)<1e-9) { const v=unit(vsub(a,b)); axis=cross(v,Math.abs(v.x)<0.9?{x:1,y:0,z:0}:{x:0,y:1,z:0}); }
    return rotateAroundAxis(c, b, axis, targetDegrees - current);
  }

  function setDihedral(a, b, c, d, targetDegrees) {
    const current = dihedral(a, b, c, d);
    return rotateAroundAxis(d, c, vsub(c, b), current - targetDegrees);
  }

  MV.Geometry = {
    centerOfMass,
    vsub,
    vadd,
    vscale,
    dot,
    cross,
    norm,
    unit,
    distance,
    angle,
    dihedral,
    rotateAroundAxis,
    setDistance,
    setAngle,
    setDihedral
  };
})(window);

