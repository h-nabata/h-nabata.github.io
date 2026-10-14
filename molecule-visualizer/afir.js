/* Multi-pair AFIR artificial potential. Å, eV, eV/Å; no network or physical PES.
 * Formula: Maeda et al., J. Comput. Chem. 39 (2018), doi:10.1002/jcc.25106.
 * Radii: Cordero et al. (2008), as tabulated in ASE 3.26.0 (H–Cm).
 */
(function(root){
  'use strict';
  const KJMOL_TO_EV=1/96.48533288249877, R0=3.8164, EPSILON=1.0061;
  const radii={H:.31,He:.28,Li:1.28,Be:.96,B:.84,C:.76,N:.71,O:.66,F:.57,Ne:.58,Na:1.66,Mg:1.41,Al:1.21,Si:1.11,P:1.07,S:1.05,Cl:1.02,Ar:1.06,K:2.03,Ca:1.76,Sc:1.7,Ti:1.6,V:1.53,Cr:1.39,Mn:1.39,Fe:1.32,Co:1.26,Ni:1.24,Cu:1.32,Zn:1.22,Ga:1.22,Ge:1.2,As:1.19,Se:1.2,Br:1.2,Kr:1.16,Rb:2.2,Sr:1.95,Y:1.9,Zr:1.75,Nb:1.64,Mo:1.54,Tc:1.47,Ru:1.46,Rh:1.42,Pd:1.39,Ag:1.45,Cd:1.44,In:1.42,Sn:1.39,Sb:1.39,Te:1.38,I:1.39,Xe:1.4,Cs:2.44,Ba:2.15,La:2.07,Ce:2.04,Pr:2.03,Nd:2.01,Pm:1.99,Sm:1.98,Eu:1.98,Gd:1.96,Tb:1.94,Dy:1.92,Ho:1.92,Er:1.89,Tm:1.9,Yb:1.87,Lu:1.87,Hf:1.75,Ta:1.7,W:1.62,Re:1.51,Os:1.44,Ir:1.41,Pt:1.36,Au:1.36,Hg:1.32,Tl:1.45,Pb:1.46,Bi:1.48,Po:1.4,At:1.5,Rn:1.5,Fr:2.6,Ra:2.21,Ac:2.15,Th:2.06,Pa:2,U:1.96,Np:1.9,Pu:1.87,Am:1.8,Cm:1.69};
  const palette=['#087e85','#b45420','#6a46a3','#2766a1','#a53f68','#477334'];
  function number(v,name,lo,hi,integer=false){
    if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi||(integer&&!Number.isInteger(v)))throw Error(`${name}は${lo}〜${hi}${integer?'の整数':''}にしてください。`);
    return v;
  }
  function alphaFromGamma(gamma){
    number(gamma,'γ (kJ/mol)',0,1000);if(gamma===0)return 0;
    const t=gamma/EPSILON,logRatio=Math.log1p(t/(Math.sqrt(1+t)+1)/2);
    return gamma*KJMOL_TO_EV/(R0*Math.pow(2,-1/6)*(-Math.expm1(-logRatio/6)));
  }
  const defaults=()=>({schema:'molecule-afir/1',fragments:[],pairs:[],charge:0,multiplicity:1,maxSteps:150,fmax:.05,maxMove:.04});
  function validate(atoms,config,cell=null){
    if(!Array.isArray(atoms)||atoms.length<2||atoms.length>500)throw Error('AFIRの原子数は2〜500にしてください。');
    const index=new Map();atoms.forEach((a,i)=>{
      if(typeof a.id!=='string'||!a.id||index.has(a.id))throw Error('原子IDが重複しているか、ありません。');
      index.set(a.id,i);if(!Object.hasOwn(radii,a.element))throw Error(`AFIR半径が未定義の元素です: ${a.element}`);
      for(const k of ['x','y','z'])number(a[k],'座標 (Å)',-10000,10000);
    });
    if(cell?.pbc?.some(Boolean))throw Error('このAFIR実装は非周期分子用です。周期セルの設定を解除してください。');
    if(!config||config.schema!=='molecule-afir/1')throw Error('AFIR設定の形式が一致しません。');
    if(!Array.isArray(config.fragments)||config.fragments.length<2||config.fragments.length>64)throw Error('フラグメントを2〜64個指定してください。');
    if(!Array.isArray(config.pairs)||config.pairs.length<1||config.pairs.length>128)throw Error('フラグメントのペアを1〜128組指定してください。');
    const groups=new Map();for(const f of config.fragments){
      if(typeof f.id!=='string'||!f.id||groups.has(f.id)||typeof f.label!=='string'||!f.label.trim()||f.label.length>40)throw Error('フラグメントのIDまたは名前が不正です。');
      if(!Array.isArray(f.atomIds)||!f.atomIds.length||new Set(f.atomIds).size!==f.atomIds.length||f.atomIds.some(id=>!index.has(id)))throw Error(`${f.label}: 空の原子団、重複原子、削除された原子IDがあります。選択し直してください。`);
      groups.set(f.id,f.atomIds.map(id=>index.get(id)).sort((a,b)=>a-b));
    }
    const used=new Set(),terms=config.pairs.map(p=>{
      const a=groups.get(p.a),b=groups.get(p.b);
      if(!a||!b||a.some(i=>b.includes(i)))throw Error('ペアは、原子が重ならない2つのフラグメントで指定してください。');
      if(!['attract','repel'].includes(p.mode))throw Error('人工力は「近づける」または「離す」で指定してください。');
      const key=[a.join(','),b.join(',')].sort().join('|');if(used.has(key))throw Error('同じ原子団のペアが重複しています。向きを入れ替えたペアも同じ1組として扱います。');used.add(key);
      return {a,b,mode:p.mode,gamma:p.gamma,alpha:alphaFromGamma(p.gamma)};
    });
    number(config.charge,'電荷',-100,100,true);number(config.multiplicity,'多重度',1,101,true);
    number(config.maxSteps,'最大ステップ数',1,500,true);number(config.fmax,'収束しきい値 (eV/Å)',.00001,10);number(config.maxMove,'最大変位 (Å)',.001,.2);
    return {terms,atomIds:atoms.map(a=>a.id)};
  }
  function evaluate(atoms,config,cell=null){
    const {terms}=validate(atoms,config,cell),forces=atoms.map(()=>[0,0,0]),pairs=[];let energy=0;
    for(const term of terms){
      const distances=[];for(const i of term.a)for(const j of term.b){
        const d=['x','y','z'].map(k=>atoms[i][k]-atoms[j][k]),r=Math.hypot(...d);
        if(r<.1)throw Error('人工力の適用先で0.1 Å未満の原子衝突があります。');
        distances.push({i,j,d,r,logw:6*Math.log((radii[atoms[i].element]+radii[atoms[j].element])/r)});
      }
      const logmax=Math.max(...distances.map(t=>t.logw));let sum=0,D=0;
      for(const t of distances){t.w=Math.exp(t.logw-logmax);sum+=t.w;D+=t.w*t.r;}D/=sum;
      const coefficient=term.alpha*(term.mode==='attract'?1:-1);energy+=coefficient*D;
      for(const t of distances){const derivative=coefficient*t.w/sum*(1-6+6*D/t.r);for(let k=0;k<3;k++){const f=-derivative*t.d[k]/t.r;forces[t.i][k]+=f;forces[t.j][k]-=f;}}
      pairs.push({distanceA:D,energyEV:coefficient*D,alphaEV_A:term.alpha});
    }
    return {energyEV:energy,forcesEV_A:forces,pairs};
  }
  function exportInput(state,config){
    validate(state.atoms,config,state.metadata?.cell);
    const atomIds=state.atoms.map(a=>a.id),names=new Map(config.fragments.map((f,i)=>[f.id,`F${i+1}`]));
    const generic={schema:'enb-general-afir/1',charge:config.charge,multiplicity:config.multiplicity,
      fragments:Object.fromEntries(config.fragments.map(f=>[names.get(f.id),{indices:f.atomIds.map(id=>atomIds.indexOf(id)+1)}])),
      pairs:config.pairs.map((p,i)=>({name:`pair-${i+1}`,fragments:[names.get(p.a),names.get(p.b)],mode:p.mode,gamma_kJ_mol:p.gamma}))};
    const xyz=`${state.atoms.length}\nAFIR input; atom order matches atomIds in JSON; positions in angstrom\n`+state.atoms.map(a=>`${a.element} ${a.x.toFixed(12)} ${a.y.toFixed(12)} ${a.z.toFixed(12)}`).join('\n')+'\n';
    return {schema:'molecule-afir-input/1',atomIds,xyz,config:JSON.parse(JSON.stringify(config)),pythonConfig:generic,units:{length:'angstrom',gamma:'kJ/mol',alpha:'eV/angstrom'},reference:{R0_A:R0,epsilon_kJ_mol:EPSILON,power:6}};
  }
  const api={alphaFromGamma,validate,evaluate,exportInput,defaults,radii:Object.freeze(radii),palette,KJMOL_TO_EV,R0,EPSILON};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else(root.MoleculeVisualizer=root.MoleculeVisualizer||{}).AFIR=api;
})(typeof window!=='undefined'?window:globalThis);
