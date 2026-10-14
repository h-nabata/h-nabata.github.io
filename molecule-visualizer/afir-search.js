/* Browser-compatible AFIR/FIRE solver. A physical energy/force provider is required.
 * This module neither chooses a potential nor performs network requests.
 * The caller supplies an asynchronous evaluator (normally backed by a Worker).
 */
(function(root){
  'use strict';
  const A=typeof module!=='undefined'&&module.exports?require('./afir.js'):root.MoleculeVisualizer.AFIR;
  function checkPhysical(value,request,conditionId){
    if(!value||value.converged!==true||value.conditionId!==conditionId||JSON.stringify(value.atomIds)!==JSON.stringify(request.atomIds))throw Error('物理計算の収束状態・計算条件・原子IDが一致しません。');
    if(!Number.isFinite(value.energyEV)||!Array.isArray(value.forcesEV_A)||value.forcesEV_A.length!==request.atomIds.length||value.forcesEV_A.some(f=>!Array.isArray(f)||f.length!==3||!f.every(Number.isFinite)))throw Error('物理計算が有限のエネルギー・力を返しませんでした。');
  }
  async function optimize({atoms,config,potential,signal,onProgress=()=>{}}){
    const resolved=A.validate(atoms,config),reference=JSON.parse(JSON.stringify(atoms)),settings=JSON.parse(JSON.stringify(config));
    if(!potential||typeof potential.evaluate!=='function'||!potential.conditionId||!potential.name||!potential.method||potential.units?.energy!=='eV'||potential.units?.force!=='eV/angstrom'||potential.units?.length!=='angstrom')throw Error('物理ポテンシャルの識別情報・eV/Å単位の評価器が必要です。');
    const conditionId=potential.conditionId,velocity=atoms.map(()=>[0,0,0]);let dt=.05,mix=.1,positive=0,current=reference.map(a=>({...a})),reason='step_limit';
    const images=[],energies=[],biasEnergies=[],biasedEnergies=[],forces=[],imageFmax=[],physicalFmax=[];
    for(let step=0;step<=settings.maxSteps;step++){
      if(signal?.aborted){reason='cancelled';break;}
      for(let i=0;i<current.length;i++)for(let j=i+1;j<current.length;j++)if(Math.hypot(current[i].x-current[j].x,current[i].y-current[j].y,current[i].z-current[j].z)<.1)throw Error('探索中に0.1 Å未満の原子衝突を検出しました。');
      const request={atomIds:resolved.atomIds.slice(),symbols:current.map(a=>a.element),positions:current.map(a=>[a.x,a.y,a.z]),charge:settings.charge,multiplicity:settings.multiplicity};
      const physical=await potential.evaluate(JSON.parse(JSON.stringify(request)),{signal});checkPhysical(physical,request,conditionId);
      if(potential.conditionId!==conditionId)throw Error('探索中に物理ポテンシャルの計算条件が変更されました。');
      const bias=A.evaluate(current,settings),effective=physical.forcesEV_A.map((f,i)=>f.map((v,k)=>v+bias.forcesEV_A[i][k]));
      const fmax=Math.max(...effective.map(f=>Math.hypot(...f)));
      images.push(request.positions);energies.push(physical.energyEV);biasEnergies.push(bias.energyEV);biasedEnergies.push(physical.energyEV+bias.energyEV);forces.push(physical.forcesEV_A.map(f=>f.slice()));imageFmax.push(fmax);physicalFmax.push(Math.max(...physical.forcesEV_A.map(f=>Math.hypot(...f))));
      await onProgress({step,energyEV:physical.energyEV,biasEnergyEV:bias.energyEV,effectiveFmax:fmax});
      if(signal?.aborted){reason='cancelled';break;}
      if(fmax<=settings.fmax){reason='converged';break;}if(step===settings.maxSteps)break;
      let power=0,vsq=0,fsq=0;
      for(let i=0;i<current.length;i++)for(let k=0;k<3;k++){velocity[i][k]+=dt*effective[i][k];power+=velocity[i][k]*effective[i][k];vsq+=velocity[i][k]**2;fsq+=effective[i][k]**2;}
      if(power>0){positive++;if(positive>5){dt=Math.min(dt*1.1,.5);mix*=.99;}const ratio=Math.sqrt(vsq/Math.max(fsq,1e-300));for(let i=0;i<current.length;i++)for(let k=0;k<3;k++)velocity[i][k]=(1-mix)*velocity[i][k]+mix*ratio*effective[i][k];}
      else{positive=0;dt*=.5;mix=.1;velocity.forEach(v=>v.fill(0));}
      const maxDisplacement=Math.max(...velocity.map(v=>dt*Math.hypot(...v))),scale=Math.min(1,settings.maxMove/Math.max(maxDisplacement,1e-300));
      current=current.map((a,i)=>({...a,x:a.x+dt*velocity[i][0]*scale,y:a.y+dt*velocity[i][1]*scale,z:a.z+dt*velocity[i][2]*scale}));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return {schema:'molecule-afir-trajectory/1',engine:potential.name,method:potential.method,conditionId,atomIds:resolved.atomIds,symbols:reference.map(a=>a.element),charge:settings.charge,multiplicity:settings.multiplicity,
      images,energies,biasEnergies,biasedEnergies,forces,imageFmax,physicalFmax,effectiveFmax:imageFmax.at(-1)??null,steps:Math.max(0,images.length-1),evaluations:images.length,reason,converged:reason==='converged',validation:'biased-trajectory-not-ts',units:{length:'angstrom',energy:'eV',force:'eV/angstrom'}};
  }
  const api={optimize,checkPhysical};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MoleculeVisualizer.AFIRSearch=api;
})(typeof window!=='undefined'?window:globalThis);
