/* Stable-ID group definitions; only explicit local jobs receive coordinates. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MoleculeVisualizer.GroupConstraints=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const defaults=()=>({schema:'molecule-group-centers/1',enabled:false,mode:'relative',groups:[]});
  function config(state){
    const c=state.metadata?.groupConstraints||defaults();
    if(c.schema!=='molecule-group-centers/1'||typeof c.enabled!=='boolean'||!['relative','absolute','distances'].includes(c.mode)||!Array.isArray(c.groups)||c.groups.length>100||c.groups.some(g=>!g||typeof g.id!=='string'||!g.id||typeof g.label!=='string'||g.label.length>100||typeof g.enabled!=='boolean'||!Array.isArray(g.atomIds)||!g.atomIds.length||g.atomIds.some(id=>typeof id!=='string'||!id)||new Set(g.atomIds).size!==g.atomIds.length)||new Set(c.groups.map(g=>g.id)).size!==c.groups.length)throw Error('原子団の重心拘束の設定が不正です。「重心拘束をすべて解除」で指定し直してください。');
    return c;
  }
  function centers(positions,wire){
    return wire.groups.map(group=>{let total=0;const sum=[0,0,0];for(const i of group){const m=wire.masses[i],p=positions?.[i];if(!Number.isFinite(m)||m<.1||m>400||!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))throw Error('重心の座標・質量が不正です。');total+=m;for(let k=0;k<3;k++)sum[k]+=m*p[k];}return sum.map(v=>v/total);});
  }
  const values=(c,wire)=>wire.mode==='distances'?c.flatMap((p,i)=>c.slice(i+1).map(q=>[Math.hypot(...p.map((x,k)=>x-q[k]))])):wire.mode==='relative'&&c.length>1?c.slice(1).map(p=>p.map((x,k)=>x-c[0][k])):c;
  function forJob(state,data,info,massOf){
    const c=config(state);if(!c.enabled)return null;
    if(!['optimize','afir','scan'].includes(data.mode)||data.vibrations)throw Error('原子団の重心拘束はMIN・AFIR-MIN・緩和スキャン専用です。');
    const periodic=data.cell?.pbc.some(Boolean);
    if(periodic&&info&&info.periodicGroupImages!=='input-cartesian')throw Error('周期系の原子団拘束に対応するbridge.pyに更新して再接続してください。');
    if(info&&!info.groupConstraints)throw Error('原子団の重心拘束には最新のbridge.pyが必要です。差し替えて再起動・再接続してください。');
    if(JSON.stringify(state.atoms.map(a=>a.element))!==JSON.stringify(data.symbols))throw Error('重心拘束の原子対応には全構造の元素・File-orderの一致が必要です。');
    const ids=new Map(state.atoms.map((a,i)=>[a.id,i])),used=new Set();
    const groups=c.groups.filter(g=>g.enabled).map(g=>g.atomIds.map(id=>{if(!ids.has(id))throw Error('重心拘束に削除済みの原子があります。原子団を指定し直してください。');if(used.has(id))throw Error('重心拘束の原子団は重複しないように指定してください。');used.add(id);return ids.get(id);}));
    if(c.mode==='distances'&&groups.length<2)throw Error('重心間距離の固定には2原子団以上が必要です。');
    if(c.mode==='distances'&&!info?.advancedOptimization&&info)throw Error('重心間距離の固定にはbridge.py 1.12.0以降が必要です。');
    if(!groups.length)throw Error('重心拘束の対象原子団を1個以上有効にしてください。');
    const wire={mode:c.mode,groups,masses:state.atoms.map(massOf)};
    if(periodic)wire.imageConvention='input-cartesian';
    centers(data.images[0],wire);return wire;
  }
  function checkPositions(images,data){
    const c=data.groupConstraints;if(!c)return;
    const initial=values(c.referenceCenters||centers(data.images[0],c),c);
    if(!Array.isArray(images)||!images.length)throw Error('重心拘束の検証に必要な構造がありません。');
    for(const p of images){const actual=values(centers(p,c),c);if(actual.some((row,i)=>row.some((v,k)=>Math.abs(v-initial[i][k])>1e-7)))throw Error('原子団の重心拘束が保たれていない結果は使用できません。');}
  }
  function validateResult(result,data){
    const c=data.groupConstraints;if(!c)return;
    const r=result?.groupConstraints;
    if(!r||r.mode!==c.mode||r.imageConvention!==c.imageConvention||JSON.stringify(r.groups)!==JSON.stringify(c.groups)||JSON.stringify(r.masses)!==JSON.stringify(c.masses))throw Error('結果の原子団・質量・重心拘束条件が入力と一致しません。');
    if(!Array.isArray(r.referenceCenters)||r.referenceCenters.length!==c.groups.length||r.referenceCenters.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error('結果の重心拘束の参照座標が不正です。');
    const reference=values(centers(data.images[0],c),c),reported=values(r.referenceCenters,c);
    if(reference.some((p,i)=>p.some((v,k)=>Math.abs(v-reported[i][k])>1e-7)))throw Error('結果の重心拘束の参照座標が入力と一致しません。');
    checkPositions(result.images,data);if(result.trajectory)checkPositions(result.trajectory.images,data);
  }
  function attach(state,wire){
    if(!wire)return state;
    const previous=config(state),ids=wire.groups.map(indices=>indices.map(k=>state.atoms[k].id));
    if(previous.enabled&&previous.mode===wire.mode&&JSON.stringify(previous.groups.filter(g=>g.enabled).map(g=>g.atomIds))===JSON.stringify(ids))return state;
    state.metadata.groupConstraints={schema:'molecule-group-centers/1',enabled:true,mode:wire.mode,groups:wire.groups.map((indices,i)=>({id:'center-'+(i+1),label:'原子団 '+(i+1),enabled:true,atomIds:indices.map(k=>state.atoms[k].id)}))};
    return state;
  }
  function gatherSelectedImages(state,prepareMinimumImage){
    const cell=state.metadata.cell, atoms=state.atoms.filter(a=>state.selectedAtomIds.has(a.id));
    if(!cell?.pbc.some(Boolean)||atoms.length<2)throw Error('周期セル内の原子を2個以上選択してください。');
    const nearest=prepareMinimumImage(cell), origin=atoms[0];
    let moved=0;
    for(const atom of atoms.slice(1)){
      const {shift}=nearest([atom.x-origin.x,atom.y-origin.y,atom.z-origin.z]);
      if(shift.every(n=>n===0))continue;
      for(let i=0;i<3;i++){
        atom.x+=shift[i]*cell.vectors[i][0];
        atom.y+=shift[i]*cell.vectors[i][1];
        atom.z+=shift[i]*cell.vectors[i][2];
      }
      moved++;
    }
    return moved;
  }
  return {defaults,config,centers,values,forJob,checkPositions,validateResult,attach,gatherSelectedImages};
});
