/* Optimization definitions use stable atom IDs; wire inputs use file order. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MoleculeVisualizer.Optimization=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const defaults=()=>({coordinates:[],internalEnabled:false,fixedComponents:[],rigidGroups:[]});
  const clone=x=>JSON.parse(JSON.stringify(x));
  function config(s){const c={...defaults(),...s.metadata?.optimization};for(const k of ['coordinates','fixedComponents','rigidGroups'])if(!Array.isArray(c[k])||c[k].length>500)throw Error('最適化の拘束設定が不正です。');return c;}
  function indices(s,ids){if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('拘束の原子指定が不正です。');return ids.map(id=>{const i=s.atoms.findIndex(a=>a.id===id);if(i<0)throw Error('拘束対象の原子が削除されています。拘束一覧を確認してください。');return i;});}
  function directionInputs(state){
    const rows=config(state).fixedComponents.filter(x=>x.enabled!==false);
    return rows.map(x=>{
      if(!Array.isArray(x.axes)||x.axes.length!==3||!x.axes.every(v=>typeof v==='boolean')||!x.axes.some(Boolean))throw Error('固定する方向を指定してください。');
      if(x.basis&&!['fractional','cartesian'].includes(x.basis))throw Error('方向固定の座標系が不正です。');
      return {atom:indices(state,[x.atomId])[0],axes:x.axes.slice(),...(x.basis==='fractional'?{basis:x.basis}:{})};
    }).sort((a,b)=>a.atom-b.atom);
  }
  function forJob(s,data,info,frames=[]){
    if(data.mode==='evaluate')return;
    const whole=new Set(data.fixedAtoms||[]);
    const sets=[s,...frames].map(state=>({state,rows:directionInputs(state).filter(x=>!whole.has(x.atom))})).filter(x=>x.rows.length);
    const fixed=sets[0]?.rows||[],rigid=config(s).rigidGroups.filter(x=>x.enabled!==false);
    if(!fixed.length&&!rigid.length)return;
    if(!['optimize','afir','scan'].includes(data.mode)||data.vibrations)throw Error('方向固定・剛体拘束はMIN・AFIR-MIN・スキャン専用です。');
    if(info!==null&&!info?.advancedOptimization)throw Error('方向固定・剛体拘束にはbridge.py 1.12.0以降が必要です。');
    if(fixed.some(x=>x.basis==='fractional')&&(!data.cell||(info!==null&&!info?.fractionalFixedComponents)))throw Error('分率座標の方向固定には固定セルと対応するbridge.pyが必要です。');
    if(sets.some(x=>JSON.stringify(x.rows)!==JSON.stringify(fixed)))throw Error('入力構造の間で方向固定が異なります。共通の拘束を指定してください。');
    if(data.symbols&&sets.some(x=>JSON.stringify(x.state.atoms.map(a=>a.element))!==JSON.stringify(data.symbols)))throw Error('方向固定には共通の原子数・元素順序が必要です。');
    data.fixedComponents=fixed;
    if(rigid.length&&data.cell?.pbc.some(Boolean)){
      if(info!==null&&info?.periodicGroupImages!=='input-cartesian')throw Error('周期系の剛体原子団に対応するbridge.pyに更新して再接続してください。');
      data.rigidGroupImages='input-cartesian';
    }
    data.rigidGroups=rigid.map(x=>indices(s,x.atomIds));
  }
  function attach(s,data){const c=defaults();c.coordinates=(data.internalConstraints||[]).map((x,i)=>({id:'restored-coordinate-'+i,type:x.type,value:x.value,atomIds:x.atoms.map(k=>s.atoms[k].id),enabled:true}));c.internalEnabled=!!c.coordinates.length;c.fixedComponents=(data.fixedComponents||[]).map((x,i)=>({id:'restored-direction-'+i,atomId:s.atoms[x.atom].id,axes:x.axes.slice(),basis:x.basis||'cartesian',enabled:true}));c.rigidGroups=(data.rigidGroups||[]).map((x,i)=>({id:'restored-rigid-'+i,atomIds:x.map(k=>s.atoms[k].id),enabled:true}));s.metadata.optimization=c;return s;}
  function rememberCoordinates(s,data){const c=clone(config(s));if(data.internalConstraints?.length){const entries=data.internalConstraints.map((x,i)=>{const ids=x.atoms.map(k=>s.atoms[k].id),previous=c.coordinates.find(y=>y.type===x.type&&JSON.stringify(y.atomIds)===JSON.stringify(ids));return {id:previous?.id||'input-coordinate-'+i,type:x.type,value:x.value,atomIds:ids,enabled:true};});c.coordinates=[...entries,...c.coordinates.filter(x=>x.enabled===false&&!entries.some(y=>y.id===x.id))];c.internalEnabled=true;}else c.internalEnabled=false;s.metadata.optimization=c;return s;}
  function checkPositions(images,data){for(const p of images){for(const c of data.fixedComponents||[]){
      const delta=p[c.atom].map((value,k)=>value-data.images[0][c.atom][k]);
      const lattice=data.cell?.vectors;
      for(let k=0;k<3;k++)if(c.axes[k]){
        const diff=c.basis==='fractional'?det(lattice.map((v,i)=>i===k?delta:v))/det(lattice):delta[k];
        if(!Number.isFinite(diff)||Math.abs(diff)>1e-8)throw Error('方向固定が保たれていない結果です。');
      }
    }for(const group of data.rigidGroups||[])for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){const distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));if(Math.abs(distance(p[group[i]],p[group[j]])-distance(data.images[0][group[i]],data.images[0][group[j]]))>1e-6)throw Error('剛体原子団の形状が保たれていません。');}}}
  const det=a=>a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])-a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0])+a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
  const near=(a,b,tol=1e-8)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>Array.isArray(x)?near(x,b[i],tol):Number.isFinite(x)&&Math.abs(x-b[i])<=tol);
  function validCell(cell){return cell&&Array.isArray(cell.vectors)&&cell.vectors.length===3&&cell.vectors.every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))&&Math.abs(det(cell.vectors))>1e-6&&Array.isArray(cell.pbc)&&cell.pbc.length===3&&cell.pbc.every(v=>typeof v==='boolean');}
  function checkCell(cell,data){
    const c=data.mode==='md'&&data.md?.ensemble==='npt'?{mode:'isotropic'}:data.cellOptimization,base=data.cell;
    if(!c||c.mode==='fixed'){if((!!cell!==!!base)||JSON.stringify(cell?.vectors)!==JSON.stringify(base?.vectors)||JSON.stringify(cell?.pbc)!==JSON.stringify(base?.pbc))throw Error('固定セルが変化しています。');return;}
    if(!validCell(cell)||JSON.stringify(cell.pbc)!==JSON.stringify(base.pbc)||det(cell.vectors)*det(base.vectors)<=0)throw Error('計算結果のセルが不正です。');
    const a=base.vectors,b=cell.vectors,mode=c.mode;
    if(mode==='full')return;
    const scales=a.map((v,i)=>b[i].reduce((sum,x,k)=>sum+x*v[k],0)/v.reduce((sum,x)=>sum+x*x,0));
    if(mode==='c_vector'){if(!near(b.slice(0,2),a.slice(0,2)))throw Error('a・bベクトルが変化しています。');return;}
    if(scales.some(x=>x<=0)||!a.every((v,i)=>near(v.map(x=>x*scales[i]),b[i])))throw Error('格子角・格子方向が変化しています。');
    if(mode==='isotropic'&&!near(scales,[scales[0],scales[0],scales[0]]))throw Error('相似伸縮の倍率が一致しません。');
    if(mode==='ab'&&(!near([scales[0]],[scales[1]])||Math.abs(scales[2]-1)>1e-8))throw Error('ab面の相似伸縮条件が不正です。');
    if(['a','b','c'].includes(mode)&&scales.some((v,i)=>i!=='abc'.indexOf(mode)&&Math.abs(v-1)>1e-8))throw Error('固定した格子ベクトルが変化しています。');
  }
  function validateResult(r,data){if(data.rigidGroupImages&&r.rigidGroupImages!==data.rigidGroupImages)throw Error('結果の剛体拘束の周期像条件が入力と一致しません。');checkPositions(r.images,data);if(r.trajectory)checkPositions(r.trajectory.images,data);checkCell(r.cell,data);
    if(data.cellOptimization?.mode&&data.cellOptimization.mode!=='fixed'){
      if(JSON.stringify(r.cellOptimization)!==JSON.stringify(data.cellOptimization)||!Array.isArray(r.trajectory?.cells)||r.trajectory.cells.length!==r.trajectory.images.length)throw Error('セル最適化の条件・格子履歴が一致しません。');
      r.trajectory.cells.forEach(c=>checkCell(c,data));if(!near(r.cell.vectors,r.trajectory.cells.at(-1).vectors))throw Error('最終セルと履歴が一致しません。');
      if(!Number.isFinite(r.stressResidual)||r.stressResidual<0||r.converged&&r.stressResidual>data.cellOptimization.stressTolerance)throw Error('応力の収束状態が不正です。');
    }
  }
  return {defaults,config,indices,forJob,attach,rememberCoordinates,checkPositions,checkCell,validateResult,validCell,cellVolume:c=>Math.abs(det(c.vectors)),near,clone};
});
