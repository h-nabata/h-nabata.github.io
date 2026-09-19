/* Periodic geometry and structural formats. Cell vectors are rows, in Å. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer, IO=MV.IO, M=MV.Model;
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const xyz=a=>[a.x,a.y,a.z];
  function cell(v,pbc=[true,true,true]){
    if(!Array.isArray(v)||v.length!==3||v.some(r=>!Array.isArray(r)||r.length!==3||r.some(x=>!Number.isFinite(x))))throw Error('セルは3×3の有限な数値で指定してください。');
    const volume=dot(v[0],cross(v[1],v[2]));
    if(Math.abs(volume)<1e-6||v.some(r=>Math.hypot(...r)>10000))throw Error('セルが特異、極端に小さい、または大きすぎます。');
    if(!Array.isArray(pbc)||pbc.length!==3||pbc.some(x=>typeof x!=='boolean'))throw Error('周期境界は3方向の真偽値で指定してください。');
    return {vectors:v.map(r=>r.slice()),pbc:pbc.slice()};
  }
  function reciprocal(c){const v=c.vectors,d=dot(v[0],cross(v[1],v[2]));return [cross(v[1],v[2]),cross(v[2],v[0]),cross(v[0],v[1])].map(r=>r.map(x=>x/d));}
  function fractional(p,c){return reciprocal(c).map(r=>dot(r,p));}
  function cartesian(p,c){return [0,1,2].map(j=>p.reduce((s,x,i)=>s+x*c.vectors[i][j],0));}
  function minimumImage(delta,c){
    const f=fractional(delta,c), initial=f.map((x,i)=>c.pbc[i]?Math.round(x):0);
    let vector=cartesian(f.map((x,i)=>x-initial[i]),c),best=dot(vector,vector),shift=initial.map(x=>-x);
    const bounds=reciprocal(c).map((r,i)=>{const radius=Math.hypot(...r)*Math.sqrt(best)+1e-9;return c.pbc[i]?[Math.ceil(f[i]-radius),Math.floor(f[i]+radius)]:[0,0];});
    if(bounds.reduce((s,b)=>s*(b[1]-b[0]+1),1)>20000)throw Error('セルの傾斜が極端なため最小像探索の上限を超えました。セルを簡約してください。');
    for(let a=bounds[0][0];a<=bounds[0][1];a++)for(let b=bounds[1][0];b<=bounds[1][1];b++)for(let d=bounds[2][0];d<=bounds[2][1];d++){
      const n=[a,b,d],v=cartesian(f.map((x,i)=>x-n[i]),c),dist=dot(v,v);if(dist<best-1e-12){best=dist;vector=v;shift=n.map(x=>-x);}
    }
    return {vector,distance:Math.sqrt(best),shift};
  }
  function wrap(s){const c=s.metadata.cell;if(!c)throw Error('周期セルがありません。');s.atoms.forEach(a=>{const f=fractional(xyz(a),c).map((x,i)=>c.pbc[i]?x-Math.floor(x):x);[a.x,a.y,a.z]=cartesian(f,c);});}
  function supercell(s,n){
    if(!s.metadata.cell)throw Error('周期セルがありません。');if(n.length!==3||n.some(x=>!Number.isInteger(x)||x<1||x>8)||s.atoms.length*n.reduce((a,b)=>a*b,1)>2000)throw Error('反復数は各1〜8、合計2000原子までです。');
    const result=M.cloneState(s),c=s.metadata.cell;result.atoms=[];result.bonds=[];
    for(let a=0;a<n[0];a++)for(let b=0;b<n[1];b++)for(let d=0;d<n[2];d++){
      const offset=cartesian([a,b,d],c),map=new Map();s.atoms.forEach(atom=>{const next=M.createAtom({...atom,id:undefined,x:atom.x+offset[0],y:atom.y+offset[1],z:atom.z+offset[2]});map.set(atom.id,next.id);result.atoms.push(next);});
      s.bonds.filter(b=>b.source!=='inferred').forEach(b=>result.bonds.push(M.createBond({...b,id:undefined,atom1:map.get(b.atom1),atom2:map.get(b.atom2)})));
    }
    result.metadata.cell=cell(c.vectors.map((r,i)=>r.map(x=>x*n[i])),c.pbc);delete result.metadata.trajectory;delete result.metadata.frameIndex;result.metadata.suppressedBondKeys=[];result.selectedAtomIds.clear();result.selectedBondIds.clear();MV.Bonding.refreshInferredBonds(result);return result;
  }
  const number=x=>{const n=Number(String(x).replace(/[dD]/,'e'));if(!String(x).trim()||!Number.isFinite(n))throw Error('構造データに無効な数値があります。');return n;};
  function parseFrame(lines){
    const count=Number(lines[0]);if(!Number.isInteger(count)||count<0||count>2000||lines.length!==count+2)throw Error('XYZの原子数と座標行数が一致しません（上限2000原子）。');
    const tv=lines.slice(2).filter(l=>/^TV\s/i.test(l.trim()));
    if(tv.length&&tv.length!==3)throw Error('単位格子は TV X Y Z を3行で指定してください。');
    lines=[lines[0],lines[1],...lines.slice(2).filter(l=>!/^TV\s/i.test(l.trim()))];
    const comment=lines[1]||'', lattice=comment.match(/\bLattice="([^"]+)"/i),pbc=comment.match(/\bpbc="([^"]+)"/i),props=comment.match(/\bProperties=([^\s]+)/i);
    let c=null;if(lattice){const v=lattice[1].trim().split(/\s+/).map(number);if(v.length!==9)throw Error('Latticeには9個の値が必要です。');const flags=pbc?pbc[1].trim().split(/\s+/).map(x=>{if(!/^(T|F|true|false|1|0)$/i.test(x))throw Error('pbcが不正です。');return /^(T|true|1)$/i.test(x);}):[true,true,true];c=cell([v.slice(0,3),v.slice(3,6),v.slice(6)],flags);}else if(pbc)throw Error('pbcにはLatticeが必要です。');
    if(tv.length){const tc=cell(tv.map(l=>l.trim().split(/\s+/).slice(1).map(number)),c?.pbc);if(c&&c.vectors.some((r,i)=>r.some((v,j)=>Math.abs(v-tc.vectors[i][j])>1e-7)))throw Error('TVとLatticeの単位格子が一致しません。');c=tc;}
    const schema=(props?props[1]:'species:S:1:pos:R:3').split(':');let offset=0,fields=[];
    if(schema.length%3)throw Error('Propertiesが不正です。');for(let i=0;i<schema.length;i+=3){const size=Number(schema[i+2]);if(!Number.isInteger(size)||size<1||size>100)throw Error('Propertiesの列数が不正です。');fields.push({name:schema[i],type:schema[i+1],size,offset});offset+=size;}
    const species=fields.find(x=>x.name==='species'&&x.size===1),pos=fields.find(x=>x.name==='pos'&&x.size===3);if(!species||!pos)throw Error('Propertiesにはspeciesとposが必要です。');
    const atoms=lines.slice(2).map(line=>{const p=line.trim().split(/\s+/);if(p.length!==offset)throw Error('XYZの列数がPropertiesと一致しません。');if(!IO.ELEMENTS.includes(p[species.offset]))throw Error('無効な元素記号です。');const v=p.slice(pos.offset,pos.offset+3).map(number);return M.createAtom({element:p[species.offset],x:v[0],y:v[1],z:v[2],xyzExtras:Object.fromEntries(fields.filter(f=>f!==species&&f!==pos).map(f=>[f.name,{type:f.type,values:p.slice(f.offset,f.offset+f.size)}]))});});
    const title=comment.replace(/\b(Lattice|pbc)="[^"]*"/gi,'').replace(/\bProperties=\S+/i,'').trim();
    const s=M.createState({atoms,metadata:{title,sourceFormat:'xyz',cell:c}});MV.Bonding.refreshInferredBonds(s);return s;
  }
  function snapshot(s){const metadata=JSON.parse(JSON.stringify(s.metadata));delete metadata.trajectory;delete metadata.frameIndex;delete metadata.measurements;return {atoms:JSON.parse(JSON.stringify(s.atoms)),bonds:JSON.parse(JSON.stringify(s.bonds)),metadata};}
  // Normalize Unicode whitespace without collapsing the XYZ comment line.
  function normalizeXYZInput(text){return String(text).replace(/\r\n|[\r\u0085\u2028\u2029\v\f]/g,'\n').replace(/[\uFEFF\u200B]/g,'').replace(/[^\S\n]/gu,' ');}
  function parseXYZ(text){
    const lines=normalizeXYZInput(text).split('\n');while(lines.length&&!lines[0].trim())lines.shift();
    if(!/^\d+$/.test(lines[0]?.trim()||'')){
      const nonempty=lines.map(l=>l.trim()).filter(Boolean);if(!nonempty.length)throw Error('XYZが空です。');const tv=nonempty.filter(l=>/^TV\s/i.test(l)),body=nonempty.filter(l=>!/^TV\s/i.test(l));
      const s=parseFrame([String(body.length),'',...body]);if(tv.length){s.metadata.cell=cell(tv.map(l=>l.trim().split(/\s+/).slice(1).map(number)));MV.Bonding.refreshInferredBonds(s);}return s;
    }
    const frames=[];let total=0;
    while(lines.length){
      if(!lines[0].trim()){lines.shift();continue;}
      const n=Number(lines.shift());if(!Number.isInteger(n)||n<0||n>2000||!lines.length)throw Error('XYZの原子数またはコメント行を確認してください。');
      const comment=lines.shift(),body=[];
      while(body.length<n&&lines.length){const line=lines.shift();if(line.trim())body.push(line);}
      if(body.length!==n)throw Error('XYZの原子数と座標行数が一致しません。');
      while(lines.length&&(!lines[0].trim()||/^TV\s/i.test(lines[0].trim()))){const line=lines.shift();if(line.trim())body.push(line);}
      frames.push(parseFrame([String(body.length),comment,...body]));total+=n;if(frames.length>200||total>100000)throw Error('軌跡は200フレーム・合計100000原子までです。');
    }
    const s=frames[0];if(!s)throw Error('XYZが空です。');if(frames.length>1){s.metadata.trajectory=frames.map(snapshot);s.metadata.frameIndex=0;}return s;
  }
  function toXYZ(s){
    const c=s.metadata.cell, extras=s.atoms[0]?.xyzExtras||{},keys=Object.keys(extras);
    if(s.atoms.some(a=>JSON.stringify(Object.keys(a.xyzExtras||{}))!==JSON.stringify(keys)))throw Error('拡張XYZの追加列が原子間で一致しません。プロジェクト形式で保存してください。');
    let title=String(s.metadata.title||'').replace(/[\r\n]/g,' ');
    if(c)title+=` Lattice="${c.vectors.flat().map(x=>x.toFixed(10)).join(' ')}" pbc="${c.pbc.map(x=>x?'T':'F').join(' ')}"`;
    if(c||keys.length)title+=' Properties=species:S:1:pos:R:3'+keys.map(k=>`:${k}:${extras[k].type}:${extras[k].values.length}`).join('');
    return [s.atoms.length,title.trim(),...s.atoms.map(a=>`${a.element} ${xyz(a).map(x=>x.toFixed(10)).join(' ')}${keys.length?' '+keys.flatMap(k=>a.xyzExtras[k].values).join(' '):''}`)].join('\n')+'\n';
  }
  // GRRM-style editor: TV rows are cell vectors, never atoms.
  function editorText(s,header=true){
    const copy=M.cloneState(s),c=copy.metadata.cell;copy.metadata.cell=null;
    const lines=toXYZ(copy).split('\n').slice(0,-1);
    if(c)lines.push(...c.vectors.map(r=>'TV '+r.map(x=>x.toFixed(10)).join(' ')));
    return (header?lines:lines.slice(2)).join('\n')+'\n';
  }
  function lowerTriangular(s){
    const c=s.metadata.cell;if(!c)throw Error('まずTVを3行、または単位格子ダイアログで格子を指定してください。');
    const e1=c.vectors[0].map(x=>x/Math.hypot(...c.vectors[0]));
    const b=c.vectors[1].map((x,i)=>x-dot(c.vectors[1],e1)*e1[i]),e2=b.map(x=>x/Math.hypot(...b)),e3=cross(e1,e2);
    const rotate=v=>[e1,e2,e3].map(e=>dot(v,e));
    s.atoms.forEach(a=>{[a.x,a.y,a.z]=rotate(xyz(a));});
    const v=c.vectors.map(rotate);v[0][1]=v[0][2]=v[1][2]=0;s.metadata.cell=cell(v,c.pbc);
  }
  function parsePOSCAR(text){
    const l=String(text).replace(/\r/g,'').trim().split('\n');if(l.length<8)throw Error('POSCARが短すぎます。');const scale=number(l[1]);if(!scale)throw Error('POSCARのスケールは0以外です。');const raw=l.slice(2,5).map(r=>r.trim().split(/\s+/).map(number));let c=cell(raw);const factor=scale>0?scale:Math.cbrt(-scale/Math.abs(dot(raw[0],cross(raw[1],raw[2]))));c=cell(raw.map(r=>r.map(x=>x*factor)));
    const names=l[5].trim().split(/\s+/),counts=l[6].trim().split(/\s+/).map(number);if(names.some(x=>!IO.ELEMENTS.includes(x))||names.length!==counts.length||counts.some(n=>!Number.isInteger(n)||n<0)||counts.reduce((a,b)=>a+b,0)>2000)throw Error('元素名のあるVASP 5形式のPOSCAR（2000原子以下）が必要です。');
    let index=7,selective=/^s/i.test(l[index].trim());if(selective)index++;const mode=l[index++].trim();if(!/^[dck]/i.test(mode))throw Error('DirectまたはCartesianを指定してください。');const atoms=[];
    names.forEach((element,i)=>{for(let j=0;j<counts[i];j++){const p=(l[index++]||'').trim().split(/\s+/);let v=p.slice(0,3).map(number);if(v.length!==3)throw Error('POSCAR座標が不足しています。');v=/^d/i.test(mode)?cartesian(v,c):v.map(x=>x*factor);const flags=selective?p.slice(3,6):null;if(selective&&(flags.length!==3||flags.some(x=>! /^[TF]$/i.test(x))))throw Error('Selective dynamicsの指定が不正です。');atoms.push(M.createAtom({element,x:v[0],y:v[1],z:v[2],selective:flags}));}});
    if(l.slice(index).some(x=>x.trim()))throw Error('速度・追加ブロックを含むPOSCARには未対応です。座標ブロックのみ読み込んでください。');
    const s=M.createState({atoms,metadata:{title:l[0],cell:c,sourceFormat:'poscar'}});MV.Bonding.refreshInferredBonds(s);return s;
  }
  function toPOSCAR(s){const c=s.metadata.cell;if(!c||!c.pbc.every(Boolean))throw Error('POSCARには3方向すべてが周期的なセルが必要です。');const elements=[...new Set(s.atoms.map(a=>a.element))],selective=s.atoms.some(a=>a.selective);return [s.metadata.title||'Structure','1.0',...c.vectors.map(r=>r.join(' ')),elements.join(' '),elements.map(e=>s.atoms.filter(a=>a.element===e).length).join(' '),...(selective?['Selective dynamics']:[]),'Direct',...elements.flatMap(e=>s.atoms.filter(a=>a.element===e).map(a=>fractional(xyz(a),c).map(x=>x.toFixed(12)).join(' ')+(selective?' '+(a.selective||['T','T','T']).join(' '):'')))].join('\n')+'\n';}
  const oldAuto=IO.parseAuto, oldProject=IO.parseProject,oldMol=IO.stateToMolText;
  IO.normalizeXYZInput=normalizeXYZInput;
  IO.parseXYZToState=parseXYZ;IO.stateToXYZText=toXYZ;
  IO.parseXYZAtoms=t=>{const s=parseXYZ(t);if(s.metadata.cell||s.metadata.trajectory)throw Error('原子団の追加は単一の非周期XYZを使用してください。');return {atoms:s.atoms,title:s.metadata.title};};
  IO.parseProject=t=>{const s=oldProject(t);if(s.metadata.cell)s.metadata.cell=cell(s.metadata.cell.vectors,s.metadata.cell.pbc);if(s.metadata.trajectory){if(!Array.isArray(s.metadata.trajectory)||s.metadata.trajectory.length>200)throw Error('軌跡データが不正です。');s.metadata.trajectory=s.metadata.trajectory.map(f=>snapshot(IO.parseProject(JSON.stringify({format:'molecule-studio',version:1,...f,metadata:{...f.metadata,trajectory:undefined}}))));if(!Number.isInteger(s.metadata.frameIndex)||s.metadata.frameIndex<0||s.metadata.frameIndex>=s.metadata.trajectory.length)throw Error('フレーム番号が不正です。');}return s;};
  IO.parseAuto=t=>String(t).trim().startsWith('{')?IO.parseProject(t):/V[23]000/.test(t)?oldAuto(t):/^\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*$/.test(String(t).split('\n')[1]||'')&&!/^\d+\s*$/.test(String(t).split('\n')[0])?parsePOSCAR(t):parseXYZ(t);
  IO.stateToMolText=(s,version)=>{if(s.metadata.cell)throw Error('MOLは周期セルを保持できません。拡張XYZ・POSCAR・プロジェクトで保存してください。');return oldMol(s,version);};
  IO.stateToSDFText=s=>IO.stateToMolText(s)+(s.metadata.sdfProperties?String(s.metadata.sdfProperties)+'\n\n':'')+'$$$$\n';
  MV.Periodic={cell,fractional,cartesian,minimumImage,wrap,supercell,parsePOSCAR,toPOSCAR,snapshot,xyz,editorText,lowerTriangular};
})(window);
