/* CTfile coordinate and chemical-attribute I/O. See BIOVIA CTfile Formats 2020. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,IO=MV.IO,M=MV.Model;
  const clone=x=>JSON.parse(JSON.stringify(x));
  const num=x=>{if(String(x).trim()===''||!Number.isFinite(Number(x)))throw Error('MOLの数値が不正です: '+x);return Number(x);};
  const integer=(x,min=0,max=100000)=>{const n=num(x);if(!Number.isInteger(n)||n<min||n>max)throw Error('MOLの整数値が範囲外です: '+x);return n;};
  const field=(l,a,b)=>integer(l.slice(a,b).trim()||'0',-999,9999);
  const pad=(x,n)=>String(x).padStart(n,' ');
  const nominal=[1,4,7,9,11,12,14,16,19,20,23,24,27,28,31,32,35,40,39,40,45,48,51,52,55,56,59,58,63,64,69,74,75,80,79,84,85,88,89,90,93,98,98,102,103,106,107,114,115,120,121,130,127,132,133,138,139,140,141,142,145,152,153,158,159,164,165,166,169,174,175,180,181,184,187,192,193,195,197,202,205,208,209,209,210,222,223,226,227,232,231,238,237,244,243,247,247,251,252,257,258,259,262,261,262,263,264,265,268,281,280,285,284,289,288,292,292,293]; // Filled below from the pinned Open Babel element reference.
  function symbol(e){if(e==='D'||e==='T')return {element:'H',mass:e==='D'?2:3};if(!IO.ELEMENTS.includes(e))throw Error('具体的な元素記号が必要です: '+e);return {element:e};}
  function attributes(text){
    const result={};const re=/([A-Za-z][A-Za-z0-9_]*)=("(?:[^"]|"")*"|\([^)]*\)|[^\s]+)/g;let m,end=0;
    while((m=re.exec(text))){if(text.slice(end,m.index).trim())throw Error('V3000属性が不正です。');if(Object.hasOwn(result,m[1]))throw Error('V3000属性が重複しています。');result[m[1]]=m[2];end=re.lastIndex;}
    if(text.slice(end).trim())throw Error('V3000属性を読み取れません: '+text.slice(end));return result;
  }
  function validateProps(p,bond=false){
    for(const k of ['CFG','RAD'])if(p[k]!=null)integer(p[k],0,3);
    if(p.CHG!=null)integer(p.CHG,-15,15);if(p.MASS!=null)integer(p.MASS,1,400);
    if(bond&&p.ENDPTS)throw Error('多中心結合ENDPTSは未対応です。通常の2原子間結合として入力してください。');
  }
  function parse(input){
    const raw=String(input).replace(/\r\n|[\r\u0085\u2028\u2029]/g,'\n').replace(/^\uFEFF/,'');
    const records=raw.split(/^\$\$\$\$\s*$/m).filter(t=>t.trim());if(records.length!==1)throw Error('MOL/SDFは1構造ずつ入力してください。');
    const lines=records[0].split('\n');if(!/V[23]000/.test(lines[3]||''))throw Error('MOLは3行のヘッダーとV2000/V3000のcounts行が必要です。');
    const end=lines.findIndex(l=>/^M\s+END\s*$/.test(l));if(end<0)throw Error('MOLの終端M ENDがありません。');
    const meta={title:lines[0],sourceFormat:raw.includes('$$$$')?'sdf':'mol',bondsInferred:false,molVersion:lines[3].includes('V3000')?'V3000':'V2000',molHeader:lines.slice(1,3),sdfProperties:lines.slice(end+1).join('\n').trim()};
    const s=meta.molVersion==='V3000'?readV3000(lines.slice(4,end),meta):readV2000(lines,meta,end);
    s.metadata.molSource=raw;return s;
  }
  function readV2000(lines,meta,end){
    const n=field(lines[3],0,3),nb=field(lines[3],3,6);integer(n,0,2000);integer(nb,0,999);if(end<4+n+nb)throw Error('MOLの原子・結合行が不足しています。');meta.chiralFlag=field(lines[3],12,15);
    const atoms=lines.slice(4,4+n).map((l,i)=>{
      const e=symbol(l.slice(31,34).trim()),code=field(l,36,39);integer(code,0,7);
      const props={};if(e.mass)props.MASS=String(e.mass);
      const delta=field(l,34,36);if(delta)props.MASS=String(nominal[IO.ELEMENTS.indexOf(e.element)]+delta);
      const cfg=field(l,39,42);if(cfg)props.CFG=String(cfg);if(code===4)props.RAD='2';
      const slots={HCOUNT:[42,45],STBOX:[45,48],VAL:[48,51],INVRET:[63,66],EXACHG:[66,69]};
      for(const [key,[a,b]] of Object.entries(slots)){let v=field(l,a,b);if(v){if(key==='HCOUNT')v=v===1?-1:v-1;if(key==='VAL'&&v===15)v=-1;props[key]=String(v);}}
      validateProps(props);return M.createAtom({element:e.element,x:num(l.slice(0,10)),y:num(l.slice(10,20)),z:num(l.slice(20,30)),charge:({1:3,2:2,3:1,5:-1,6:-2,7:-3})[code]||0,mol:{props,map:integer(l.slice(60,63).trim()||0,0,999),index:i+1}});
    });
    const bonds=[],keys=new Set();
    for(const l of lines.slice(4+n,4+n+nb)){
      const a=field(l,0,3),b=field(l,3,6),order=field(l,6,9),stereo=field(l,9,12);if(!atoms[a-1]||!atoms[b-1]||a===b||![1,2,3,4].includes(order)||![0,1,3,4,6].includes(stereo))throw Error('MOLの結合指定が不正です。');
      const key=[a,b].sort().join(':');if(keys.has(key))throw Error('MOLの結合が重複しています。');keys.add(key);
      const props={};if(stereo)props.CFG=String(({1:1,4:2,6:3,3:2})[stereo]);if(field(l,15,18))props.TOPO=String(field(l,15,18));if(field(l,18,21))props.RXCTR=String(field(l,18,21));
      bonds.push(M.createBond({atom1:atoms[a-1].id,atom2:atoms[b-1].id,order,source:'manual',mol:{props,v2000Stereo:stereo}}));
    }
    const tail=lines.slice(4+n+nb,end),known={CHG:'CHG',ISO:'MASS',RAD:'RAD'};
    if(tail.some(l=>/^M  (CHG|RAD)/.test(l)))atoms.forEach(a=>{a.charge=0;delete a.mol.props.RAD;});
    if(tail.some(l=>/^M  ISO/.test(l)))atoms.forEach(a=>delete a.mol.props.MASS);
    for(const l of tail){if(!l.trim())continue;const p=l.trim().split(/\s+/),prop=known[p[1]];if(p[0]!=='M'||!prop)throw Error('MOLの追加ブロックに未対応です: '+l.slice(0,16));const count=integer(p[2],0,8);if(p.length!==3+count*2)throw Error('MOL属性行の件数が一致しません。');for(let i=0;i<count;i++){const a=atoms[integer(p[3+i*2],1,n)-1],value=p[4+i*2];if(prop==='CHG')a.charge=integer(value,-15,15);else {a.mol.props[prop]=String(value);validateProps(a.mol.props);}}}
    return M.createState({atoms,bonds,metadata:meta});
  }
  function readV3000(lines,meta){
    const logical=[];let pending='';for(const l of lines){if(!l.trim())continue;if(!/^M\s+V30 /.test(l))throw Error('V3000の行接頭辞が不正です。');const part=l.replace(/^M\s+V30 /,'');if(part.endsWith('-'))pending+=part.slice(0,-1);else {logical.push(pending+part);pending='';}}
    if(pending||logical[0]!=='BEGIN CTAB'||logical.at(-1)!=='END CTAB')throw Error('V3000のCTABが不完全です。');
    const counts=logical[1]?.match(/^COUNTS (\d+) (\d+) (\d+) (\d+) (\d+)(?:\s.*)?$/);if(!counts)throw Error('V3000 COUNTSが不正です。');const n=integer(counts[1],0,2000),nb=integer(counts[2],0,10000);if(Number(counts[3])||Number(counts[4]))throw Error('Sgroup・3D制約ブロックは未対応です。Ketcherで通常の原子・結合へ展開してください。');meta.chiralFlag=integer(counts[5],0,1);
    const atoms=[],bonds=[],byIndex=new Map(),bondIndices=new Set(),keys=new Set(),groups=[];let section='',seenAtoms=false,seenBonds=false;
    for(const l of logical.slice(2,-1)){
      if(l.startsWith('BEGIN ')){if(section)throw Error('V3000ブロックが入れ子になっています。');section=l.slice(6);if(!['ATOM','BOND','COLLECTION'].includes(section))throw Error('未対応のV3000ブロック: '+section);if(section==='ATOM'){if(seenAtoms)throw Error('ATOMが重複しています。');seenAtoms=true;}if(section==='BOND'){if(seenBonds)throw Error('BONDが重複しています。');seenBonds=true;}continue;}
      if(l.startsWith('END ')){if(l.slice(4)!==section)throw Error('V3000ブロックの終端が一致しません。');section='';continue;}
      if(section==='ATOM'){
        const m=l.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)(?:\s+(.*))?$/);if(!m)throw Error('V3000原子行が不正です。');const index=integer(m[1],1),e=symbol(m[2]),props=attributes(m[7]||'');validateProps(props);if(byIndex.has(index))throw Error('V3000原子番号が重複しています。');if(e.mass&&!props.MASS)props.MASS=String(e.mass);
        const charge=props.CHG?integer(props.CHG,-15,15):0;delete props.CHG;const a=M.createAtom({element:e.element,x:num(m[3]),y:num(m[4]),z:num(m[5]),charge,mol:{props,map:integer(m[6]),index}});byIndex.set(index,a);atoms.push(a);
      }else if(section==='BOND'){
        const m=l.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/);if(!m)throw Error('V3000結合行が不正です。');const id=integer(m[1],1),order=integer(m[2],1,10),a=byIndex.get(Number(m[3])),b=byIndex.get(Number(m[4]));if(!a||!b||a===b||![1,2,3,4,9,10].includes(order)||bondIndices.has(id))throw Error('V3000結合の参照・種類が不正です。');bondIndices.add(id);const key=[a.id,b.id].sort().join(':');if(keys.has(key))throw Error('結合が重複しています。');keys.add(key);const props=attributes(m[5]||'');validateProps(props,true);bonds.push(M.createBond({atom1:a.id,atom2:b.id,order:order>4?1:order,type:order===9?'coordination_candidate':order===10?'hydrogen':'covalent',source:'manual',mol:{props}}));
      }else if(section==='COLLECTION'){
        const m=l.match(/^(MDLV30\/(?:STEABS|STEREL\d+|STERAC\d+))\s+ATOMS=\((\d+)\s+([\d\s]+)\)$/);if(!m)throw Error('未対応のV3000 COLLECTIONです。');const indices=m[3].trim().split(/\s+/).map(Number);if(indices.length!==Number(m[2])||indices.some(i=>!byIndex.has(i)))throw Error('立体グループの原子参照が不正です。');groups.push({type:m[1],atomIds:indices.map(i=>byIndex.get(i).id)});
      }else throw Error('V3000ブロック外の行があります。');
    }
    if(section||atoms.length!==n||bonds.length!==nb||(!seenAtoms&&n))throw Error('V3000の原子数・結合数が一致しません。');meta.stereoGroups=groups;return M.createState({atoms,bonds,metadata:meta});
  }
  function check(s){if(s.metadata.cell)throw Error('周期セルはMOLに含められません。XYZ+TVまたはプロジェクトで保存してください。');}
  function header(s,version){return [String(s.metadata.title||'Structure').replace(/[\r\n]/g,' '),s.metadata.molHeader?.[0]||'Molecule Studio      3D',s.metadata.molHeader?.[1]||'',version==='V3000'?'  0  0  0     0  0            999 V3000':`${pad(s.atoms.length,3)}${pad(s.bonds.length,3)}  0  0${pad(s.metadata.chiralFlag||0,3)}  0            999 V2000`];}
  function toV3000(s){
    check(s);const ids=new Map(),used=new Set();let next=1;for(const a of s.atoms){let id=a.mol?.index;if(!Number.isInteger(id)||id<1||used.has(id)){while(used.has(next))next++;id=next++;}used.add(id);ids.set(a.id,id);}
    const lines=header(s,'V3000'),add=t=>{while(t.length>70){lines.push('M  V30 '+t.slice(0,70)+'-');t=t.slice(70);}lines.push('M  V30 '+t);};
    add('BEGIN CTAB');add(`COUNTS ${s.atoms.length} ${s.bonds.length} 0 0 ${s.metadata.chiralFlag||0}`);add('BEGIN ATOM');
    for(const a of s.atoms){const props={...(a.mol?.props||{})};delete props.CHG;if(a.charge)props.CHG=String(a.charge);add(`${ids.get(a.id)} ${a.element} ${[a.x,a.y,a.z].map(x=>x.toFixed(10)).join(' ')} ${a.mol?.map||0}`+Object.entries(props).map(([k,v])=>` ${k}=${v}`).join(''));}add('END ATOM');
    add('BEGIN BOND');s.bonds.forEach((b,i)=>add(`${i+1} ${b.type==='coordination_candidate'?9:b.type==='hydrogen'?10:b.order} ${ids.get(b.atom1)} ${ids.get(b.atom2)}`+Object.entries(b.mol?.props||{}).map(([k,v])=>` ${k}=${v}`).join('')));add('END BOND');
    const groups=(s.metadata.stereoGroups||[]).map(g=>({...g,atomIds:g.atomIds.filter(id=>ids.has(id))})).filter(g=>g.atomIds.length);if(groups.length){add('BEGIN COLLECTION');groups.forEach(g=>add(`${g.type} ATOMS=(${g.atomIds.length} ${g.atomIds.map(id=>ids.get(id)).join(' ')})`));add('END COLLECTION');}add('END CTAB');lines.push('M  END');return lines.join('\n')+'\n';
  }
  function toV2000(s){
    check(s);if(s.atoms.length>999||s.bonds.length>999||s.bonds.some(b=>b.type!=='covalent')||(s.metadata.stereoGroups||[]).length)throw Error('この構造はMOL V3000で保存してください。');
    const lines=header(s,'V2000'),ids=new Map(s.atoms.map((a,i)=>[a.id,i+1]));
    for(const a of s.atoms){const p=a.mol?.props||{},allowed=['MASS','RAD','CFG','HCOUNT','STBOX','VAL','INVRET','EXACHG'];if(Object.keys(p).some(k=>!allowed.includes(k))||(a.mol?.map||0)>999)throw Error('拡張属性はMOL V3000で保存してください。');const coords=[a.x,a.y,a.z].map(x=>pad(x.toFixed(4),10));if(coords.some(x=>x.length>10))throw Error('座標がV2000の桁数を超えています。V3000で保存してください。');const h=p.HCOUNT?Number(p.HCOUNT)===-1?1:Number(p.HCOUNT)+1:0,v=Number(p.VAL||0)===-1?15:Number(p.VAL||0);lines.push(coords.join('')+' '+a.element.padEnd(3)+' 0'+[0,p.CFG||0,h,p.STBOX||0,v,0,0,0,a.mol?.map||0,p.INVRET||0,p.EXACHG||0].map(x=>pad(x,3)).join(''));}
    s.bonds.forEach(b=>{const p=b.mol?.props||{};if(Object.keys(p).some(k=>!['CFG','TOPO','RXCTR'].includes(k)))throw Error('拡張結合属性はV3000で保存してください。');const cfg=Number(p.CFG||0),stereo=b.mol?.v2000Stereo??({0:0,1:1,2:b.order===2?3:4,3:6})[cfg];lines.push([ids.get(b.atom1),ids.get(b.atom2),b.order,stereo,0,p.TOPO||0,p.RXCTR||0].map(x=>pad(x,3)).join(''));});
    for(const [code,key] of [['CHG','charge'],['ISO','MASS'],['RAD','RAD']]){const pairs=s.atoms.map((a,i)=>[i+1,key==='charge'?a.charge:a.mol?.props?.[key]]).filter(x=>Number(x[1]));for(let i=0;i<pairs.length;i+=8){const chunk=pairs.slice(i,i+8);lines.push(`M  ${code}${pad(chunk.length,3)}`+chunk.map(([a,v])=>pad(a,4)+pad(v,4)).join(''));}}
    lines.push('M  END');return lines.join('\n')+'\n';
  }
  const oldAuto=IO.parseAuto;
  IO.parseMolToState=parse;IO.parseAuto=t=>/V[23]000/.test(t)?parse(t):oldAuto(t);
  IO.stateToMolV3000Text=toV3000;
  IO.stateToMolText=(s,version)=>{if(version==='V3000'||(!version&&s.metadata.molVersion==='V3000'))return toV3000(s);if(version==='V2000')return toV2000(s);try{return toV2000(s);}catch(e){return toV3000(s);}};
  IO.stateToSDFText=s=>IO.stateToMolText(s)+(s.metadata.sdfProperties?s.metadata.sdfProperties+'\n\n':'')+'$$$$\n';
})(window);
