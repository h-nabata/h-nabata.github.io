/* Local structural importers. Coordinates are normalized to angstrom; no input is executed.
 * Format references and supported subsets are documented in IMPORT-FORMATS.md.
 */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,IO=MV.IO,M=MV.Model,P=MV.Periodic,F=MV.Formats;
  const oldParse=F.parse,oldDetect=F.detect,BOHR=.529177210903,MAX_BYTES=50*1024*1024;
  const NUM=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;
  const clean=t=>String(t).replace(/^\uFEFF/,'').replace(/\r\n|[\r\u0085\u2028\u2029]/g,'\n');
  const tokens=l=>l.trim().split(/[\s,]+/).filter(Boolean);
  function num(x){if(!NUM.test(String(x)))throw Error('有限の数値を読み取れません: '+x);const n=Number(String(x).replace(/[dD]/,'e'));if(!Number.isFinite(n))throw Error('数値が範囲外です。');return n;}
  function integer(x,min=0,max=2000){const n=num(x);if(!Number.isInteger(n)||n<min||n>max)throw Error('整数の範囲が不正です: '+x);return n;}
  function symbol(raw){
    const original=String(raw),match=original.match(/^([A-Za-z]{1,2})(?:\d+|\([^)]*\))?$/);
    let e=/^\d+$/.test(original)?IO.ELEMENTS[integer(original,1,118)-1]:match?.[1];
    if(e==='D'||e==='T')return 'H';
    e=e?.[0].toUpperCase()+e?.slice(1).toLowerCase();
    if(!IO.ELEMENTS.includes(e))throw Error('元素を特定できません（ダミー・ghost原子は未対応）: '+raw);
    return e;
  }
  function atom(raw,xyz,scale=1){
    if(xyz.length!==3)throw Error('Cartesian座標は3成分必要です。');
    const p=xyz.map(x=>num(x)*scale);if(!p.every(Number.isFinite))throw Error('座標が範囲外です。');
    const a=M.createAtom({element:symbol(raw),x:p[0],y:p[1],z:p[2]});
    const mass=String(raw).match(/\(\s*Iso\s*=\s*(\d+)\s*\)/i)?.[1]||({D:'2',T:'3'}[raw]);
    if(mass)a.mol={props:{MASS:mass}};return a;
  }
  function cartRow(line,scale=1,freeze=false){
    const p=tokens(line.split(/[!#]/)[0]);let fixed=false;
    if(freeze&&p.length===5&&/^(?:-1|0|1)$/.test(p[1])){fixed=p[1]==='-1';p.splice(1,1);}
    if(p.length!==4)throw Error('Cartesian座標「元素 X Y Z」を確認してください: '+line.slice(0,120));
    if(/^TV$/i.test(p[0]))return {vector:p.slice(1).map(x=>num(x)*scale)};
    return {atom:atom(p[0],p.slice(1),scale),fixed};
  }
  function state(atoms,title,format,metadata={}){
    if(!atoms.length||atoms.length>2000)throw Error('各構造は1〜2000原子にしてください。');
    const s=M.createState({atoms,metadata:{title:title||format,sourceFormat:format,...metadata}});
    MV.Bonding.refreshInferredBonds(s);return s;
  }
  function fixedMetadata(s,indices){if(indices.length)s.metadata.constraints={schema:'molecule-fixed-atoms/1',enabled:true,fixedAtomIds:indices.map(i=>s.atoms[i].id)};return s;}
  function collect(list,s){if(list.length>=200||list.reduce((n,f)=>n+f.atoms.length,0)+s.atoms.length>100000)throw Error('読み込みは200構造・合計100000原子までです。');list.push(s);}
  function finish(list){
    if(!list.length)throw Error('対応する座標ブロックが見つかりません。');
    const first=list[0],signature=s=>s.atoms.map(a=>a.element).join(','),same=list.every(s=>signature(s)===signature(first));
    // File-order correspondence only; never guess a permutation or align geometries.
    if(same)for(const s of list.slice(1)){const ids=new Map(s.atoms.map((a,i)=>[a.id,first.atoms[i].id]));s.atoms.forEach((a,i)=>a.id=first.atoms[i].id);s.bonds.forEach(b=>{b.atom1=ids.get(b.atom1);b.atom2=ids.get(b.atom2);});if(s.metadata.constraints)s.metadata.constraints.fixedAtomIds=s.metadata.constraints.fixedAtomIds.map(id=>ids.get(id));}
    const warnings=[...new Set(list.flatMap(s=>s.metadata.importWarnings||[]))];
    if(!same)warnings.push('構造間で原子数・元素順序が異なります。経路計算には原子の対応が必要です。');
    first.metadata.importWarnings=warnings;return F.frames(list);
  }
  function geometry(rows,title,format,scale=1,metadata={},freeze=false){
    const atoms=[],tv=[],fixed=[];
    for(const line of rows){if(!line.trim()||/^\s*[!#]/.test(line))continue;const r=cartRow(line,scale,freeze);if(r.vector)tv.push(r.vector);else {if(r.fixed)fixed.push(atoms.length);atoms.push(r.atom);}if(atoms.length>2000)throw Error('2000原子を超えています。');}
    if(tv.length&&tv.length!==3)throw Error('TV格子ベクトルは3本必要です。');
    return fixedMetadata(state(atoms,title,format,{...metadata,...(tv.length?{cell:P.cell(tv)}:{})}),fixed);
  }
  const inputWarning='座標・電荷・多重度を読み込みました。計算手法やキーワードは実行・設定しません。';
  const cm=line=>/^[+-]?\d+\s+[+]?\d+(?:\s+[+-]?\d+\s+[+]?\d+)*$/.test(line.trim());
  function electronic(line){const p=tokens(line).map(num);for(let i=1;i<p.length;i+=2)if(p[i]<1)throw Error('スピン多重度は正の整数が必要です。');return {totalCharge:p[0],multiplicity:p[1],...(p.length>2?{importElectronicStates:Array.from({length:p.length/2},(_,i)=>p.slice(i*2,i*2+2))}:{})};}
  function grrm(text){
    const lines=text.split('\n'),starts=[];
    for(let i=0;i<lines.length;i++)if(/^\s*#/.test(lines[i])){let j=i+1;while(j<lines.length&&!lines[j].trim())j++;if(cm(lines[j]||''))starts.push(i);}
    if(!starts.length)throw Error('GRRMのルート行と電荷・多重度行が見つかりません。');
    const all=[];
    starts.forEach((start,k)=>{
      const block=lines.slice(start,starts[k+1]??lines.length);let i=1;while(!block[i]?.trim())i++;
      const meta=electronic(block[i++]),parts=[{name:'Initial',rows:[],external:[]}],frozen=[];let part=parts[0],mode='normal',external=false;
      for(;i<block.length;i++){
        const l=block[i].trim();if(/^Options\b/i.test(l))break;
        if(!l||/^%/.test(l))continue;
        if(/^(Reactant|Product)\s*$/i.test(l)){part={name:l,rows:[],external:[]};parts.push(part);mode='normal';external=false;continue;}
        if(/^External\s*Atoms\s*$/i.test(l)){external=true;continue;}
        if(/^Frozen\s*Atoms\s*$/i.test(l)){mode='frozen';continue;}
        if(/^(?:--|#\s*NODE\s+\d+)\s*$/i.test(l)){part={name:'Structure '+(parts.length+1),rows:[],external:[]};parts.push(part);mode='normal';external=false;continue;}
        if(/^#/.test(l))continue;
        if(mode==='frozen')frozen.push(l);else {if(external)part.external.push(part.rows.length);part.rows.push(l);}
      }
      const warnings=[inputWarning];if(/^\s*%infile\s*=/im.test(text))warnings.push('%infileの参照先は自動で開きません。この.com内の入力座標を表示しています。経路は参照先.logを別途開いてください。');
      if(/ReadCommonGeometry/i.test(block.slice(i).join('\n')))warnings.push('Options内のReadCommonGeometryは追加していません。入力座標との二重登録を防いでいます。');
      if(meta.importElectronicStates)warnings.push('複数電子状態のうち先頭の電荷・多重度を表示しています。');
      const shared=frozen.filter(l=>!/^TV\b/i.test(l)).length;
      for(const p of parts){
        const s=geometry([...p.rows,...frozen],'GRRM '+p.name,'grrm',1,{...meta,importWarnings:[...warnings],importSection:p.name});
        if(shared){const fixed=Array.from({length:shared},(_,j)=>s.atoms.length-shared+j);fixedMetadata(s,fixed);s.metadata.importWarnings.push('Frozen Atomsを全構造に追加し、原子固定を有効にしました。');}
        if(p.external.length){s.metadata.grrmExternalAtoms=p.external;s.metadata.importWarnings.push('External Atomsを含めて表示します。GRRMのmicroiteration設定は適用しません。');}
        collect(all,s);
      }
    });return finish(all);
  }
  function gaussian(text){
    const all=[];
    for(const block of text.split(/^\s*--Link1--\s*$/mi)){
      if(!block.trim())continue;const lines=block.split('\n');let i=lines.findIndex(l=>/^\s*#/.test(l));if(i<0)throw Error('Gaussianのルート行が見つかりません。');
      let route='';while(i<lines.length&&lines[i].trim())route+=lines[i++]+' ';
      if(/\bgeom\s*=\s*(?:\([^)]*)?(?:allcheck|check|checkpoint)\b/i.test(route))throw Error('Geom=Check/AllCheckの座標は.chk内にあります。FCHKまたはXYZへ変換してください。');
      while(i<lines.length&&!lines[i].trim())i++;const title=[];while(i<lines.length&&lines[i].trim())title.push(lines[i++]);
      while(i<lines.length&&!lines[i].trim())i++;if(!cm(lines[i]||''))throw Error('Gaussianの電荷・多重度行を確認してください。');
      const meta=electronic(lines[i++]),rows=[];while(i<lines.length&&lines[i].trim())rows.push(lines[i++]);
      const scale=/units\s*=\s*(?:\(\s*)?(?:au|bohr)/i.test(route)?BOHR:1;
      collect(all,geometry(rows,title.join(' '),'gaussian',scale,{...meta,importWarnings:[inputWarning]},true));
    }return finish(all);
  }
  function orca(text,options={}){
    const all=[];
    for(const block of text.split(/^\s*\$new_job\b.*$/mi)){
      if(!block.trim())continue;
      const scale=/(?:^\s*!\s*.*\bBOHRS\b|^\s*Units\s+Bohrs?\b)/im.test(block)?BOHR:1;
      const ext=block.match(/^\s*\*\s*xyzfile\s+([+-]?\d+)\s+(\d+)\s+(.+?)\s*$/im);
      if(ext){
        const name=ext[3].replace(/^["']|["']$/g,''),key=name.replace(/\\/g,'/').split('/').pop().toLowerCase(),record=options.files?.get(key);
        if(!record)throw Error('ORCAの参照XYZ「'+name+'」も入力ファイルと一緒に選択・ドロップしてください。');
        options.used?.add(key);const s=IO.parseXYZToState(record.text),list=s.metadata.trajectory||[s];
        for(const f of list)collect(all,M.createState({...f,metadata:{...f.metadata,sourceFormat:'orca',...electronic(ext[1]+' '+ext[2]),importWarnings:[inputWarning],sourceFile:options.filename,referencedFile:record.name}}));
        continue;
      }
      const simple=block.match(/^\s*\*\s*xyz\s+([+-]?\d+)\s+(\d+)\s*\n([\s\S]*?)^\s*\*\s*$/im);
      if(simple){collect(all,geometry(simple[3].split('\n'),'ORCA','orca',scale,{...electronic(simple[1]+' '+simple[2]),importWarnings:[inputWarning]}));continue;}
      const header=block.match(/^\s*%coords\b([\s\S]*)/im),body=header?.[1].match(/^\s*coords\s*\n([\s\S]*?)^\s*end\b/im);
      if(!body||!/\bCTyp\s+xyz\b/i.test(header[1]))throw Error('ORCAは* xyz / xyzfileまたは%coordsのCTyp xyzに対応します。内部座標はXYZへ変換してください。');
      const charge=header[1].match(/^\s*Charge\s+([+-]?\d+)/im)?.[1],mult=header[1].match(/^\s*Mult\s+(\d+)/im)?.[1];
      if(charge==null||mult==null)throw Error('ORCA %coordsにChargeとMultを指定してください。');
      collect(all,geometry(body[1].split('\n'),'ORCA','orca',scale,{...electronic(charge+' '+mult),importWarnings:[inputWarning]}));
    }return finish(all);
  }

  function grrmLog(text){
    const lines=text.split('\n'),all=[];let label='',rows=null;
    const flush=()=>{if(rows?.length)collect(all,geometry(rows,label,'grrm-log',1,{importWarnings:['ログから座標を抽出しました。エネルギー・勾配・収束判定は取り込みません。']}));rows=null;};
    for(const line of lines){
      if(/^\s*#\s*(?:Geometry\s+of\b|NODE\b|ITR[.\s]|STEP\b)/i.test(line)){flush();label=line.trim().replace(/^#\s*/,'');rows=[];continue;}
      if(rows!==null){
        if(/^\s*(?:[A-Za-z]{1,2}|\d+)\s/.test(line)){
          // Atom-like lines must validate, including unknown/ghost elements.
          cartRow(line);rows.push(line);continue;
        }
        if(rows.length)flush();else if(line.trim()&&!/^(?:-+|\s*SYMMETRY)/i.test(line))rows=null;
      }
    }flush();return finish(all);
  }
  function gaussianLog(text){
    const lines=text.split('\n'),all=[],preferred=/^\s*Standard orientation:\s*$/m.test(text)?'Standard':/^\s*Input orientation:\s*$/m.test(text)?'Input':'Z-Matrix';
    let meta={},lastLabel='';
    for(let i=0;i<lines.length;i++){
      const charge=lines[i].match(/Charge\s*=\s*([+-]?\d+)\s+Multiplicity\s*=\s*(\d+)/);if(charge)meta=electronic(charge[1]+' '+charge[2]);
      if(lines[i].trim()!==preferred+' orientation:')continue;
      lastLabel=preferred+' orientation';let j=i+1,bars=0;
      while(j<lines.length&&j<i+12&&bars<2){if(/^\s*-{3,}\s*$/.test(lines[j]))bars++;j++;}
      if(bars!==2)throw Error('Gaussian座標表の見出しが不完全です。');
      const rows=[],tv=[];let closed=false;
      for(;j<lines.length;j++){const l=lines[j];if(/^\s*-{3,}\s*$/.test(l)){closed=true;break;}const p=tokens(l);if(p.length!==6)break;integer(p[0],1,2003);if(p[1]==='-2')tv.push(p.slice(3).map(num));else rows.push(atom(p[1],p.slice(3)));if(rows.length>2000)throw Error('2000原子を超えています。');}
      if(!closed){if(all.length){all[0].metadata.importWarnings.push('末尾の不完全な座標表を除外しました。');break;}throw Error('Gaussian座標表が途中で切れています。');}
      if(tv.length&&tv.length!==3)throw Error('Gaussianの1次元・2次元周期セルには未対応です。');
      collect(all,state(rows,lastLabel+' '+(all.length+1),'gaussian-log',{...meta,...(tv.length?{cell:P.cell(tv)}:{}),importWarnings:['ログの'+preferred+' orientation座標を順番に読み込みました。計算結果の収束は判定しません。']}));i=j;
    }return finish(all);
  }
  function orcaLog(text){
    const lines=text.split('\n'),all=[],angs=/CARTESIAN COORDINATES\s*\(ANGSTROE?M\)/i.test(text),marker=angs?/CARTESIAN COORDINATES\s*\(ANGSTROE?M\)/i:/CARTESIAN COORDINATES\s*\(A\.U\.\)/i;
    for(let i=0;i<lines.length;i++)if(marker.test(lines[i])){
      let j=i+1;while(j<lines.length&&(!lines[j].trim()||/^\s*-+\s*$/.test(lines[j])||/^\s*NO\s+LB/i.test(lines[j])))j++;
      const atoms=[];for(;j<lines.length&&lines[j].trim()&&!/^\s*-+\s*$/.test(lines[j]);j++){
        const p=tokens(lines[j]);if(angs){if(p.length!==4)throw Error('ORCA座標表の行が不正です。');atoms.push(atom(p[0],p.slice(1)));}
        else {if(p.length!==8)throw Error('ORCA原子単位座標表の行が不正です。');atoms.push(atom(p[1],p.slice(5),BOHR));}
        if(atoms.length>2000)throw Error('2000原子を超えています。');
      }
      collect(all,state(atoms,'ORCA geometry '+(all.length+1),'orca-log',{importWarnings:['ログのCartesian座標を読み込みました。収束状態や電荷・多重度は計算前に確認してください。']}));i=j;
    }return finish(all);
  }
  function rrm(text){
    const lines=text.split('\n'),i=lines.findIndex(l=>/NACTIVEATOM\s*\/\s*NATOM\s*:/i.test(l));if(i<0)throw Error('INP4GEN.rrmの原子数見出しが見つかりません。');
    const n=integer(lines[i].match(/\/\s*(\d+)\s*$/)?.[1],1),at=i+1+n,m=integer(lines[at]?.match(/NFROZENATOM\s*:\s*(\d+)/i)?.[1]);
    if(lines.slice(at+1,at+1+m).filter(l=>l.trim()).length!==m)throw Error('INP4GENのFrozen Atomsが不足しています。');
    const s=geometry(lines.slice(i+1,at).concat(lines.slice(at+1,at+1+m)),'GRRM INP4GEN','grrm-rrm');
    if(s.atoms.length!==n+m)throw Error('INP4GENの原子数が一致しません。');
    fixedMetadata(s,Array.from({length:m},(_,k)=>n+k));return s;
  }
  function turbomole(text){
    const lines=text.split('\n'),i=lines.findIndex(l=>/^\s*\$coord\b/i.test(l));if(i<0)throw Error('$coordが見つかりません。');
    if(/\bfrac\b/i.test(lines[i]))throw Error('$coord fracは未対応です。Cartesian形式へ変換してください。');
    const scale=/\bangs\b/i.test(lines[i])?1:BOHR,atoms=[],fixed=[];
    let j=i+1;for(;j<lines.length&&!/^\s*\$/.test(lines[j]);j++){if(!lines[j].trim()||/^\s*#/.test(lines[j]))continue;const p=tokens(lines[j]);if(p.length<4||p.length>5||(p[4]&&p[4]!=='f'))throw Error('$coordの原子行が不正です。');if(p[4]==='f')fixed.push(atoms.length);atoms.push(atom(p[3],p.slice(0,3),scale));}
    if(j===lines.length)throw Error('$coordの終端（$endなど）がありません。');return fixedMetadata(state(atoms,'TURBOMOLE','turbomole'),fixed);
  }
  function qchem(text){
    const all=[];
    for(const block of text.split(/^\s*@@@\s*$/m)){
      const m=block.match(/^\s*\$molecule\s*\n([\s\S]*?)^\s*\$end\b/im);if(!m)throw Error('Q-Chem $moleculeブロックがありません。');
      const lines=m[1].split('\n').map(l=>l.split('!')[0].trim()).filter(Boolean);if(!cm(lines[0]||''))throw Error('Q-Chemのread指定・Z-matrixはXYZへ変換してください。');
      const meta=electronic(lines.shift()),rows=[];
      for(let i=0;i<lines.length;i++){if(lines[i]==='--'){if(!cm(lines[++i]||''))throw Error('Q-Chemのfragment電荷・多重度が不正です。');continue;}rows.push(lines[i]);}
      const scale=/^\s*INPUT_BOHR\s*(?:=\s*)?TRUE\b/im.test(block)?BOHR:1;
      collect(all,geometry(rows,'Q-Chem','qchem',scale,{...meta,importWarnings:[inputWarning]}));
    }return finish(all);
  }
  function nwchem(text){
    const all=[];for(const m of text.matchAll(/^\s*geometry\b([^\n]*)\n([\s\S]*?)^\s*end\s*$/gmi)){
      const args=m[1],scale=/\b(?:au|bohr|atomic)\b/i.test(args)?BOHR:1;
      if(/\bunits\b/i.test(args)&&!/\b(?:au|bohr|atomic|angstroms?)\b/i.test(args))throw Error('NWChemの座標単位が未対応です。');
      collect(all,geometry(m[2].split('\n'),'NWChem','nwchem',scale,{importWarnings:['geometry内のCartesian座標を読み込みました。対称性展開・計算条件は適用しません。']}));
    }return finish(all);
  }
  function gamess(text){
    const all=[];for(const m of text.matchAll(/^\s*\$DATA\s*\n([\s\S]*?)^\s*\$END\b/gmi)){
      const l=m[1].split('\n');if(l[1]?.trim().toUpperCase()!=='C1')throw Error('GAMESSは全原子を明示したC1座標に対応します。対称性を展開して保存してください。');
      const scale=/\bUNITS\s*=\s*BOHR\b/i.test(text)?BOHR:1,atoms=[];
      for(const row of l.slice(2).filter(x=>x.trim())){const p=tokens(row);if(p.length!==5)throw Error('GAMESS $DATAは原子名・原子番号・X Y Zの5列が必要です。');atoms.push(atom(String(integer(p[1],1,118)),p.slice(2),scale));}
      const q=text.match(/\bICHARG\s*=\s*([+-]?\d+)/i)?.[1]||'0',mult=text.match(/\bMULT\s*=\s*(\d+)/i)?.[1]||'1';
      collect(all,state(atoms,l[0],'gamess',{...electronic(q+' '+mult),importWarnings:[inputWarning]}));
    }return finish(all);
  }
  function molden(text){
    const lines=text.split('\n'),geom=lines.findIndex(l=>/^\s*\[GEOMETRIES\]\s*XYZ\s*$/i.test(l));
    if(geom>=0){let end=geom+1;while(end<lines.length&&!/^\s*\[/.test(lines[end]))end++;const s=IO.parseXYZToState(lines.slice(geom+1,end).join('\n'));const list=(s.metadata.trajectory||[s]).map(f=>M.createState({...f,metadata:{...f.metadata,sourceFormat:'molden'}}));return finish(list);}
    const vibration=lines.findIndex(l=>/^\s*\[FR-COORD\]\s*$/i.test(l)),i=lines.findIndex(l=>/^\s*\[Atoms\]/i.test(l));
    if(i<0&&vibration>=0){let end=vibration+1;while(end<lines.length&&!/^\s*\[/.test(lines[end]))end++;return geometry(lines.slice(vibration+1,end),'Molden vibration geometry','molden',BOHR,{importWarnings:['FR-COORDの原子座標のみ読み込みました。振動モードは取り込みません。']});}
    if(i>=0){
      const units=lines[i].replace(/^\s*\[Atoms\]\s*/i,'').replace(/[()]/g,'').trim(),scale=/^AU$/i.test(units)?BOHR:/^Angs?$/i.test(units)?1:null;if(scale===null)throw Error('Molden [Atoms]のAU/Angs単位を確認してください。');
      const atoms=[];for(let j=i+1;j<lines.length&&!/^\s*\[/.test(lines[j]);j++){if(!lines[j].trim())continue;const p=tokens(lines[j]);if(p.length!==6)throw Error('Molden原子行が不正です。');const a=atom(p[2],p.slice(3),scale);if(symbol(p[0])!==a.element)throw Error('Moldenの元素名と原子番号が一致しません。');atoms.push(a);}return state(atoms,'Molden','molden');
    }
    throw Error('Molden [Atoms] / [GEOMETRIES] XYZ / [FR-COORD] がありません。');
  }
  function fchk(text){
    const lines=text.split('\n');
    function array(name){const i=lines.findIndex(l=>l.startsWith(name)&&/\bN=\s*\d+/.test(l));if(i<0)throw Error('FCHKに'+name+'がありません。');const n=integer(lines[i].match(/N=\s*(\d+)/)[1],1,6000),a=[];for(let j=i+1;j<lines.length&&a.length<n;j++)for(const t of tokens(lines[j]))a.push(num(t));if(a.length!==n)throw Error('FCHK配列が不完全です: '+name);return a;}
    const z=array('Atomic numbers'),p=array('Current cartesian coordinates');if(p.length!==3*z.length)throw Error('FCHKの原子数と座標数が一致しません。');
    const s=state(z.map((v,i)=>atom(String(v),p.slice(3*i,3*i+3),BOHR)),lines[0],'fchk');
    for(const [label,key] of [['Charge','totalCharge'],['Multiplicity','multiplicity']]){const l=lines.find(x=>new RegExp('^'+label+'\\s+I\\s+[+-]?\\d+\\s*$').test(x));if(l)s.metadata[key]=num(tokens(l).at(-1));}return s;
  }
  function cube(text){
    const lines=text.split('\n'),origin=tokens(lines[2]||''),count=Math.abs(num(origin[0])),axes=lines.slice(3,6).map(tokens);
    integer(String(count),1);if(origin.length<4||axes.length!==3||axes.some(p=>p.length!==4))throw Error('CUBEの見出しが不正です。');
    origin.slice(1,4).forEach(num);const signs=axes.map(p=>Math.sign(num(p[0])));if(signs.some(s=>s===0||s!==signs[0]))throw Error('CUBEの格子数・単位指定が不正です。');
    axes.forEach(p=>p.slice(1).forEach(num));const scale=signs[0]<0?1:BOHR,atoms=lines.slice(6,6+count).map(l=>{const p=tokens(l);if(p.length!==5)throw Error('CUBE原子行が不正です。');num(p[1]);return atom(p[0],p.slice(2),scale);});if(atoms.length!==count)throw Error('CUBEの原子数が一致しません。');
    return state(atoms,lines[0],'cube',{importWarnings:['CUBEの原子座標のみ読み込みました。密度・軌道の格子データは表示しません。']});
  }

  function gro(text){
    const lines=text.split('\n'),all=[];let i=0;
    while(i<lines.length){
      while(i<lines.length&&!lines[i].trim())i++;if(i===lines.length)break;
      const title=lines[i++],n=integer(lines[i++],1),atoms=[];
      for(let k=0;k<n;k++){
        const l=lines[i++];if(!l||l.length<44)throw Error('GROの座標行が短すぎます。');
        const name=l.slice(10,15).trim().replace(/^\d+/,''),raw=/^(?:Cl|Br|Na|Mg|Ca|Fe|Zn|Cu|Si|Al)/.exec(name)?.[0]||name[0];
        const decimals=[...l.slice(20).matchAll(/\./g)].map(m=>m.index),width=decimals.length>=2?decimals[1]-decimals[0]:8;
        if(width<5)throw Error('GRO座標の桁幅が不正です。');
        atoms.push(atom(raw,[0,1,2].map(j=>l.slice(20+j*width,20+(j+1)*width).trim()),10));
      }
      const box=tokens(lines[i++]||'').map(num);if(![3,9].includes(box.length))throw Error('GROのboxは3または9成分必要です。');
      const v=box.length===3?[[box[0],0,0],[0,box[1],0],[0,0,box[2]]]:[[box[0],box[3],box[4]],[box[5],box[1],box[6]],[box[7],box[8],box[2]]];
      collect(all,state(atoms,title,'gro',{cell:box.every(x=>x===0)?null:P.cell(v.map(row=>row.map(x=>10*x))),importWarnings:['GROのnmをÅへ変換しました。元素は原子名から推定しています（CAなどの曖昧な名前は確認してください）。速度は読み込みません。']}));
    }return finish(all);
  }
  function pdbqt(text){
    const types={A:'C',C:'C',N:'N',NA:'N',NS:'N',O:'O',OA:'O',OS:'O',S:'S',SA:'S',H:'H',HD:'H',HS:'H',F:'F',Cl:'Cl',CL:'Cl',Br:'Br',BR:'Br',I:'I',P:'P',Mg:'Mg',MG:'Mg',Mn:'Mn',MN:'Mn',Zn:'Zn',ZN:'Zn',Ca:'Ca',CA:'Ca',Fe:'Fe',FE:'Fe'};
    const all=[];let atoms=[];
    const flush=()=>{if(atoms.length){collect(all,state(atoms,'PDBQT '+(all.length+1),'pdbqt',{importWarnings:['PDBQTのAutoDock原子型と部分電荷を読み込みました。結合は距離から推定します。']}));atoms=[];}};
    for(const l of text.split('\n')){
      if(/^(?:MODEL |ENDMDL)/.test(l)){flush();continue;}if(!/^(?:ATOM  |HETATM)/.test(l))continue;
      const t=l.slice(77).trim().split(/\s+/)[0],e=types[t];if(!e)throw Error('未知のAutoDock原子型です: '+t);
      const a=atom(e,[l.slice(30,38).trim(),l.slice(38,46).trim(),l.slice(46,54).trim()]);a.xyzExtras={partial_charge:{type:'R',values:[String(num(l.slice(70,76).trim()))]}};atoms.push(a);if(atoms.length>2000)throw Error('2000原子を超えています。');
    }flush();return finish(all);
  }
  function gen(text){
    const lines=text.split('\n').map(l=>l.split('#')[0].trim()).filter(Boolean),head=tokens(lines[0]),n=integer(head[0],1),type=head[1]?.toUpperCase(),species=tokens(lines[1]);
    if(!['C','S','F'].includes(type))throw Error('GENの形式はC/S/Fが必要です。');
    const rows=lines.slice(2,2+n).map(tokens);if(rows.length!==n)throw Error('GENの原子行が不足しています。');
    let c=null,origin=[0,0,0];if(type!=='C'){origin=tokens(lines[2+n]||'').map(num);if(origin.length!==3||origin.some(x=>x!==0))throw Error('GENは原点0 0 0のセルに対応します。非ゼロ原点は座標に反映して保存してください。');const v=lines.slice(3+n,6+n).map(l=>tokens(l).map(num));c=P.cell(v);}
    const atoms=rows.map((p,i)=>{if(p.length!==5||integer(p[0],1)!==i+1)throw Error('GENの原子番号・列数が不正です。');const e=species[integer(p[1],1,species.length)-1],pos=p.slice(2).map(num);return atom(e,type==='F'?P.cartesian(pos,c).map((x,j)=>x+origin[j]):pos);});
    return state(atoms,'DFTB GEN','gen',{cell:c});
  }
  function xdatcar(text){
    const lines=text.trim().split('\n'),first=lines.findIndex(l=>/^\s*(?:Direct|Cartesian)\s+configuration\s*=/i.test(l));if(first<0)throw Error('XDATCARのconfiguration見出しがありません。');
    if(first!==7)throw Error('元素名を明示したVASP5形式のXDATCARに対応します。');
    const counts=tokens(lines[6]).map(x=>integer(x)),n=counts.reduce((a,b)=>a+b,0);integer(String(n),1);
    const all=[];let i=first;
    while(i<lines.length){if(!lines[i].trim()){i++;continue;}if(!/^\s*(?:Direct|Cartesian)\s+configuration\s*=/i.test(lines[i]))throw Error('XDATCARのフレーム区切りが不正です。');
      const label=lines[i],mode=/^\s*Direct/i.test(label)?'Direct':'Cartesian',body=lines.slice(i+1,i+1+n);if(body.length!==n)throw Error('XDATCARの末尾フレームが不完全です。');
      const s=P.parsePOSCAR([...lines.slice(0,7),mode,...body].join('\n'));s.metadata.sourceFormat='xdatcar';s.metadata.title=label.trim();collect(all,s);i+=n+1;
    }return finish(all);
  }
  function siesta(text){
    if(/^\s*%include\b|^\s*%block[^\n]*</im.test(text))throw Error('SIESTAの外部includeは展開してから読み込んでください。');
    const stripped=text.split('\n').map(l=>l.split('#')[0]).join('\n'),blocks=new Map();
    const key=s=>s.toLowerCase().replace(/[_.\s-]/g,'');
    for(const m of stripped.matchAll(/^\s*%block\s+(\S+)\s*\n([\s\S]*?)^\s*%endblock[^\n]*$/gmi))blocks.set(key(m[1]),m[2].split('\n').map(tokens).filter(p=>p.length));
    const value=name=>{const l=stripped.split('\n').find(l=>key(tokens(l)[0]||'')===name);return l?tokens(l).slice(1):null;};
    const species=new Map((blocks.get('chemicalspecieslabel')||[]).map(p=>[p[0],IO.ELEMENTS[integer(p[1],1,118)-1]])),rows=blocks.get('atomiccoordinatesandatomicspecies');
    if(!rows||!species.size)throw Error('SIESTAのChemicalSpeciesLabelとAtomicCoordinatesAndAtomicSpeciesが必要です。');
    const lattice=value('latticeconstant')||['1','Ang'],unit=lattice[1]||'Bohr';if(!/^(?:Ang|Angstrom|Bohr)$/i.test(unit))throw Error('SIESTA LatticeConstantの単位が未対応です。');
    const scale=num(lattice[0])*(/^bohr$/i.test(unit)?BOHR:1);if(scale<=0)throw Error('LatticeConstantは正の値が必要です。');
    const vectors=blocks.get('latticevectors'),params=blocks.get('latticeparameters');let c=null;
    if(vectors)c=P.cell(vectors.map(v=>v.map(x=>num(x)*scale)));
    else if(params){const p=params.flat().map(num);if(p.length!==6)throw Error('SIESTA格子定数は6成分必要です。');c=F.cellParameters(...p.map((x,i)=>i<3?x*scale:x));}
    const format=(value('atomiccoordinatesformat')?.[0]||'Bohr').toLowerCase(),frac=['fractional','scaledbylatticevectors'].includes(format),coordinateScale=['bohr','notscaledcartesianbohr'].includes(format)?BOHR:format==='scaledcartesian'?scale:['ang','angstrom','notscaledcartesianang'].includes(format)?1:null;
    if(frac&&!c)throw Error('SIESTA分率座標には格子が必要です。');if(!frac&&coordinateScale===null)throw Error('SIESTAの座標形式が未対応です: '+format);
    if(blocks.has('atomiccoordinatesorigin'))throw Error('AtomicCoordinatesOriginを座標に反映してから読み込んでください。');
    const atoms=rows.map(p=>{if(p.length<4)throw Error('SIESTA座標行が不正です。');const e=species.get(p[3]);if(!e)throw Error('SIESTAのspecies番号が未定義です。');const v=p.slice(0,3).map(num);return atom(e,frac?P.cartesian(v,c):v,frac?1:coordinateScale);});
    const expected=value('numberofatoms');if(expected&&integer(expected[0],1)!==atoms.length)throw Error('SIESTAのNumberOfAtomsと座標数が一致しません。');
    return state(atoms,value('systemlabel')?.join(' ')||'SIESTA','siesta',{cell:c,importWarnings:['構造・セルを読み込みました。擬ポテンシャルや計算条件は適用しません。']});
  }
  function siestaXV(text,struct=false){
    const l=text.trim().split('\n'),scale=struct?1:BOHR,c=P.cell(l.slice(0,3).map(row=>tokens(row).slice(0,3).map(x=>num(x)*scale))),n=integer(l[3],1),rows=l.slice(4);
    if(rows.length!==n)throw Error('SIESTAの原子数と座標行数が一致しません。');
    const atoms=rows.map(l=>{const p=tokens(l);if(p.length!==(struct?5:8))throw Error('SIESTA XV/STRUCT_OUTの原子行が不正です。');return atom(p[1],struct?P.cartesian(p.slice(2,5).map(num),c):p.slice(2,5),scale);});
    return state(atoms,'SIESTA '+(struct?'STRUCT_OUT':'XV'),struct?'siesta-struct':'siesta-xv',{cell:c});
  }
  function espresso(text){
    const lines=text.split('\n').map(l=>l.split('!')[0]),nat=integer(text.match(/\bnat\s*=\s*(\d+)/i)?.[1],1),ibrav=num(text.match(/\bibrav\s*=\s*([+-]?\d+)/i)?.[1]||'0');
    if(ibrav!==0)throw Error('Quantum ESPRESSOはibrav=0と明示的なCELL_PARAMETERSに対応します。');
    const alatRaw=text.match(/\bcelldm\s*\(\s*1\s*\)\s*=\s*([+\-\d.eEdD]+)/i)?.[1],aRaw=text.match(/(?:^|[,\s])A\s*=\s*([+\-\d.eEdD]+)/im)?.[1],alat=alatRaw?num(alatRaw)*BOHR:aRaw?num(aRaw):null;
    const scale=unit=>{if(unit==='angstrom')return 1;if(unit==='bohr')return BOHR;if(unit==='alat'&&alat>0)return alat;throw Error('QEの単位 '+unit+' に必要な格子定数がありません。');};
    const units=l=>l.replace(/^\s*\S+\s*/,'').replace(/[(){}]/g,'').trim().toLowerCase()||'alat';
    const ci=lines.findIndex(l=>/^\s*CELL_PARAMETERS\b/i.test(l));if(ci<0)throw Error('QEのCELL_PARAMETERSが必要です。');
    if(lines.filter(l=>/^\s*CELL_PARAMETERS\b/i.test(l)).length!==1)throw Error('QEの可変セル出力は未対応です。各構造をXYZまたはPOSCARへ変換してください。');
    const c=P.cell(lines.slice(ci+1,ci+4).map(l=>tokens(l).map(x=>num(x)*scale(units(lines[ci]))))),all=[];
    for(let i=0;i<lines.length;i++)if(/^\s*ATOMIC_POSITIONS\b/i.test(lines[i])){
      const unit=units(lines[i]);if(!['angstrom','bohr','alat','crystal'].includes(unit))throw Error('QEのATOMIC_POSITIONS単位が未対応です。');
      const atoms=lines.slice(i+1,i+1+nat).map(l=>{const p=tokens(l);if(![4,7].includes(p.length))throw Error('QE原子行の列数が不正です。');const a=atom(p[0],unit==='crystal'?P.cartesian(p.slice(1,4).map(num),c):p.slice(1,4),unit==='crystal'?1:scale(unit));if(p.length===7){if(p.slice(4).some(x=>!['0','1'].includes(x)))throw Error('QEの固定フラグが不正です。');a.selective=p.slice(4).map(x=>x==='1'?'T':'F');}return a;});
      if(atoms.length!==nat)throw Error('QEの原子行が不足しています。');collect(all,state(atoms,'Quantum ESPRESSO','espresso',{cell:c,importWarnings:['座標・セル・移動可否フラグを読み込みました。計算条件は適用しません。']}));i+=nat;
    }return finish(all);
  }

  function xsf(text){
    const lines=text.split('\n'),all=[];let c=null;
    if(/^\s*(?:SLAB|POLYMER)\s*$/im.test(text))throw Error('XSFのSLAB/POLYMERは未対応です。3次元CRYSTALまたは分子を指定してください。');
    for(let i=0;i<lines.length;i++){
      if(/^\s*PRIMVEC(?:\s+\d+)?\s*$/i.test(lines[i])){c=P.cell(lines.slice(i+1,i+4).map(l=>tokens(l).map(num)));i+=3;}
      else if(/^\s*PRIMCOORD(?:\s+\d+)?\s*$/i.test(lines[i])){
        const h=tokens(lines[++i]),n=integer(h[0],1);if(h[1]!=='1'||!c)throw Error('XSFのPRIMCOORDにはPRIMVECと「原子数 1」が必要です。');
        const atoms=lines.slice(i+1,i+1+n).map(l=>{const p=tokens(l);if(![4,7].includes(p.length))throw Error('XSF座標行が不正です。');return atom(p[0],p.slice(1,4));});
        if(atoms.length!==n)throw Error('XSFの原子行が不足しています。');collect(all,state(atoms,'XSF '+(all.length+1),'xsf',{cell:c}));i+=n;
      }else if(/^\s*ATOMS(?:\s+\d+)?\s*$/i.test(lines[i])){
        const atoms=[];let j=i+1;for(;j<lines.length;j++){
          if(!lines[j].trim()||/^\s*#/.test(lines[j]))continue;const p=tokens(lines[j]);
          if(!/^(?:\d+|[A-Za-z]{1,2})$/.test(p[0]))break;
          if(![4,7].includes(p.length))throw Error('XSF座標行が不正です。');atoms.push(atom(p[0],p.slice(1,4)));
          if(atoms.length>2000)throw Error('2000原子を超えています。');
        }collect(all,state(atoms,'XSF '+(all.length+1),'xsf'));i=j-1;
      }
    }return finish(all);
  }
  function aims(text){
    const atoms=[],v=[];let fractional=false,cartesian=false;
    for(const l of text.split('\n')){const p=tokens(l.split('#')[0]);if(!p.length)continue;
      if(p[0]==='lattice_vector'){if(p.length!==4)throw Error('lattice_vectorは3成分必要です。');v.push(p.slice(1).map(num));}
      else if(['atom','atom_frac'].includes(p[0])){if(p.length!==5)throw Error('FHI-aims原子行が不正です。');fractional||=p[0]==='atom_frac';cartesian||=p[0]==='atom';atoms.push(atom(p[4],p.slice(1,4)));}
      else if(['constrain_relaxation','initial_moment','initial_charge'].includes(p[0]))continue;
      else throw Error('geometry.inの未対応行です: '+p[0]);
    }
    const c=v.length?P.cell(v):null;if(fractional&&(!c||cartesian))throw Error('atom_fracには3本の格子が必要です。atomとの混在は未対応です。');
    if(fractional)atoms.forEach(a=>[a.x,a.y,a.z]=P.cartesian([a.x,a.y,a.z],c));
    return state(atoms,'FHI-aims','aims',{cell:c,importWarnings:['座標とセルを読み込みました。constrain_relaxation・初期電荷・磁気モーメントは適用しません。']});
  }
  const readers={grrm,gaussian,orca,'grrm-log':grrmLog,'gaussian-log':gaussianLog,'orca-log':orcaLog,'grrm-rrm':rrm,turbomole,qchem,nwchem,gamess,molden,fchk,cube,gro,pdbqt,gen,xdatcar,siesta,'siesta-xv':t=>siestaXV(t),'siesta-struct':t=>siestaXV(t,true),espresso,xsf,aims};
  const hints={xyz:'xyz',extxyz:'xyz',mol:'mol',sdf:'sdf',sd:'sdf',cif:'cif',pdb:'pdb',ent:'pdb',mol2:'mol2',gjf:'gaussian',gau:'gaussian',fchk:'fchk',fch:'fchk',cube:'cube',cub:'cube',gro:'gro',pdbqt:'pdbqt',gen:'gen',fdf:'siesta',xv:'siesta-xv',struct_out:'siesta-struct',struct_in:'siesta-struct',molden:'molden',mld:'molden',rrm:'grrm-rrm',xsf:'xsf',axsf:'xsf',json:'json',vasp:'poscar',coord:'turbomole'};
  function detect(text,filename=''){
    text=clean(text);const name=filename.replace(/\\/g,'/').split('/').pop().toLowerCase(),ext=name.split('.').pop();
    // Distinctive content wins over ambiguous extensions (.com/.inp/.in/.log/.out).
    if(text.trimStart().startsWith('{'))return 'json';
    if(/^\s*(?:Standard|Input|Z-Matrix) orientation:\s*$/m.test(text))return 'gaussian-log';
    if(/CARTESIAN COORDINATES\s*\((?:ANGSTROE?M|A\.U\.)\)/i.test(text))return 'orca-log';
    if(/^\s*#\s*(?:Geometry\s+of\b|NODE\b|ITR[.\s]|STEP\b)/im.test(text))return 'grrm-log';
    if(/NACTIVEATOM\s*\/\s*NATOM\s*:/i.test(text))return 'grrm-rrm';
    if(/^\s*\$coord\b/im.test(text))return 'turbomole';
    if(/^\s*\$molecule\b/im.test(text))return 'qchem';
    if(/^\s*\$DATA\s*$/im.test(text))return 'gamess';
    if(/^\s*\*\s*xyz(?:file)?\b|^\s*%coords\b/im.test(text))return 'orca';
    if(/^\s*\[(?:Molden Format|Atoms|GEOMETRIES)\]/im.test(text))return 'molden';
    if(/^Atomic numbers\s+I\s+N=/m.test(text)&&/^Current cartesian coordinates\s+R\s+N=/m.test(text))return 'fchk';
    if(/^\s*%block\s+Atomic[_.-]?CoordinatesAndAtomicSpecies\b/im.test(text))return 'siesta';
    if(/^\s*ATOMIC_POSITIONS\b/im.test(text)&&/\bnat\s*=/i.test(text))return 'espresso';
    if(/^\s*(?:PRIMCOORD|ATOMS)(?:\s+\d+)?\s*$/im.test(text))return 'xsf';
    if(/^\s*(?:atom|atom_frac)\s+\S+\s+\S+\s+\S+\s+\S+\s*(?:#.*)?$/m.test(text))return 'aims';
    if(/^\s*geometry\b[^\n]*\n/im.test(text)&&/^\s*end\s*$/im.test(text))return 'nwchem';
    if(/^\s*(?:Direct|Cartesian)\s+configuration\s*=/im.test(text))return 'xdatcar';
    if(/^\s*\d+\s+[CSF]\s*$/im.test(text.split('\n')[0]))return 'gen';
    const initial=text.trimStart().split('\n');
    if(/^\s*\d+\s*$/.test(initial[0])&&/^\s*(?:[A-Z][a-z]?|D|T)\s+/.test(initial[2]||''))return 'xyz';
    const legacy=oldDetect(text);
    if(['json','sdf','mol','mol2','cif','pdb'].includes(legacy))return ext==='pdbqt'?'pdbqt':legacy;
    if(/^\s*#/.test(text.trimStart())||/^\s*%[^\n]*\n[\s\S]*^\s*#/m.test(text)){
      const l=text.split('\n'),i=l.findIndex(x=>/^\s*#/.test(x));let j=i+1;while(j<l.length&&!l[j].trim())j++;
      return cm(l[j]||'')?'grrm':'gaussian';
    }
    if(hints[ext])return hints[ext];
    if(/^(?:poscar|contcar)(?:[._-].*)?$/.test(name))return 'poscar';
    if(/^xdatcar(?:[._-].*)?$/.test(name))return 'xdatcar';
    if(/^coord$/.test(name))return 'turbomole';
    if(name==='geometry.in')return 'aims';
    if(['log','out','com','inp','in','chk','gbw','dcd','xtc','trr','traj','h5','hdf5','gz','zip'].includes(ext))
      throw Error('このファイルの座標形式を判別できません。対応するCartesian座標を含むテキスト（XYZ等）へ変換してください: '+filename);
    return oldDetect(text);
  }
  function parse(text,format='auto',options={}){
    text=clean(text);
    if(text.length>MAX_BYTES)throw Error('入力は50MiB以下にしてください。');
    if(/[\u0000-\u0008\u000e-\u001f]/.test(text))throw Error('バイナリまたは不正な文字を含むファイルです。XYZ等のテキスト形式へ変換してください。');
    if(!format||format==='auto')format=detect(text,options.filename||'');
    const result=readers[format]?readers[format](text,options):oldParse(text,format);
    if(options.filename){
      const frames=result.metadata.trajectory||[result];
      for(const f of frames)f.metadata.sourceFile=options.filename;
      result.metadata.sourceFile=options.filename;
      if(!result.metadata.title||result.metadata.title==='無題の構造')result.metadata.title=options.filename;
    }
    return result;
  }
  async function readText(file){
    if(!file||file.size>MAX_BYTES)throw Error('ファイルは50MiB以下にしてください。');
    const bytes=new Uint8Array(await file.arrayBuffer());let text,encoding='utf-8';
    if(bytes[0]===0xff&&bytes[1]===0xfe)encoding='utf-16le';
    else if(bytes[0]===0xfe&&bytes[1]===0xff)encoding='utf-16be';
    try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
    catch(error){if(encoding!=='utf-8')throw Error('文字コードを読み取れません。UTF-8で保存してください。');encoding='shift_jis';try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch(e){throw Error('UTF-8 / BOM付きUTF-16 / Shift_JISで保存してください。');}}
    if(/[\u0000-\u0008\u000e-\u001f]/.test(text))throw Error('バイナリファイルは読み込めません。XYZ等のテキスト形式へ変換してください。');
    return {name:file.name,text:clean(text),encoding};
  }
  async function readFiles(fileList){
    const input=Array.from(fileList||[]);if(!input.length)throw Error('ファイルを選択してください。');
    if(input.length>200||input.reduce((n,f)=>n+f.size,0)>MAX_BYTES)throw Error('一度に200ファイル・合計50MiBまで読み込めます。');
    const files=new Map(),records=[],used=new Set(),all=[];
    // Sequential reads bound peak memory and retain the supplied file order.
    for(const f of input){
      const key=f.name.replace(/\\/g,'/').split('/').pop().toLowerCase();if(files.has(key))throw Error('同名のファイルは同時に読み込めません: '+f.name);
      const r=await readText(f);r.key=key;files.set(key,r);records.push(r);
    }
    const parsed=[];
    for(const r of records){
      try{parsed.push({record:r,result:parse(r.text,'auto',{filename:r.name,files,used})});}
      catch(error){throw Error(r.name+': '+error.message);}
    }
    if(parsed.length>1&&parsed.some(p=>p.result.metadata.sourceFormat==='json'||p.record.name.toLowerCase().endsWith('.json')))throw Error('プロジェクトJSONは単独で開いてください。');
    const active=parsed.filter(p=>!used.has(p.record.key));
    if(active.length===1)return active[0].result;
    for(const {record,result} of active)for(const frame of result.metadata.trajectory||[result]){
      const s=M.createState({...frame,metadata:{...frame.metadata,sourceFile:record.name}});
      delete s.metadata.trajectory;delete s.metadata.frameIndex;collect(all,s);
    }
    return finish(all);
  }
  IO.parseAuto=parse;Object.assign(F,{parse,detect,readText,readFiles,MAX_BYTES});
})(window);
