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
  function validateSelection(source,selected){
    validate(source);
    if(!Array.isArray(selected)||!selected.length||selected.some((i,k)=>!Number.isInteger(i)||i<0||i>=source.images.length||(k>0&&i<=selected[k-1])))throw Error('出力するフレームの指定が不正です。');
  }
  function coordinates(source,i){return source.images[i].map((p,a)=>source.symbols[a]+' '+p.map(x=>x.toFixed(12)).join(' '));}
  function lup(source,selected){
    validateSelection(source,selected);
    return selected.map((i,k)=>[`# NODE ${k}`,...coordinates(source,i)].join('\n')).join('\n--\n')+'\n';
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
  const api={validate,distances,indices,xyz,lup};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  (global.MoleculeVisualizer=global.MoleculeVisualizer||{}).Trajectory=api;
})(typeof window!=='undefined'?window:globalThis);
