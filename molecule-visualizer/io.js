(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer, M=MV.Model;
  const ELEMENTS='H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');
  function element(s){const e=String(s||'');if(!ELEMENTS.includes(e))throw Error(`未対応の元素記号「${e}」です。TV等の周期セル情報には対応していません。`);return e;}
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
  function parseMolToState(input,{generated3D=false}={}){
    const raw=String(input||'').replace(/\r/g,'');const records=raw.split('$$$$').filter(x=>x.trim());if(records.length>1)throw Error('複数構造のSDFは1構造ずつ読み込んでください。');
    const lines=records[0]?.split('\n')||[];if(lines.length<4||!lines[3].includes('V2000'))throw Error('MOL/SDFはV2000形式に対応しています。V3000はXYZまたはV2000へ変換してください。');
    const n=finite(lines[3].slice(0,3)),nb=finite(lines[3].slice(3,6));size(n);if(!Number.isInteger(nb)||nb<0||nb>999)throw Error('結合数が不正です。');
    const tail=lines.slice(4+n+nb);if(!tail.includes('M  END'))throw Error('MOLの終端 M  END がありません。');
    if(tail.some(l=>/^M  (?!END|CHG)/.test(l))||tail.some(l=>/^A  |^V  |^S  /.test(l)))throw Error('同位体・ラジカル・特殊注記を含むMOLは、情報を失わないよう読み込みを停止しました。');
    const atoms=[];for(let i=0;i<n;i++){const l=lines[4+i]||'';const code=Number(l.slice(36,39));if(Number(l.slice(34,36))||(!generated3D&&Number(l.slice(39,42)))||Number(l.slice(60,63))||code===4)throw Error('同位体・立体指定・ラジカル・原子マッピングを含むMOLは未対応です。');if(![0,1,2,3,5,6,7].includes(code))throw Error('MOLの電荷指定が不正です。');atoms.push(M.createAtom({element:element(l.slice(31,34).trim()),x:finite(l.slice(0,10)),y:finite(l.slice(10,20)),z:finite(l.slice(20,30)),charge:({1:3,2:2,3:1,5:-1,6:-2,7:-3})[code]||0}));}
    const bonds=[];const keys=new Set();for(let i=0;i<nb;i++){const l=lines[4+n+i]||'',a=Number(l.slice(0,3)),b=Number(l.slice(3,6)),order=Number(l.slice(6,9));if(!atoms[a-1]||!atoms[b-1]||a===b||![1,2,3,4].includes(order))throw Error('MOLの結合指定が不正または未対応です。');if(!generated3D&&Number(l.slice(9,12)))throw Error('くさび結合などの立体指定は未対応です。');const key=[a,b].sort().join(':');if(keys.has(key))throw Error('MOLに重複結合があります。');keys.add(key);bonds.push(M.createBond({atom1:atoms[a-1].id,atom2:atoms[b-1].id,order,source:'manual'}));}
    const chargeLines=tail.filter(l=>l.startsWith('M  CHG'));if(chargeLines.length)atoms.forEach(a=>a.charge=0);
    chargeLines.forEach(l=>{const p=l.trim().split(/\s+/);const count=Number(p[2]);if(!Number.isInteger(count)||p.length!==3+2*count)throw Error('M CHG行が不正です。');for(let i=0;i<count;i++){const a=atoms[Number(p[3+2*i])-1],c=Number(p[4+2*i]);if(!a||!Number.isInteger(c)||Math.abs(c)>15)throw Error('形式電荷が不正です。');a.charge=c;}});
    return M.createState({atoms,bonds,metadata:{title:lines[0]||'MOL structure',generatedMol:generated3D?raw:undefined,sourceFormat:raw.includes('$$$$')?'sdf':'mol',bondsInferred:false,sdfProperties:tail.slice(tail.indexOf('M  END')+1).join('\n').trim()}});
  }
  const pad=(v,w)=>String(v).padStart(w,' ');
  function stateToMolText(s){
    if(s.atoms.length>999||s.bonds.length>999)throw Error('V2000は原子・結合とも999までです。XYZまたはプロジェクトで保存してください。');
    if(s.bonds.some(b=>b.type!=='covalent'))throw Error('配位候補・水素結合はMOL/SDFに保存できません。プロジェクト形式で保存してください。');
    const ids=new Map(s.atoms.map((a,i)=>[a.id,i+1]));
    const lines=[String(s.metadata.title||'Edited structure').replace(/[\r\n]/g,' '),'Molecule Studio','',`${pad(s.atoms.length,3)}${pad(s.bonds.length,3)}  0  0  0  0            999 V2000`];
    s.atoms.forEach(a=>{const coords=[a.x,a.y,a.z].map(x=>x.toFixed(4));if(coords.some(x=>x.length>10))throw Error('座標がV2000の桁数を超えています。XYZで保存してください。');lines.push(coords.map(x=>pad(x,10)).join('')+` ${a.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);});
    s.bonds.forEach(b=>lines.push(`${pad(ids.get(b.atom1),3)}${pad(ids.get(b.atom2),3)}${pad(b.order,3)}  0  0  0  0`));
    const charged=s.atoms.map((a,i)=>[i+1,a.charge||0]).filter(x=>x[1]);for(let i=0;i<charged.length;i+=8){const chunk=charged.slice(i,i+8);lines.push(`M  CHG${pad(chunk.length,3)}`+chunk.map(([a,c])=>pad(a,4)+pad(c,4)).join(''));}
    lines.push('M  END');return lines.join('\n')+'\n';
  }
  function stateToProjectText(s){return JSON.stringify({format:'molecule-studio',version:1,atoms:s.atoms,bonds:s.bonds,metadata:s.metadata,viewSettings:s.viewSettings},null,2);}
  function parseProject(t){const p=JSON.parse(t);if(p.format!=='molecule-studio'||p.version!==1||!Array.isArray(p.atoms)||!Array.isArray(p.bonds))throw Error('対応するプロジェクトファイルではありません。');size(p.atoms.length);const ids=new Set();p.atoms.forEach(a=>{element(a.element);if(typeof a.id!=='string'||ids.has(a.id)||![a.x,a.y,a.z].every(Number.isFinite)||!Number.isInteger(a.charge||0)||Math.abs(a.charge||0)>15)throw Error('プロジェクトの原子データが不正です。');ids.add(a.id);});const seen=new Set(),bondIds=new Set();p.bonds.forEach(b=>{const k=[b.atom1,b.atom2].sort().join(':');if(typeof b.id!=='string'||bondIds.has(b.id)||!ids.has(b.atom1)||!ids.has(b.atom2)||b.atom1===b.atom2||seen.has(k)||![1,2,3,4].includes(b.order)||!['covalent','coordination_candidate','hydrogen'].includes(b.type))throw Error('プロジェクトの結合データが不正です。');seen.add(k);bondIds.add(b.id);});if(p.metadata?.title!=null&&typeof p.metadata.title!=="string")throw Error("構造名が不正です。");if(p.metadata?.suppressedBondKeys!=null&&!Array.isArray(p.metadata.suppressedBondKeys))throw Error("結合除外データが不正です。");const result=M.createState(p);if(!["stickball","stick","wire","vdw"].includes(result.viewSettings.style))result.viewSettings.style="stickball";return result;}
  function parseAuto(t){if(String(t).trim().startsWith('{'))return parseProject(t);if(/V[23]000/.test(t))return parseMolToState(t);return parseXYZToState(t);}
  MV.IO={ELEMENTS,normalizeXYZText,parseXYZAtoms,parseXYZToState,parseMolToState,atomsToXYZText,stateToXYZText,stateToMolText,stateToSDFText:s=>stateToMolText(s)+(s.metadata.sdfProperties?String(s.metadata.sdfProperties)+'\n\n':'')+'$$$$\n',stateToProjectText,parseProject,parseAuto};
})(window);
