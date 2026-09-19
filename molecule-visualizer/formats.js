/* Structural text readers. CIF syntax follows IUCr CIF 1.1; PDB uses wwPDB 3.3.
 * Read coordinates/topology, not the simulation settings of quantum inputs.
 */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,IO=MV.IO,M=MV.Model,P=MV.Periodic;
  const newline=t=>String(t).replace(/^\uFEFF/,'').replace(/\r\n|[\r\u0085\u2028\u2029]/g,'\n');
  const number=t=>{const v=String(t??'').replace(/\(\d+\)(?=[eE]|$)/,'').replace(/[dD]/,'e');if(!v.trim()||!Number.isFinite(Number(v)))throw Error('数値を読み取れません: '+t);return Number(v);};
  function element(s){s=String(s).replace(/\d+[+-]$|[+-]$/,'');if(s==='D'||s==='T')return 'H';const e=s[0]?.toUpperCase()+s.slice(1).toLowerCase();if(!IO.ELEMENTS.includes(e))throw Error('元素を特定できません: '+s);return e;}
  function atom(e,p,extra={}){const v=p.map(number);if(v.length!==3)throw Error('座標は3成分必要です。');return M.createAtom({element:element(e),x:v[0],y:v[1],z:v[2],...(['D','T'].includes(e)?{mol:{props:{MASS:e==='D'?'2':'3'}}}:{}),...extra});}
  function make(atoms,title,format,cell=null){if(!atoms.length||atoms.length>2000)throw Error('構造は1〜2000原子にしてください。');const s=M.createState({atoms,metadata:{title,sourceFormat:format,cell}});MV.Bonding.refreshInferredBonds(s);return s;}
  function frames(states){if(!states.length||states.length>200||states.reduce((n,s)=>n+s.atoms.length,0)>100000)throw Error('構造列は200フレーム・合計100000原子までです。');const s=states[0];if(states.length>1){s.metadata.trajectory=states.map(P.snapshot);s.metadata.frameIndex=0;}return s;}
  function sdf(text){
    // Remove only the record separator's own newline; MOL may have an empty title.
    const records=newline(text).split(/^\$\$\$\$[^\S\n]*\n?/m).filter(s=>s.trim());
    return frames(records.map(t=>{const s=IO.parseMolToState(t);s.metadata.sourceFormat='sdf';return s;}));
  }
  function cellParameters(a,b,c,alpha,beta,gamma){
    [a,b,c,alpha,beta,gamma]=[a,b,c,alpha,beta,gamma].map(number);if(Math.min(a,b,c)<=0||[alpha,beta,gamma].some(x=>x<=0||x>=180))throw Error('格子定数・角度が不正です。');
    const [ca,cb,cg]=[alpha,beta,gamma].map(x=>Math.cos(x*Math.PI/180)),sg=Math.sin(gamma*Math.PI/180),cx=c*cb,cy=c*(ca-cb*cg)/sg,cz2=c*c-cx*cx-cy*cy;if(cz2<=0)throw Error('格子角が特異です。');return P.cell([[a,0,0],[b*cg,b*sg,0],[cx,cy,Math.sqrt(cz2)]]);
  }
  function cifTokens(text){
    const result=[];let i=0;
    while(i<text.length){
      if(/\s/.test(text[i])){i++;continue;}if(text[i]==='#'){while(i<text.length&&text[i]!=='\n')i++;continue;}
      if(text[i]===';'&&(i===0||text[i-1]==='\n')){const end=text.indexOf('\n;',i+1);if(end<0)throw Error('CIFの複数行文字列が閉じていません。');result.push({v:text.slice(i+1,end),quoted:true});i=end+2;continue;}
      if(text[i]==="'"||text[i]==='"'){const quote=text[i++],start=i;while(i<text.length&&!(text[i]===quote&&(i+1===text.length||/\s/.test(text[i+1]))))i++;if(i===text.length)throw Error('CIFの引用符が閉じていません。');result.push({v:text.slice(start,i++),quoted:true});continue;}
      const start=i;while(i<text.length&&!/\s/.test(text[i]))i++;result.push({v:text.slice(start,i),quoted:false});
    }return result;
  }
  const cifKey=s=>s.toLowerCase().replace(/[.\-]/g,'_');
  function cifBlocks(text){
    if(/^#\\#CIF_2\.0/.test(text))throw Error('CIF 2.0の複合値は未対応です。CIF 1.1で保存してください。');
    const tokens=cifTokens(text),blocks=[];let block=null,i=0;
    const reserved=t=>!t.quoted&&/^(?:_|data_|loop_|stop_|save_|global_)/i.test(t.v);
    while(i<tokens.length){
      const t=tokens[i++],v=t.v;
      if(!t.quoted&&/^data_/i.test(v)){block={name:v.slice(5),tags:{},loops:[]};blocks.push(block);continue;}
      if(!block)throw Error('CIFのdata_ブロックがありません。');
      if(!t.quoted&&/^loop_$/i.test(v)){
        const headers=[];while(tokens[i]&&!tokens[i].quoted&&tokens[i].v.startsWith('_'))headers.push(cifKey(tokens[i++].v));if(!headers.length)throw Error('CIF loop_に項目名がありません。');
        const values=[];while(tokens[i]&&!reserved(tokens[i]))values.push(tokens[i++].v);if(values.length%headers.length)throw Error('CIFループの列数が一致しません。');
        block.loops.push({headers,rows:Array.from({length:values.length/headers.length},(_,j)=>Object.fromEntries(headers.map((h,k)=>[h,values[j*headers.length+k]])))});continue;
      }
      if(!t.quoted&&v.startsWith('_')){if(!tokens[i]||reserved(tokens[i]))throw Error('CIF項目の値がありません: '+v);block.tags[cifKey(v)]=tokens[i++].v;continue;}
      if(/^stop_$/i.test(v))continue;throw Error('CIFの項目を読み取れません: '+v);
    }return blocks;
  }
  function symmetry(operation){
    const parts=operation.toLowerCase().replace(/\s+/g,'').split(',');if(parts.length!==3)throw Error('CIF対称操作は3成分必要です。');
    const coefficients=parts.map(expr=>{
      const terms=expr.match(/[+-]?[^+-]+/g)||[],c=[0,0,0,0];if(terms.join('')!==expr)throw Error('CIF対称操作が不正です。');
      for(let term of terms){let sign=1;if(term[0]==='-'){sign=-1;term=term.slice(1);}else if(term[0]==='+')term=term.slice(1);
        if(/^[xyz]$/.test(term))c['xyz'.indexOf(term)]+=sign;
        else if(/^\d+(?:\.\d+)?(?:\/\d+)?$/.test(term)){const [n,d='1']=term.split('/');if(Number(d)===0)throw Error('対称操作の分母が0です。');c[3]+=sign*Number(n)/Number(d);}
        else throw Error('CIF対称操作の未対応表記です: '+operation);
      }return c;
    });return f=>coefficients.map(c=>c[3]+c[0]*f[0]+c[1]*f[1]+c[2]*f[2]);
  }
  function cif(text){
    const states=cifBlocks(text).filter(b=>b.loops.some(l=>l.headers.includes('_atom_site_fract_x')||l.headers.includes('_atom_site_cartn_x'))).map(b=>{
      const tags=b.tags,loop=b.loops.find(l=>l.headers.includes('_atom_site_fract_x')||l.headers.includes('_atom_site_cartn_x')),fractional=loop.headers.includes('_atom_site_fract_x');
      const c=tags._cell_length_a?cellParameters(...['length_a','length_b','length_c','angle_alpha','angle_beta','angle_gamma'].map(k=>tags['_cell_'+k])):null;
      if(fractional&&!c)throw Error('CIFの分率座標には6個の格子定数が必要です。');
      const opNames=['_space_group_symop_operation_xyz','_symmetry_equiv_pos_as_xyz'],ops=b.loops.flatMap(l=>l.rows.flatMap(r=>opNames.filter(k=>r[k]!=null).map(k=>r[k])));for(const k of opNames)if(tags[k])ops.push(tags[k]);
      const sg=tags._space_group_name_h_m_alt||tags._symmetry_space_group_name_h_m,sgNum=tags._space_group_it_number||tags._symmetry_int_tables_number;
      if(!ops.length&&((sg&&sg.replace(/\s/g,'').toUpperCase()!=='P1')||(sgNum&&number(sgNum)!==1)))throw Error('このCIFには対称操作がありません。単位胞へ展開済みのP1形式、または対称操作付きCIFで入力してください。');
      if(ops.length>192)throw Error('対称操作は192個までです。');if(ops.length&&!c&&ops.some(x=>x.replace(/\s/g,'')!=='x,y,z'))throw Error('CIFの対称操作には格子定数が必要です。');
      const transforms=(ops.length?ops:['x,y,z']).map(symmetry),atoms=[],seen=new Set(),warnings=[];let partial=false;
      for(const row of loop.rows){
        const raw=row._atom_site_type_symbol||row._atom_site_label?.match(/^[A-Za-z]+/)?.[0],e=element(raw),occ=row._atom_site_occupancy==null||['.','?'].includes(row._atom_site_occupancy)?1:number(row._atom_site_occupancy);
        if(occ<0||occ>1)throw Error('CIF占有率は0〜1にしてください。');if(occ===0)continue;if(occ<1)partial=true;
        const pos=['x','y','z'].map(k=>number(row['_atom_site_'+(fractional?'fract_':'cartn_')+k])),f=fractional?pos:c?P.fractional(pos,c):pos;
        for(const transform of transforms){const v=c?transform(f).map(x=>((x%1)+1)%1):pos,key=e+':'+occ+':'+v.map(x=>c?Math.round(x*1e6)%1000000:Math.round(x*1e6)).join(',');if(seen.has(key))continue;seen.add(key);
          const cart=c?P.cartesian(v,c):v;atoms.push(atom(e,cart,{xyzExtras:{occupancy:{type:'R',values:[String(occ)]}}}));if(atoms.length>2000)throw Error('対称展開後の原子数が2000を超えます。');
        }
      }
      if(partial)warnings.push('部分占有サイトを全て表示しています。計算前に占有・disorderを整理してください。');
      const s=make(atoms,b.name||'CIF','cif',c);s.metadata.importWarnings=warnings;return s;
    });return frames(states);
  }
  function pdb(text){
    const lines=text.split('\n'),cryst=lines.find(l=>l.startsWith('CRYST1')),c=cryst?cellParameters(cryst.slice(6,15),cryst.slice(15,24),cryst.slice(24,33),cryst.slice(33,40),cryst.slice(40,47),cryst.slice(47,54)):null;
    const groups=[],connections=lines.filter(l=>l.startsWith('CONECT'));let group=[];
    for(const line of lines){if(line.startsWith('MODEL ')||line.startsWith('ENDMDL')){if(group.length)groups.push(group);group=[];}else if(/^(ATOM  |HETATM)/.test(line))group.push(line);}if(group.length)groups.push(group);
    return frames(groups.map((rows,index)=>{
      const ids=new Map(),warnings=[],atoms=[];
      for(const l of rows){const alt=l[16];if(alt&&alt!==' '&&alt!=='A'){warnings.push('PDBの代替位置は空白またはAのみ読み込みました。');continue;}
        let e=l.slice(76,78).trim();if(!e){const name=l.slice(12,16);e=name[0]===' '||/^\d/.test(name)?name.replace(/[\d\s]/g,'')[0]:name.trim().match(/^[A-Za-z]{1,2}/)?.[0];}
        const charge=l.slice(78,80).trim(),a=atom(e,[l.slice(30,38),l.slice(38,46),l.slice(46,54)],{charge:/^\d[+-]$/.test(charge)?Number(charge[0])*(charge[1]==='-'?-1:1):0});atoms.push(a);ids.set(l.slice(6,11).trim(),a.id);
      }
      const s=make(atoms,lines.find(l=>l.startsWith('TITLE '))?.slice(10).trim()||'PDB '+(index+1),'pdb',c);
      for(const l of connections){const serials=l.slice(6).match(/.{1,5}/g)?.map(x=>x.trim()).filter(Boolean)||[],from=ids.get(serials[0]);for(const target of serials.slice(1)){const to=ids.get(target);if(from&&to&&from!==to)M.addOrUpdateBond(s,from,to,1,'covalent','manual');}}
      s.metadata.importWarnings=[...new Set(warnings)];return s;
    }));
  }
  function mol2(text){
    return frames(text.split(/@<TRIPOS>MOLECULE\s*\n/i).slice(1).map(block=>{
      const lines=block.split('\n'),title=lines[0],counts=lines[1]?.trim().split(/\s+/).map(number),sections={};let name=null;
      for(const l of lines.slice(2)){if(/^@<TRIPOS>/.test(l)){name=l.slice(9).trim();sections[name]=[];}else if(name&&l.trim()&&!l.startsWith('#'))sections[name].push(l);}
      const ids=new Map(),atoms=(sections.ATOM||[]).map(l=>{const p=l.trim().split(/\s+/),a=atom(p[5]?.split('.')[0],p.slice(2,5),p[8]!=null?{xyzExtras:{partial_charge:{type:'R',values:[String(number(p[8]))]}}}:{});if(ids.has(p[0]))throw Error('MOL2原子IDが重複しています。');ids.set(p[0],a.id);return a;});
      const s=make(atoms,title,'mol2');s.bonds=[];
      for(const l of sections.BOND||[]){const p=l.trim().split(/\s+/),order={ar:4,am:1,'1':1,'2':2,'3':3}[p[3]],a=ids.get(p[1]),b=ids.get(p[2]);if(!order||!a||!b||a===b)throw Error('MOL2の結合が未対応または不正です。');M.addOrUpdateBond(s,a,b,order,'covalent','manual');}
      if(atoms.length!==counts?.[0]||s.bonds.length!==counts?.[1])throw Error('MOL2の原子数・結合数が一致しません。');return s;
    }));
  }
  function quantum(text,format){
    let charge,multiplicity,body,title=format.toUpperCase(),scale=1;
    if(format==='orca'){
      const matches=[...text.matchAll(/^\s*\*\s*xyz\s+(-?\d+)\s+(\d+)\s*\n([\s\S]*?)^\s*\*\s*$/gmi)];if(matches.length!==1)throw Error('ORCAは単一の * xyz 電荷 多重度 … * 座標ブロックに対応します（xyzfile・内部座標は未対応）。');
      [,charge,multiplicity,body]=matches[0];if(/\b(?:bohrs|bohr|a\.u\.)\b/i.test(text))scale=.529177210903;
    }else{
      if(/--Link1--/i.test(text))throw Error('GaussianのLink1は分割して入力してください。');const lines=text.split('\n');let i=lines.findIndex(l=>/^\s*#/.test(l));if(i<0)throw Error('Gaussianのルート行がありません。');let route='';while(i<lines.length&&lines[i].trim())route+=lines[i++]+' ';while(i<lines.length&&!lines[i].trim())i++;let titles=[];while(i<lines.length&&lines[i].trim())titles.push(lines[i++]);title=titles.join(' ');while(i<lines.length&&!lines[i].trim())i++;const cm=lines[i++]?.trim().match(/^(-?\d+)\s+(\d+)$/);if(!cm)throw Error('Gaussianの電荷・多重度行を確認してください。');[,charge,multiplicity]=cm;const rows=[];while(i<lines.length&&lines[i].trim())rows.push(lines[i++]);body=rows.join('\n');if(/units\s*=\s*(?:\(\s*)?(?:au|bohr)/i.test(route))scale=.529177210903;
    }
    const atoms=body.split('\n').filter(l=>l.trim()).map(l=>{let p=l.trim().split(/[\s,]+/),symbol=/^\d+$/.test(p[0])?IO.ELEMENTS[Number(p[0])-1]:p[0];if(p.length===5&&/^-?[01]$/.test(p[1]))p.splice(1,1);if(p.length!==4)throw Error('Cartesian座標（元素 X Y Z）の入力に対応します。');return atom(symbol,p.slice(1).map(x=>number(x)*scale));});
    const s=make(atoms,title,format);s.metadata.totalCharge=Number(charge);s.metadata.multiplicity=Number(multiplicity);s.metadata.importWarnings=['座標・電荷・多重度を読み込みました。計算条件は実行・適用しません。'];return s;
  }
  function detect(text){
    if(text.trim().startsWith('{'))return 'json';if(/^\$\$\$\$/m.test(text))return 'sdf';if(/V[23]000/.test(text))return 'mol';if(/@<TRIPOS>MOLECULE/.test(text))return 'mol2';if(/^\s*data_/im.test(text)&&/^\s*_atom_site[_.]/im.test(text))return 'cif';if(/^(ATOM  |HETATM|HEADER|CRYST1)/m.test(text))return 'pdb';if(/^\s*\*\s*xyz/im.test(text))return 'orca';if(/^\s*#/m.test(text)&&!text.trim().startsWith('#\\#CIF'))return 'gaussian';
    const l=text.trimStart().split('\n');if(/^\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*$/.test(l[1]||'')&&!/^\d+\s*$/.test(l[0]))return 'poscar';return 'xyz';
  }
  function parse(text,format='auto'){
    text=newline(text);if(text.length>10*1024*1024)throw Error('構造データは10MB以下にしてください。');if(format==='auto'||!format)format=detect(text);
    const readers={xyz:IO.parseXYZToState,mol:IO.parseMolToState,sdf,cif,pdb,mol2,poscar:P.parsePOSCAR,json:IO.parseProject,gaussian:t=>quantum(t,'gaussian'),orca:t=>quantum(t,'orca')};if(!readers[format])throw Error('未対応の読み込み形式です: '+format);return readers[format](text);
  }
  IO.parseAuto=parse;MV.Formats={parse,detect,frames,cellParameters};
})(window);
