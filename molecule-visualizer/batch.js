/* Independent structures with a common composition, atom order and fixed cell. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer;
  function normalize(frames){
    if(!frames.length||frames.length>100)throw Error('一括最適化は1〜100構造です。');
    const first=frames[0],symbols=JSON.stringify(first.atoms.map(a=>a.element)),cell=JSON.stringify(first.metadata.cell||null);
    if(!first.atoms.length||first.atoms.length>500)throw Error('1構造は1〜500原子にしてください。');
    return frames.map((f,i)=>{
      if(f.atoms.some(a=>[a.x,a.y,a.z].some(x=>!Number.isFinite(x)||Math.abs(x)>10000)))throw Error(`構造${i+1}: 座標は±10000 Å以内の有限な数値にしてください。`);
      if(JSON.stringify(f.atoms.map(a=>a.element))!==symbols)throw Error(`構造${i+1}: エネルギー比較には全構造で同じ原子数・元素順序が必要です。ヘッダーなしの場合は空行や -- で構造を区切ってください。`);
      if(JSON.stringify(f.metadata.cell||null)!==cell)throw Error(`構造${i+1}: 全構造で同じセル・周期方向を使用してください。`);
      const s=MV.Model.createState(MV.Periodic.snapshot(f)),ids=new Map(s.atoms.map((a,k)=>[a.id,first.atoms[k].id]));
      s.atoms.forEach((a,k)=>{a.id=first.atoms[k].id;});s.bonds.forEach(b=>{b.atom1=ids.get(b.atom1);b.atom2=ids.get(b.atom2);});
      s.metadata.title=s.metadata.title||`構造 ${i+1}`;
      return MV.Periodic.snapshot(s);
    });
  }
  function parse(text,atomCount=0){
    if(String(text).length>10000000)throw Error('入力は10 MB以内にしてください。');
    if(!Number.isInteger(atomCount)||atomCount<0||atomCount>500)throw Error('区切りのない入力の原子数は1〜500、指定しない場合は空欄にしてください。');
    const lines=MV.IO.normalizeXYZInput(text).split('\n'),frames=[];
    let i=0,name='';
    const delimiter=l=>!l.trim()||/^--+$/.test(l.trim())||/^#\s*NODE\b/i.test(l.trim());
    const append=(body,title='')=>{
      const s=MV.IO.parseXYZToState(body);if(title)s.metadata.title=title;
      frames.push(MV.Periodic.snapshot(s));if(frames.length>100)throw Error('一括最適化は最大100構造です。');
    };
    while(i<lines.length){
      const line=lines[i].trim();
      if(delimiter(line)){if(/^#/.test(line))name=line.replace(/^#\s*/,'');i++;continue;}
      if(/^\d+$/.test(line)){
        const count=Number(line),body=[];i++;
        if(count<1||count>503||i>=lines.length)throw Error('XYZの原子数とコメント行を確認してください。');
        const comment=lines[i++];
        while(body.length<count&&i<lines.length){const row=lines[i++];if(row.trim())body.push(row);}
        while(i<lines.length&&/^TV\s/i.test(lines[i].trim()))body.push(lines[i++]);
        if(body.length<count)throw Error('XYZの原子数と座標行数が一致しません。');
        append([body.length,comment,...body].join('\n'),name);name='';
      }else{
        const body=[];while(i<lines.length&&!delimiter(lines[i])&&!/^\d+$/.test(lines[i].trim()))body.push(lines[i++]);
        if(atomCount){
          if(body.some(l=>/^TV\s/i.test(l.trim()))||body.length%atomCount)throw Error('指定した原子数で分割できません。TV付きの構造は原子数指定を空欄にし、空行で区切ってください。');
          for(let a=0;a<body.length;a+=atomCount)append(body.slice(a,a+atomCount).join('\n'),name);
        }else append(body.join('\n'),name);
        name='';
      }
    }
    return normalize(frames);
  }
  const completed=e=>['converged','step_limit'].includes(e.status)&&Number.isFinite(e.result?.energies?.[0]);
  function minimum(entries){const es=entries.filter(completed).map(e=>e.result.energies[0]);return es.length?Math.min(...es):null;}
  function csv(entries){
    const min=minimum(entries),quote=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s)&&!Number.isFinite(value))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
    return [['input','name','status','energy_eV','relative_eV','relative_kJ_mol','steps','fmax_eV_A','error'],...entries.map((e,i)=>{
      const r=e.result,energy=r?.energies[0],delta=completed(e)?energy-min:null;
      return [i+1,e.frame.metadata.title,e.status,energy,delta,delta==null?null:delta*96.4853321233,r?.steps,r?.effectiveFmax,e.error];
    })].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
  }
  // Only terminal per-structure failures may be skipped. A transport or protocol
  // error aborts the queue because the status of the native process is unknown.
  async function run(entries,execute,cancelled,update){
    for(let i=0;i<entries.length;i++){
      if(cancelled())break;
      const entry=entries[i];entry.status='running';update();
      try{Object.assign(entry,await execute(entry,i));}
      catch(error){entry.status='unknown';entry.error=error.message;throw error;}
      finally{update();}
      if(entry.status==='cancelled')break;
    }
    entries.filter(e=>e.status==='waiting').forEach(e=>{e.status='not_run';});update();
  }
  MV.Batch={parse,normalize,completed,minimum,csv,run};
})(window);
