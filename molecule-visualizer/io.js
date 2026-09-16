(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer, M=MV.Model;
  const ELEMENTS='H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');
  function element(s){const e=String(s||'');if(!ELEMENTS.includes(e))throw Error(`未対応の元素記号「${e}」です。`);return e;}
  function finite(s){if(String(s).trim()==='')throw Error('座標が空です。');const n=Number(String(s).replace(/[dD]/,'e'));if(!Number.isFinite(n))throw Error(`数値「${s}」を読み取れません。`);return n;}
  function size(n){if(!Number.isInteger(n)||n<0||n>2000)throw Error('原子数は0〜2000の整数にしてください。');}
  function parseXYZAtoms(input){
    const lines=String(input||'').replace(/\r/g,'').split('\n');while(lines.length&&!lines[0].trim())lines.shift();while(lines.length&&!lines.at(-1).trim())lines.pop();
    if(!lines.length)throw Error('構造データを入力してください。');
    let title='',body=lines;
    if(/^\d+$/.test(lines[0].trim())){const n=Number(lines[0]);size(n);title=lines[1]||'';body=lines.slice(2);if(body.length!==n)throw Error(`XYZの原子数は${n}ですが、座標は${body.length}行です。2行目のコメント行（空でも可）が必要です。複数フレームは1つずつ読み込んでください。`);}
    size(body.length);
    const atoms=body.map((line,i)=>{const p=line.trim().split(/\s+/);if(p.length!==4)throw Error(`座標${i+1}行目は「元素 X Y Z」の4項目にしてください。`);return M.createAtom({element:element(p[0]),x:finite(p[1]),y:finite(p[2]),z:finite(p[3])});});
    return {atoms,title};
  }
  function parseXYZToState(input){const p=parseXYZAtoms(input);const s=M.createState({atoms:p.atoms,metadata:{title:p.title||'無題の構造',sourceFormat:'xyz',bondsInferred:true}});MV.Bonding.refreshInferredBonds(s);return s;}
  function atomsToXYZText(atoms,title){return [String(atoms.length),String(title||'Edited structure').replace(/[\r\n]/g,' '),...atoms.map(a=>`${a.element} ${a.x.toFixed(8)} ${a.y.toFixed(8)} ${a.z.toFixed(8)}`)].join('\n')+'\n';}
  function stateToXYZText(s){return atomsToXYZText(s.atoms,s.metadata.title);}
  function normalizeXYZText(t){const p=parseXYZAtoms(t);return atomsToXYZText(p.atoms,p.title);}
  // The CTfile module supplies V2000/V3000 parsing and attribute-preserving export.
  function parseMolToState(input){return MV.Molfile.parse(input);}
  function stateToMolText(s,version){return MV.Molfile.write(s,version);}
  function stateToProjectText(s){return JSON.stringify({format:'molecule-studio',version:1,atoms:s.atoms,bonds:s.bonds,metadata:s.metadata,viewSettings:s.viewSettings},null,2);}
  function parseProject(t){const p=JSON.parse(t);if(p.format!=='molecule-studio'||p.version!==1||!Array.isArray(p.atoms)||!Array.isArray(p.bonds))throw Error('対応するプロジェクトファイルではありません。');size(p.atoms.length);const ids=new Set();p.atoms.forEach(a=>{element(a.element);if(typeof a.id!=='string'||ids.has(a.id)||![a.x,a.y,a.z].every(Number.isFinite)||!Number.isInteger(a.charge||0)||Math.abs(a.charge||0)>15)throw Error('プロジェクトの原子データが不正です。');ids.add(a.id);});const seen=new Set(),bondIds=new Set();p.bonds.forEach(b=>{const k=[b.atom1,b.atom2].sort().join(':');if(typeof b.id!=='string'||bondIds.has(b.id)||!ids.has(b.atom1)||!ids.has(b.atom2)||b.atom1===b.atom2||seen.has(k)||![1,2,3,4].includes(b.order)||!['covalent','coordination_candidate','hydrogen'].includes(b.type))throw Error('プロジェクトの結合データが不正です。');seen.add(k);bondIds.add(b.id);});if(p.metadata?.title!=null&&typeof p.metadata.title!=="string")throw Error("構造名が不正です。");if(p.metadata?.suppressedBondKeys!=null&&!Array.isArray(p.metadata.suppressedBondKeys))throw Error("結合除外データが不正です。");const result=M.createState(p);if(!["stickball","stick","wire","vdw"].includes(result.viewSettings.style))result.viewSettings.style="stickball";return result;}
  function parseAuto(t){if(String(t).trim().startsWith('{'))return parseProject(t);if(/V[23]000/.test(t))return parseMolToState(t);return parseXYZToState(t);}
  MV.IO={ELEMENTS,normalizeXYZText,parseXYZAtoms,parseXYZToState,parseMolToState,atomsToXYZText,stateToXYZText,stateToMolText,stateToSDFText:s=>stateToMolText(s)+(s.metadata.sdfProperties?String(s.metadata.sdfProperties)+'\n\n':'')+'$$$$\n',stateToProjectText,parseProject,parseAuto};
})(window);
