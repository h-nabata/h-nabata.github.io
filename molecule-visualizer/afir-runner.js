/* The only AFIR transport: explicit local engine requests, shared with NEB. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer;
  const connection=()=>MV.EngineUI.getConnection();
  const available=()=>!!connection()?.info?.modes?.includes('afir');
  function input(j){
    const s=j.original,c=j.config;MV.AFIR.validate(s.atoms,c,s.metadata.cell);
    return {...(j.modelInput||{}),...(j.internalConstraints?.length?{internalConstraints:j.internalConstraints}:{}),symbols:s.atoms.map(a=>a.element),atomIds:s.atoms.map(a=>a.id),images:[s.atoms.map(a=>[a.x,a.y,a.z])],cell:s.metadata.cell?{vectors:s.metadata.cell.vectors,pbc:s.metadata.cell.pbc}:null,
      ...(MV.Constraints?.indices(s).length?{fixedAtoms:MV.Constraints.indices(s)}:{}),mode:'afir',charge:c.charge,multiplicity:c.multiplicity,maxSteps:c.maxSteps,fmax:c.fmax,maxMove:c.maxMove,afir:c};
  }
  function validateResult(r,j){
    const data=input(j),n=data.symbols.length;
    MV.Constraints?.validateResult(r,data);
    MV.EngineUI.validateSolvationResult(r,data);
    if(!r||r.schema!=='molecule-afir-trajectory/1'||r.validation!=='biased-trajectory-not-ts'||JSON.stringify(r.atomIds)!==JSON.stringify(data.atomIds)||JSON.stringify(r.symbols)!==JSON.stringify(data.symbols)||JSON.stringify(r.cell)!==JSON.stringify(data.cell)||r.charge!==data.charge||r.multiplicity!==data.multiplicity||r.units?.energy!=='eV'||r.units?.length!=='angstrom'||r.units?.force!=='eV/angstrom'||!r.conditionId||!['converged','step_limit','cancelled','failed'].includes(r.reason)||r.converged!==(r.reason==='converged'))throw Error('AFIR結果の原子対応・計算条件・単位・検証状態が一致しません。');
    if(!Array.isArray(r.images)||r.images.length<1||r.images.length>data.maxSteps+1||r.steps!==r.images.length-1||!Number.isInteger(r.evaluations)||r.evaluations<r.images.length||!r.images.every(p=>Array.isArray(p)&&p.length===n&&p.every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000))))throw Error('AFIR構造列が不正です。');
    for(const key of ['energies','biasEnergies','biasedEnergies','imageFmax','physicalFmax'])if(!Array.isArray(r[key])||r[key].length!==r.images.length||!r[key].every(Number.isFinite))throw Error('AFIRのエネルギー・力の配列が不正です。');
    if(!Array.isArray(r.forces)||r.forces.length!==r.images.length||r.forces.some(p=>!Array.isArray(p)||p.length!==n||p.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))))throw Error('AFIRの物理的な力の配列が不正です。');
    if(!Number.isFinite(r.effectiveFmax)||Math.abs(r.effectiveFmax-r.imageFmax.at(-1))>1e-10||(r.converged&&r.effectiveFmax>data.fmax))throw Error('AFIRの収束判定が一致しません。');
    const initial=r.constraintProjection?.positions||data.images[0];
    if(r.constraintProjection&&(!data.internalConstraints?.length||JSON.stringify(r.constraintProjection.inputPositions)!==JSON.stringify(data.images[0])))throw Error('拘束前の入力構造が一致しません。');
    for(let i=0;i<n;i++)for(let k=0;k<3;k++)if(Math.abs(r.images[0][i][k]-initial[i][k])>1e-10)throw Error('AFIR軌跡の始点が入力構造と一致しません。');
    // Independently recompute every artificial energy from IDs and coordinates.
    r.images.forEach((p,i)=>{const atoms=j.original.atoms.map((a,k)=>({...a,x:p[k][0],y:p[k][1],z:p[k][2]})),bias=MV.AFIR.evaluate(atoms,j.config).energyEV;if(Math.abs(bias-r.biasEnergies[i])>1e-7||Math.abs(r.energies[i]+r.biasEnergies[i]-r.biasedEnergies[i])>1e-7)throw Error('AFIRの人工項と物理エネルギーの対応が一致しません。');});
  }
  async function run(j,progress){
    if(!available())throw Error('AFIRに対応したローカルサービス1.1.0以降へ接続してください。');
    j.modelInput=MV.EngineUI.modelInput();
    j.internalConstraints=MV.ResearchUI?.constraintsInput(j.original,'afir')||[];
    j.connection=connection();j.connection.url=MV.EngineUI.endpoint(j.connection.url);
    MV.EngineUI.validateEngineInput(input(j),j.connection.info);
    if(j.config.maxSteps>(j.connection.info.maxAFIRSteps??500))throw Error('指定したAFIRステップ数に対応するため、bridge.pyを更新・再起動して再接続してください。');
    MV.Constraints?.forJob(j.original,input(j),j.connection.info);
    progress('このPCの計算エンジンで探索を開始しています…');
    try{
      const created=await MV.EngineUI.request(j.connection,'/api/jobs',input(j));if(!/^[a-f0-9]{32}$/.test(created.id))throw Error('計算IDが不正です。');j.id=created.id;
      if(j.cancelled)await cancel(j);
      while(true){
        const live=j.livePreview&&MV.EnergyProfile?.following();
        const state=MV.EngineUI.pollJob?await MV.EngineUI.pollJob(j,live):await MV.EngineUI.request(j.connection,`/api/jobs/${j.id}`+(live?`?preview=1&after=${j.previewCursor||0}`:''));
        if(state.status==='completed'||state.status==='cancelled'||state.status==='error'){
          if(state.result){validateResult(state.result,j);return state.result;}
          if(state.status==='error')throw Error(state.error||'計算エンジンが失敗しました。');return null;
        }
        const p=state.progress||{};progress((p.phase==='loading_model'?'UMAモデルを読み込み中（初回はダウンロードを含みます）…':`AFIR探索中: ${p.step??0} / ${j.config.maxSteps} ステップ`)+(p.fmax!=null?` · 最大有効力 ${p.fmax.toPrecision(4)} eV/Å`:'')+(j.cancelled||state.status==='stopping'?' · 停止処理中':''),state.preview);
        MV.DiagnosticsUI?.update(p,{mode:'afir',data:input(j),jobId:j.id});
        await new Promise(resolve=>setTimeout(resolve,600));
      }
    }catch(e){throw Error(e.message+(j.id?' 接続が途切れた場合はローカル端末でCtrl+Cを押して停止できます。':''));}
  }
  async function cancel(j){j.cancelled=true;if(j.id)await MV.EngineUI.request(j.connection,`/api/jobs/${j.id}/cancel`,{});}
  MV.AFIRRunner={available,input,validateResult,run,cancel};
})(window);
