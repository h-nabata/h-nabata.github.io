/* Fixed Cartesian coordinates: stable IDs in projects, zero-based indices on the wire. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MoleculeVisualizer.Constraints=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const defaults=()=>({schema:'molecule-fixed-atoms/1',enabled:false,fixedAtomIds:[]});
  function config(state){
    const c=state.metadata?.constraints||defaults();
    if(c.schema!=='molecule-fixed-atoms/1'||typeof c.enabled!=='boolean'||!Array.isArray(c.fixedAtomIds)||c.fixedAtomIds.some(id=>typeof id!=='string')||new Set(c.fixedAtomIds).size!==c.fixedAtomIds.length)throw Error('原子固定の設定が不正です。「すべて解除」で指定し直してください。');
    return c;
  }
  function indices(state){
    const c=config(state);if(!c.enabled)return [];
    if(c.fixedAtomIds.some(id=>!state.atoms.some(a=>a.id===id)))throw Error('固定対象に削除済みの原子があります。原子固定を指定し直してください。');
    const fixed=state.atoms.flatMap((a,i)=>c.fixedAtomIds.includes(a.id)?[i]:[]);
    if(fixed.length&&fixed.length===state.atoms.length)throw Error('全原子は固定できません。可動原子を1個以上残してください。');
    return fixed;
  }
  function parse(text,atoms){
    const set=new Set();
    for(const token of text.trim().split(/[\s,、]+/).filter(Boolean)){
      const match=/^(\d+)(?:-(\d+))?$/.exec(token);if(!match)throw Error('原子番号は「1, 4-8」の形式で指定してください。');
      const a=Number(match[1]),b=Number(match[2]||match[1]);
      if(a<1||b<a||b>atoms.length)throw Error(`原子番号は1〜${atoms.length}の範囲で指定してください。`);
      for(let n=a;n<=b;n++)set.add(atoms[n-1].id);
    }
    return [...set];
  }
  function forJob(state,data,info){
    const fixed=indices(state);if(!fixed.length)return [];
    if(!['optimize','afir','scan'].includes(data.mode)||data.vibrations)throw Error('原子固定はMIN・AFIR-MIN・緩和スキャン専用です。TS・IRC・経路計算・振動解析の前に固定をオフにしてください。');
    if(info&&!info.fixedAtoms)throw Error('原子固定を使うには、最新のbridge.pyに差し替えて再起動・再接続してください。');
    if(JSON.stringify(state.atoms.map(a=>a.element))!==JSON.stringify(data.symbols))throw Error('原子固定を一括計算へ適用するには、現在の構造と入力全構造の元素・File-orderを一致させてください。');
    return fixed;
  }
  function attach(frame,fixed){frame.metadata.constraints={schema:'molecule-fixed-atoms/1',enabled:fixed.length>0,fixedAtomIds:fixed.map(i=>frame.atoms[i].id)};return frame;}
  function checkPositions(images,initial,fixed){
    for(const p of images)for(const i of fixed)for(let k=0;k<3;k++)if(p?.[i]?.[k]!==initial[i][k])throw Error('固定原子の座標が変化した結果は使用できません。');
  }
  function validateResult(r,data){
    const fixed=data.fixedAtoms||[];if(!fixed.length)return;
    if(JSON.stringify(r.fixedAtoms)!==JSON.stringify(fixed))throw Error('結果の原子固定条件が入力と一致しません。');
    checkPositions(r.images,data.images[0],fixed);
    if(r.trajectory)checkPositions(r.trajectory.images,data.images[0],fixed);
  }
  return {defaults,config,indices,parse,forJob,attach,checkPositions,validateResult};
});
