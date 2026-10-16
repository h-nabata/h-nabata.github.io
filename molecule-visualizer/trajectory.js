/* Selection of existing frames only: no interpolation, alignment or atom remapping. */
(function(global){
  'use strict';
  function validate(source){
    const {symbols,images,energies,biasEnergies,cell}=source;
    if(!Array.isArray(symbols)||!symbols.length||symbols.some(s=>typeof s!=='string'||! /^[A-Z][a-z]?$/.test(s))||!Array.isArray(images)||!images.length||images.length>10001)throw Error('構造列の元素・構造数が不正です。');
    if(images.some(p=>!Array.isArray(p)||p.length!==symbols.length||p.some(v=>!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)||Math.abs(x)>10000))))throw Error('構造列の原子数・座標が不正です。');
    for(const series of [energies,biasEnergies])if(series!=null&&(!Array.isArray(series)||series.length!==images.length||series.some(x=>!Number.isFinite(x))))throw Error('構造列とエネルギーが一致しません。');
    if(biasEnergies&&!energies)throw Error('人工項と併せて物理エネルギーが必要です。');
    if(source.stepNumbers&&(!Array.isArray(source.stepNumbers)||source.stepNumbers.length!==images.length||source.stepNumbers.some(i=>!Number.isInteger(i)||i<0||i>10000)))throw Error('最適化ステップの番号が不正です。');
    if(cell&&(!Array.isArray(cell.vectors)||cell.vectors.length!==3||cell.vectors.some(v=>!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)))||!Array.isArray(cell.pbc)||cell.pbc.length!==3||cell.pbc.some(x=>typeof x!=='boolean')))throw Error('構造列のセルが不正です。');
    return source;
  }
  function distances(images){
    const cumulative=[0];
    for(let i=1;i<images.length;i++){
      let sum=0;for(let a=0;a<images[i].length;a++)for(let k=0;k<3;k++)sum+=(images[i][a][k]-images[i-1][a][k])**2;
      cumulative.push(cumulative[i-1]+Math.sqrt(sum/images[i].length));
    }
    return cumulative;
  }
  function indices(images,count,method='index',cumulative){
    const n=images.length;
    if(!Number.isInteger(count)||count<(n===1?1:2)||count>n)throw Error(`抽出数は${n===1?'1':`2〜${n}`}の整数にしてください。両端点を含みます。`);
    if(!['index','distance'].includes(method))throw Error('抽出方法が不正です。');
    if(count===1)return [0];
    const uniform=()=>Array.from({length:count},(_,i)=>Math.round(i*(n-1)/(count-1)));
    if(method==='index')return uniform();
    const arc=cumulative||distances(images),total=arc[n-1];
    if(!Number.isFinite(total))throw Error('累積変位を計算できません。');
    if(total===0)return uniform();
    const selected=[0];
    for(let k=1;k<count-1;k++){
      const target=total*k/(count-1),lower=selected[k-1]+1,upper=n-count+k;
      let lo=lower,hi=upper;
      while(lo<hi){const mid=Math.floor((lo+hi)/2);if(arc[mid]<target)lo=mid+1;else hi=mid;}
      const before=Math.max(lower,lo-1);
      selected.push(Math.abs(arc[before]-target)<=Math.abs(arc[lo]-target)?before:lo);
    }
    selected.push(n-1);return selected;
  }
  // Smooth only the values used for peak detection; exported energies/coordinates stay raw.
  function smooth(values,window=5){
    if(!Array.isArray(values)||!values.length||values.some(e=>!Number.isFinite(e)))throw Error('極大点の判定には物理エネルギーが必要です。');
    if(!Number.isInteger(window)||window<1||window>101||window%2!==1)throw Error('移動平均の幅は1〜101の奇数にしてください（1は平滑化なし）。');
    const half=(window-1)/2;
    return values.map((_,i)=>{const lo=Math.max(0,i-half),hi=Math.min(values.length-1,i+half);let sum=0;for(let j=lo;j<=hi;j++)sum+=values[j]-values[i];return values[i]+sum/(hi-lo+1);});
  }
  function energyFeatures(source,{window=5,minProminence=.01}={}){
    if(!Number.isFinite(minProminence)||minProminence<0)throw Error('極大点の最小突出量は0以上のeV値にしてください。');
    const values=smooth(source.energies,window),raw=source.energies;
    let highest=0;for(let i=1;i<raw.length;i++)if(raw[i]>raw[highest])highest=i;
    // Collapse flat runs. Prominence is measured against the two adjacent valleys.
    const runs=[];for(let i=0;i<values.length;){let end=i;while(end+1<values.length&&values[end+1]===values[i])end++;runs.push({start:i,end,value:values[i]});i=end+1;}
    const peaks=[];let valley=values[0];
    for(let i=1;i<runs.length-1;i++){
      const r=runs[i];if(r.value<runs[i-1].value&&r.value<runs[i+1].value)valley=r.value;
      if(r.value<=runs[i-1].value||r.value<=runs[i+1].value)continue;
      let j=i+1;while(j+1<runs.length&&runs[j+1].value<runs[j].value)j++;
      const prominence=r.value-Math.max(valley,runs[j].value);
      if(prominence>=minProminence)peaks.push({index:Math.floor((r.start+r.end)/2),prominence,energy:r.value});
    }
    peaks.sort((a,b)=>b.prominence-a.prominence||b.energy-a.energy||a.index-b.index);
    return {highest,minimum:new Set([0,raw.length-1,highest]).size,values,peaks};
  }
  function extract(source,count,method='index',options={},cumulative){
    validate(source);
    const picked=indices(source.images,count,method,cumulative);
    if(source.kind!=='afir')return {indices:picked};
    const features=energyFeatures(source,options);
    if(count<features.minimum)throw Error(`AFIRの両端点と最高エネルギー構造を残すには${features.minimum}ノード以上が必要です。`);
    const anchors=new Set([0,source.images.length-1,features.highest]);
    if(options.preservePeaks!==false)for(const p of features.peaks){if(anchors.size>=count)break;anchors.add(p.index);}
    // Retain the uniform targets where possible, replacing the nearest unprotected ones.
    const selected=new Set(picked),arc=method==='distance'?(cumulative||distances(source.images)):null;
    const metric=arc?.at(-1)>0?arc:source.images.map((_,i)=>i);
    for(const anchor of anchors){
      if(selected.has(anchor))continue;
      let remove=-1,best=Infinity;
      for(const i of selected)if(!anchors.has(i)){const d=Math.abs(metric[i]-metric[anchor]);if(d<best||(d===best&&i<remove)){remove=i;best=d;}}
      selected.delete(remove);selected.add(anchor);
    }
    return {...features,indices:[...selected].sort((a,b)=>a-b),retainedPeaks:features.peaks.filter(p=>selected.has(p.index)).length};
  }
  function validateSelection(source,selected){
    validate(source);
    if(!Array.isArray(selected)||!selected.length||selected.some((i,k)=>!Number.isInteger(i)||i<0||i>=source.images.length||(k>0&&i<=selected[k-1])))throw Error('出力するフレームの指定が不正です。');
  }
  function coordinates(source,i){return source.images[i].map((p,a)=>source.symbols[a]+' '+p.map(x=>x.toFixed(12)).join(' '));}
  function lup(source,selected){
    validateSelection(source,selected);
    return selected.map((i,k)=>[`# NODE ${k}`,...coordinates(source,i)].join('\n')).join('\n--\n')+'\n';
  }
  function lupFilename(name){
    const safe=Array.from(String(name||'').trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_')).slice(0,60).join('').replace(/[. ]+$/g,'')||'molecule';
    return safe+'_infile.log';
  }
  function xyz(source,selected,method='all'){
    validateSelection(source,selected);
    if(!['all','index','distance'].includes(method))throw Error('抽出方法が不正です。');
    return selected.map((i,k)=>{
      let comment=`MoleculeStudio frame=${k+1}/${selected.length} source_frame=${i+1}/${source.images.length} selection=${method}`;
      if(source.kind==='afir'||source.kind==='optimize')comment+=` step=${source.stepNumbers?.[i]??i}`;
      if(source.energies)comment+=` energy_eV=${source.energies[i].toPrecision(15)}`;
      if(source.biasEnergies)comment+=` bias_eV=${source.biasEnergies[i].toPrecision(15)} biased_energy_eV=${(source.energies[i]+source.biasEnergies[i]).toPrecision(15)}`;
      if(source.cell)comment+=` Lattice="${source.cell.vectors.flat().join(' ')}" pbc="${source.cell.pbc.map(v=>v?'T':'F').join(' ')}" Properties=species:S:1:pos:R:3`;
      return [source.symbols.length,comment,...coordinates(source,i)].join('\n')+'\n';
    }).join('');
  }
  const api={validate,distances,indices,smooth,energyFeatures,extract,xyz,lup,lupFilename};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  (global.MoleculeVisualizer=global.MoleculeVisualizer||{}).Trajectory=api;
})(typeof window!=='undefined'?window:globalThis);
