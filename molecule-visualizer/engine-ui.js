/* Local-only external energy/gradient jobs. Tokens live in memory, never in projects. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),app=()=>MV.App;
  let connection=null,job=null,result=null;
  let settingsMode=null;
  const modeSettings=new Map(),relaxFields=['engineSteps','engineFmax','engineMove','engineSpring','engineClimb'];
  const fingerprint=s=>JSON.stringify([s.atoms,s.bonds,s.metadata]);
  const dirty=()=>/未適用|編集中/.test($('xyzEditStatus').textContent);
  const message=text=>{$('engineMessage').textContent=text;};
  const modeText={evaluate:'エネルギー・力の評価',optimize:'単一構造の最適化',perpendicular:'接線に直交する緩和',neb:'NEB',cineb:'CI-NEB',ts:'Sella TS最適化',vibrations:'振動解析'};
  function endpoint(value){
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('接続先は http://127.0.0.1:8766 など、このPCのlocalhost URLにしてください。');
    return url.origin;
  }
  async function request(c,path,body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(c.url+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+c.token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
      const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);return data;
    }catch(error){if(error.name==='TypeError'||error.name==='AbortError')throw Error('ローカルサービスに接続できません。起動状態・URL・許可Origin・ブラウザのローカルネットワーク許可を確認してください。接続が遮断される場合は --site-dir で画面もローカル配信できます。');throw error;}finally{clearTimeout(timer);}
  }
  function busy(value){$('engineSettings').disabled=value;$('engineConnection').disabled=value;$('engineRun').disabled=value||!connection;$('engineCancel').disabled=!value;$('engineClose').disabled=false;$('engineLive').disabled=value;$('enginePause').disabled=!value||!connection?.info.pathCheckpoint;MV.BatchUI?.render();MV.ConstraintUI?.sync();}
  function settings(){
    const mode=$('engineMode').value,path=['perpendicular','neb','cineb'].includes(mode),single=['optimize','ts','vibrations'].includes(mode),batch=mode==='batch';
    if(mode!==settingsMode){
      if(settingsMode)modeSettings.set(settingsMode,relaxFields.map(id=>$(id).value));
      const values=modeSettings.get(mode)||(mode==='cineb'?['100','0.05','0.03','1','5']:['150','0.05','0.04','1','5']);
      relaxFields.forEach((id,i)=>{$(id).value=values[i];});settingsMode=mode;
    }
    if(path)$('engineScope').value='all';if(single)$('engineScope').value='current';$('engineScope').disabled=path||single||batch;$('engineScope').closest('label').hidden=batch;$('batchInput').hidden=!batch;
    $('engineRelaxSettings').hidden=['evaluate','vibrations'].includes(mode);$('engineSpringLabel').hidden=!['neb','cineb'].includes(mode);$('engineClimbLabel').hidden=mode!=='cineb';
    $('engineOptimizerLabel').hidden=!['optimize','batch'].includes(mode);$('engineTSMethodLabel').hidden=$('engineTrustLabel').hidden=mode!=='ts';$('engineMoveLabel').hidden=mode==='ts';
    $('engineVibrationOptions').hidden=!single;$('engineVibrationCheckLabel').hidden=mode==='vibrations';$('enginePause').hidden=!['neb','cineb'].includes(mode);
    $('engineModeHelp').textContent={batch:'複数構造を同じ条件で、1構造ずつ独立に最適化します。人工力や経路のばねは加えません。',evaluate:'指定構造のエネルギーと力を計算します。',optimize:'現在の構造を極小化します。人工力は「AFIR法の設定を開く」で指定してください。',ts:'Sellaで一次鞍点を探索します。経路の結果表からTS候補を選べます。人工力・ばねは加えません。',vibrations:'現在の構造でASEの有限差分振動解析を行います。未収束構造も解析できます。',perpendicular:'端点を固定し、経路の接線に直交する力で緩和します。',neb:'端点を固定して経路を緩和します。一時停止してノードを追加できます。',cineb:'端点固定。CI開始後は最高エネルギーの内部ノードを登らせます。一時停止してノードを追加できます。'}[mode];
  }
  function chooseMode(){
    if($('engineMode').value!=='afir'){settings();return;}
    // AFIR has its own fragment pairs and conditions; selecting it only opens setup.
    $('engineMode').value='optimize';settings();$('engineDialog').close();MV.AFIRUI.toggle(true);
    $('afirPanel').scrollIntoView({block:'nearest',behavior:'smooth'});$('afirName').focus({preventScroll:true});
  }
  function frames(state,scope){
    if(scope==='current'||!state.metadata.trajectory)return [MV.Periodic.snapshot(state)];
    const all=JSON.parse(JSON.stringify(state.metadata.trajectory));all[state.metadata.frameIndex||0]=MV.Periodic.snapshot(state);return all;
  }
  function input(batchFrames){
    MV.ConstraintUI?.flush();
    if(dirty())throw Error('座標編集欄の未適用データを先に適用するか、現在の構造を再表示してください。');
    if(!batchFrames&&$('engineScope').value==='current')app().useDisplayedStructure();
    const state=app().getState(),all=batchFrames||frames(state,$('engineScope').value),mode=batchFrames?'optimize':$('engineMode').value;
    const symbols=all[0].atoms.map(a=>a.element),cell=all[0].metadata.cell||null;
    if(!symbols.length||symbols.length>500||all.length>(batchFrames?100:connection.info.maxImages||20))throw Error(`外部計算は1〜500原子、最大${connection.info.maxImages||20}構造です。必要に応じてbridge.pyを更新してください。`);
    if(['perpendicular','neb','cineb'].includes(mode)&&all.length<3)throw Error('先に「反応経路」で端点を含む3〜100構造を生成するか、複数構造XYZなどを読み込んでください。');
    for(const f of all){
      if(JSON.stringify(f.atoms.map(a=>a.element))!==JSON.stringify(symbols))throw Error('全フレームの元素とFile-orderを一致させてください。');
      if(JSON.stringify(f.metadata.cell||null)!==JSON.stringify(cell))throw Error('経路全体で同じセル・周期方向が必要です。可変セル計算には対応していません。');
      if(f.atoms.some(a=>a.xyzExtras?.occupancy&&Number(a.xyzExtras.occupancy.values[0])!==1))throw Error('部分占有サイトがあります。計算前に占有を確定した構造にしてください。');
    }
    if(cell?.pbc.some(Boolean)&&!connection.info.periodic)throw Error('接続中のエンジンは周期系に対応していません。tbliteでサービスを起動してください。');
    const data={symbols,images:all.map(f=>f.atoms.map(a=>[a.x,a.y,a.z])),cell,mode,charge:Number($('engineCharge').value),multiplicity:Number($('engineMultiplicity').value),maxSteps:Number($('engineSteps').value),fmax:Number($('engineFmax').value),spring:Number($('engineSpring').value),maxMove:Number($('engineMove').value),climbAfter:Number($('engineClimb').value)};
    for(const [key,lo,hi,integer] of [['charge',-100,100,true],['multiplicity',1,101,true],['maxSteps',1,10000,true],['fmax',.00001,10,false],['spring',.001,10,false],['maxMove',.001,.2,false],['climbAfter',0,500,true]])if(!Number.isFinite(data[key])||data[key]<lo||data[key]>hi||(integer&&!Number.isInteger(data[key])))throw Error(`${key}は${lo}〜${hi}${integer?'の整数':''}にしてください。`);
    if(['ts','vibrations'].includes(mode)&&!connection.info.modes.includes(mode))throw Error('TS・振動解析にはbridge.pyを更新・再接続してください。');
    if(mode==='ts'){
      if(!connection.info.sellaVersion)throw Error('接続中のPythonにSellaがありません。python -m pip install "sella>=2.6,<3" を実行し、再接続してください。');
      data.optimizer=$('engineTSMethod').value;data.trustRadius=Number($('engineTrust').value);
      if(!Number.isFinite(data.trustRadius)||data.trustRadius<.001||data.trustRadius>.2)throw Error('初期信頼半径は0.001〜0.2 Åにしてください。');
    }
    if(mode==='optimize'&&$('engineOptimizer').value!=='fire'){
      if(!connection.info.modes.includes('ts'))throw Error('L-BFGS・BFGSを使うにはbridge.pyを更新してください。');
      data.optimizer=$('engineOptimizer').value;
    }
    if(mode==='vibrations'||(!batchFrames&&['ts','optimize'].includes(mode)&&$('engineVibrationCheck').checked)){
      if(!connection.info.vibrations)throw Error('振動解析を使うにはbridge.pyを更新してください。');
      if(symbols.length>(connection.info.maxVibrationAtoms||200))throw Error('振動解析は最大200原子です。');
      if(all[0].atoms.some(a=>a.mol?.props?.MASS||a.xyzExtras?.mass||a.xyzExtras?.masses))throw Error('この振動解析はASE標準原子質量を使用します。同位体・個別質量を持つ構造には未対応です。');
      data.vibrations={delta:Number($('engineVibrationDelta').value),nfree:Number($('engineVibrationNfree').value),imaginaryThreshold:Number($('engineVibrationThreshold').value)};
      const v=data.vibrations;if(!Number.isFinite(v.delta)||v.delta<.0001||v.delta>.1||![2,4].includes(v.nfree)||!Number.isFinite(v.imaginaryThreshold)||v.imaginaryThreshold<0||v.imaginaryThreshold>1000)throw Error('振動解析の変位幅は0.0001〜0.1 Å、差分点数は2/4、虚振動の閾値は0〜1000 cm⁻¹です。');
    }
    if((mode==='ts'||data.vibrations)&&cell?.pbc.some(Boolean))throw Error('TS・振動モード表示は非周期分子用です。');
    const fixed=MV.Constraints.forJob(state,data,connection.info);
    if(fixed.length){data.fixedAtoms=fixed;all.forEach(f=>MV.Constraints.attach(f,fixed));}
    if(connection.info.vibrations)data.atomIds=all[0].atoms.map(a=>a.id);
    if(data.maxSteps>(connection.info.maxSteps??1000))throw Error('指定したステップ数に対応するため、bridge.pyを更新・再起動して再接続してください。');
    if(mode==='cineb'&&data.climbAfter>=data.maxSteps)throw Error('CI開始ステップを最大ステップ数より小さくしてください。');
    return {data,frames:all,scope:$('engineScope').value,fingerprint:fingerprint(state),original:MV.Model.cloneState(state)};
  }
  async function connect(){
    if(job)return;connection=null;$('engineRun').disabled=true;$('engineConnect').disabled=true;
    try{
      const c={url:endpoint($('engineURL').value),token:$('engineToken').value.trim()};if(!c.token)throw Error('サービス起動時に表示されるTokenを入力してください。');
      c.info=await request(c,'/api/info');if(!['1.0.0','1.1.0','1.1.1','1.1.2','1.2.0','1.3.0','1.4.0','1.5.0'].includes(c.info.version)||!Array.isArray(c.info.modes))throw Error('サービスのバージョンが一致しません。最新のbridge.pyを使用してください。');connection=c;
      $('engineConnected').textContent=`接続済み: ${c.info.engine} / ${c.info.method} · ${c.info.engineVersion} · ${c.info.periodic?'固定セル周期系対応':'非周期系'} · Sella ${c.info.sellaVersion||'未導入'}`;message('接続しました。電荷と多重度を確認して計算を実行してください。');
    }catch(error){$('engineConnected').textContent='未接続';message(error.message);}finally{$('engineConnect').disabled=false;busy(false);MV.AFIRUI?.sync();}
  }
  function clearResult(){result=null;$('engineResult').hidden=true;$('engineApply').disabled=true;$('engineDownload').disabled=true;}
  function validateResult(r,j){
    MV.Constraints?.validateResult(r,j.data);
    if(!r||JSON.stringify(r.symbols)!==JSON.stringify(j.data.symbols)||JSON.stringify(r.cell)!==JSON.stringify(j.data.cell)||r.images?.length!==j.frames.length||r.energies?.length!==j.frames.length||r.units?.energy!=='eV'||r.units?.length!=='angstrom')throw Error('結果の元素・セル・構造数・単位が入力と一致しません。');
    if(!r.images.every(p=>Array.isArray(p)&&p.length===j.data.symbols.length&&p.every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000)))||!r.energies.every(Number.isFinite)||!Number.isFinite(r.effectiveFmax)||!Array.isArray(r.imageFmax)||r.imageFmax.length!==j.frames.length||!r.imageFmax.every(Number.isFinite))throw Error('計算結果に不正な座標・エネルギー・力が含まれます。');
    if(['perpendicular','neb','cineb'].includes(j.data.mode))for(const i of [0,j.frames.length-1])if(JSON.stringify(r.images[i])!==JSON.stringify(j.data.images[i]))throw Error('端点座標が変更された結果は適用できません。');
    if(['optimize','ts'].includes(j.data.mode)){
      if(!r.trajectory){if(j.connection?.info.optimizationTrajectory)throw Error('最適化の構造履歴がありません。');return;}
      const t=r.trajectory;if(!Array.isArray(t.energies))throw Error('最適化履歴のエネルギーがありません。');MV.Trajectory.validate({...t,symbols:r.symbols});
      if(!Number.isInteger(r.steps)||r.steps<0||r.steps>j.data.maxSteps||t.images.length!==r.steps+1||JSON.stringify(t.images[0])!==JSON.stringify(j.data.images[0])||JSON.stringify(t.images.at(-1))!==JSON.stringify(r.images[0])||t.energies.at(-1)!==r.energies[0])throw Error('最適化の履歴・始点・最終構造が一致しません。');
    }
  }
  function showResult(r,j){
    validateResult(r,j);if(r.vibrations?.status==='completed')MV.VibrationUI.validate(r.vibrations,r.symbols,r.images[0]);result={...j,result:r};$('engineResult').hidden=false;$('engineApply').disabled=false;$('engineDownload').disabled=false;
    const reason=r.mode==='vibrations'?(r.vibrations?.status==='completed'?'振動解析完了':'振動解析未完了（構造評価は完了）'):{converged:'収束',step_limit:'ステップ上限（未収束）',evaluated:'評価完了',cancelled:'中止（途中結果）',failed:'計算失敗（途中結果）'}[r.reason]||r.reason;
    $('engineResultSummary').textContent=`${modeText[r.mode]} · ${reason} · ${r.steps}ステップ · ${r.evaluations}回の評価 · 最大有効力 ${r.effectiveFmax.toPrecision(4)} eV/Å${j.data.fixedAtoms?.length?'（可動原子のみ） · 固定 '+j.data.fixedAtoms.length+'原子':''}`+(r.maxTangentialStep!=null?` · 接線方向の最大更新 ${r.maxTangentialStep.toExponential(2)} Å`:'');
    const body=$('engineEnergyRows');body.replaceChildren();r.energies.forEach((energy,i)=>{
      const tr=document.createElement('tr'),path=['perpendicular','neb','cineb'].includes(r.mode),fixed=path&&(i===0||i===r.energies.length-1),peak=path&&i>0&&i<r.energies.length-1&&energy>r.energies[i-1]&&energy>=r.energies[i+1];
      for(const value of [i+1,energy.toFixed(8),(energy-r.energies[0]).toFixed(6),fixed?'端点固定':r.imageFmax[i].toPrecision(4)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
      const td=document.createElement('td');td.textContent=i===r.climbingImage?'CI ':peak?'極大候補 ':'';
      const button=document.createElement('button');button.className='mv-btn';button.textContent='TS入力';button.setAttribute('aria-label',`構造${i+1}をTS入力にする`);button.addEventListener('click',()=>{if(apply(i))prepareSingle('ts');});td.append(button);tr.append(td);body.append(tr);
    });
    $('engineRefine').hidden=!['perpendicular','neb','cineb'].includes(r.mode);
    $('engineVibrationShow').hidden=r.vibrations?.status!=='completed';
    $('engineVibrationStatus').textContent=r.vibrations?(r.vibrations.status==='completed'?`振動解析完了 · ${r.vibrations.settings.imaginaryThreshold} cm⁻¹超の虚振動 ${r.vibrations.significantImaginaryCount}本（全モードは表を表示）`:'振動解析は未完了: '+r.vibrations.error+' 構造の結果は保持しています。'):(r.mode==='ts'?'振動解析は未実施です。力の収束だけではTSは確定しません。':'');
    if(r.vibrations?.status==='completed'){
      const state=MV.Model.createState(j.frames[0]);state.atoms.forEach((a,k)=>{[a.x,a.y,a.z]=r.images[0][k];});state.metadata.totalCharge=j.data.charge;state.metadata.multiplicity=j.data.multiplicity;
      MV.VibrationUI.set(r.vibrations,state,`${j.original.metadata.title||'構造'} · ${r.engine} / ${r.method} · ${modeText[r.mode]} · ${reason}`);
    }
    showProfile(r,j,!!j.livePreview&&MV.EnergyProfile.following());
    message((r.vibrations&&r.vibrations.status!=='completed'?'振動解析は未完了です。構造の結果は保持しています。':r.reason==='failed'?'計算に失敗しました。'+(r.error||''):r.reason==='cancelled'?'計算を中止しました。':'計算が完了しました。')+' 結果を確認し、構造列の保存・抽出または「結果を構造へ適用」で反映できます。'+(j.data.mode==='optimize'&&!r.trajectory?' 旧bridgeのため最終構造のみです。全ステップの保存にはbridge.pyを更新・再接続して再計算してください。':''));
  }
  function resultSource(r,j){
    const t=r.trajectory||r;
    return {title:modeText[j.data.mode],name:j.original.metadata.title,kind:j.data.mode,symbols:r.symbols,cell:r.cell,images:t.images,energies:t.energies,
      charge:j.data.charge,multiplicity:j.data.multiplicity,engine:r.engine,method:r.method,base:i=>j.frames[r.trajectory?0:i],
      stepNumbers:j.data.mode==='optimize'&&!r.trajectory?[r.steps]:null,
      notice:j.data.mode==='optimize'&&!r.trajectory?'旧bridgeの結果には最終構造しかありません。全ステップの保存にはbridge.pyを更新・再接続して再計算してください。':''};
  }
  function exportXYZ(r,j){$('engineDialog').close();MV.TrajectoryUI.open(resultSource(r,j));}
  function showProfile(r,j,follow=false){
    const t=r.trajectory||r,history=!!r.trajectory;
    MV.EnergyProfile.set({title:modeText[j.data.mode]+' · エネルギープロファイル'+(r.step!=null?' · ステップ '+r.step:''),kind:history?'optimize':j.data.mode==='evaluate'?'evaluate':'path',focusIndex:history?t.images.length-1:Math.floor((r.images.length-1)/2),energies:t.energies,positions:i=>t.images[i],base:i=>j.frames[history?0:i],details:open,exportXYZ:r.step==null?()=>exportXYZ(r,j):null},follow);
  }
  async function run(){
    if(job||!connection)return;
    if($('engineMode').value==='batch'){await runBatch();return;}
    if(MV.AFIRUI?.isBusy?.()){message('AFIR計算の完了または中止後に実行してください。');return;}
    let j;
    try{
      j={...input(),connection:{...connection},cancelRequested:false,livePreview:$('engineLive').checked};
      if(j.livePreview&&!connection.info.livePreview)throw Error('ライブ表示を使うにはbridge.pyを更新・再接続してください。');
      if(j.livePreview)j.data.livePreview=true;
      MV.VibrationUI.hide();MV.EnergyProfile.reset();clearResult();job=j;busy(true);message('ローカル計算を開始しています…');
      if(j.livePreview)MV.EnergyProfile.begin(cancel,open);
      const created=await request(j.connection,'/api/jobs',j.data);if(!/^[a-f0-9]{32}$/.test(created.id))throw Error('不正な計算IDです。');j.id=created.id;if(j.livePreview){$('engineDialog').close();MV.EnergyProfile.reveal();}
      if(j.cancelRequested)await request(j.connection,`/api/jobs/${j.id}/cancel`,{});
      while(job===j){
        const live=j.livePreview&&MV.EnergyProfile.following();
        const state=await request(j.connection,`/api/jobs/${j.id}`+(live?'?preview=1&after=0':''));
        if(state.status==='completed'||(['cancelled','error'].includes(state.status)&&state.result)){showResult(state.result,j);break;}
        if(state.status==='error')throw Error(state.error||'計算に失敗しました。');
        if(state.status==='cancelled'){MV.EnergyProfile.restore();message('計算を中止しました。構造は変更していません。');break;}
        if(live&&state.preview&&state.preview.step!==j.previewStep){
          const p=state.preview;
          if(j.data.fixedAtoms)MV.Constraints.checkPositions(p.images,j.data.images[0],j.data.fixedAtoms);
          if(Number.isInteger(p.step)&&p.step>=0&&p.step<=j.data.maxSteps&&Array.isArray(p.images)&&p.images.length===j.frames.length&&p.images.every(a=>Array.isArray(a)&&a.length===j.data.symbols.length&&a.every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000)))&&Array.isArray(p.energies)&&p.energies.length===j.frames.length&&p.energies.every(Number.isFinite)){
            j.previewStep=p.step;showProfile(p,j,true);
          }
        }
        const p=state.progress||{};message(p.phase==='vibrations'?`振動解析中: 力の評価 ${p.vibrationDone??0} / ${p.vibrationTotal??'?'}（構造最適化とは別の処理）`+(j.cancelRequested?' · 中止処理中':''):`計算中: ステップ ${p.step??0} / ${j.data.maxSteps} · 構造 ${p.image??0}/${j.frames.length}`+(p.fmax!=null?` · 最大有効力 ${p.fmax.toPrecision(4)} eV/Å`:'')+(j.cancelRequested?' · 中止処理中':''));
        await new Promise(resolve=>setTimeout(resolve,600));
      }
    }catch(error){MV.EnergyProfile.restore();message(error.message+(j?.id?' 接続が途切れた場合、計算はローカル側で継続している可能性があります。サービスをCtrl+Cで停止できます。':''));}
    finally{if(job===j){job=null;MV.EnergyProfile.finish();busy(false);if(j.pauseRequested&&result)refineResult();}}
  }
  async function runBatch(){
    if(MV.AFIRUI?.isBusy()){message('AFIR計算の完了または中止後に実行してください。');return;}
    let j;
    try{
      const plan=input(MV.BatchUI.prepare());
      j={...plan,batch:true,connection:{...connection},cancelRequested:false,livePreview:$('engineLive').checked};
      if(j.livePreview&&!connection.info.livePreview)throw Error('接続中のエンジンは計算中の表示に対応していません。');
      MV.VibrationUI.hide();MV.EnergyProfile.reset();clearResult();job=j;busy(true);
      const entries=MV.BatchUI.begin(plan);
      await MV.Batch.run(entries,async(entry,index)=>{
        const single={...plan,frames:[entry.frame],connection:j.connection,data:{...plan.data,images:[plan.data.images[index]],...(plan.data.atomIds?{atomIds:entry.frame.atoms.map(a=>a.id)}:{})}};
        if(j.livePreview){single.data.livePreview=true;MV.EnergyProfile.begin(cancel,open);}
        message(`一括最適化: ${index+1} / ${entries.length} を開始しています…`);j.id=null;
        const created=await request(j.connection,'/api/jobs',single.data);
        if(!/^[a-f0-9]{32}$/.test(created.id))throw Error('不正な計算IDです。');j.id=created.id;
        if(j.livePreview){$('engineDialog').close();MV.EnergyProfile.reveal();}
        if(j.cancelRequested)await request(j.connection,`/api/jobs/${j.id}/cancel`,{});
        let previewStep=-1;
        while(true){
          const live=j.livePreview&&MV.EnergyProfile.following(),state=await request(j.connection,`/api/jobs/${j.id}`+(live?'?preview=1&after=0':''));
          if(['completed','cancelled','error'].includes(state.status)){
            j.id=null;MV.EnergyProfile.finish();
            if(state.result){
              validateResult(state.result,single);
              const {trajectory,forces,...r}=state.result;
              if(r.mode!=='optimize'||!['converged','step_limit','cancelled','failed'].includes(r.reason)||r.converged!==(r.reason==='converged'))throw Error('最適化結果の状態が不正です。');
              return {status:state.status==='error'?'failed':state.status==='cancelled'?'cancelled':r.reason,result:r,error:state.error||r.error||''};
            }
            if(state.status==='completed')throw Error('最適化結果がありません。');
            return {status:state.status==='error'?'failed':'cancelled',error:state.error||''};
          }
          if(!['running','stopping'].includes(state.status))throw Error('計算状態が不正です。');
          const p=state.preview;
          if(live&&p&&p.step!==previewStep&&Number.isInteger(p.step)&&p.step>=0&&p.step<=single.data.maxSteps&&p.images?.length===1&&p.images[0].length===single.data.symbols.length&&p.images[0].every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000))&&p.energies?.length===1&&p.energies.every(Number.isFinite)){
            if(single.data.fixedAtoms)MV.Constraints.checkPositions(p.images,single.data.images[0],single.data.fixedAtoms);
            previewStep=p.step;showProfile(p,single,true);$('profileTitle').textContent=`一括最適化 · 入力 ${index+1} / ${entries.length} · ステップ ${p.step}`;
          }
          message(`一括最適化: ${index+1} / ${entries.length} · ステップ ${state.progress?.step??0} / ${single.data.maxSteps}`+(j.cancelRequested?' · 中止処理中':''));
          await new Promise(resolve=>setTimeout(resolve,600));
        }
      },()=>j.cancelRequested,()=>MV.BatchUI.render());
      message(j.cancelRequested?'一括最適化を中止しました。完了分と取得済みの途中結果を保持しています。':'一括最適化が終了しました。結果表で収束状態とエネルギーを比較できます。');
    }catch(error){MV.EnergyProfile.restore();message(error.message+(j?.id?' 状態を確認できないため後続の計算を止めました。ローカル側で継続している場合は端末でCtrl+Cを押して停止してください。':''));}
    finally{if(job===j){job=null;MV.EnergyProfile.finish();busy(false);MV.BatchUI.finish();}}
  }
  async function cancel(){
    const j=job;if(!j)return;j.cancelRequested=true;$('engineCancel').disabled=true;message('計算を中止しています…');
    try{if(j.id)await request(j.connection,`/api/jobs/${j.id}/cancel`,{});}catch(error){message(error.message+' ローカル端末でCtrl+Cを押して停止してください。');$('engineCancel').disabled=false;}
  }
  function apply(targetIndex){
    try{
      const j=result;if(!j)return;if(dirty()||fingerprint(app().getState())!==j.fingerprint)throw Error('計算開始後に構造または編集欄が変更されています。結果は適用できません。JSONを保存するか、再計算してください。');validateResult(j.result,j);
      const r=j.result,updated=j.frames.map((f,k)=>{
        const s=MV.Model.createState(f);s.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=r.images[k][i];});
        s.metadata.totalCharge=j.data.charge;s.metadata.multiplicity=j.data.multiplicity;
        delete s.metadata.afirCalculation;
        s.metadata.externalCalculation={fixedAtoms:j.data.fixedAtoms||[],engine:r.engine,method:r.method,energyEV:r.energies[k],mode:r.mode,converged:r.converged,reason:r.reason,steps:r.steps,effectiveFmax:r.imageFmax[k],charge:j.data.charge,multiplicity:j.data.multiplicity};
        if(r.mode!=='evaluate')MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);
      });
      let next;
      if(j.scope==='current'&&j.original.metadata.trajectory){
        next=MV.Model.createState(updated[0]);next.metadata.trajectory=JSON.parse(JSON.stringify(j.original.metadata.trajectory));next.metadata.frameIndex=j.original.metadata.frameIndex||0;next.metadata.trajectory[next.metadata.frameIndex]=updated[0];
      }else{const index=Number.isInteger(targetIndex)?targetIndex:j.scope==='all'?j.original.metadata.frameIndex||0:0;next=MV.Model.createState(updated[index]||updated[0]);if(updated.length>1){next.metadata.trajectory=updated;next.metadata.frameIndex=index;}}
      if(j.original.metadata.measurements)next.metadata.measurements=JSON.parse(JSON.stringify(j.original.metadata.measurements));
      next.viewSettings={...j.original.viewSettings};app().change('external engine result',()=>next,true);$('dataReset').click();$('engineApply').disabled=true;if(next.metadata.trajectory&&j.scope==='all')MV.EnergyProfile.bindTrajectory(next.metadata.trajectory);$('engineDialog').close();app().setStatus(`${modeText[r.mode]}の結果を反映しました（${r.reason==='converged'?'収束':r.reason==='evaluated'?'評価済み':r.reason==='cancelled'?'未収束・中止':r.reason==='failed'?'未収束・計算失敗':'未収束・ステップ上限'}）。「戻す」で計算前へ戻れます。`);
      return true;
    }catch(error){message(error.message);return false;}
  }
  function download(){if(!result)return;const payload={input:result.data,result:result.result},url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='molecule-engine-result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function open(){
    if(!job&&!MV.AFIRUI?.isBusy?.())app().freezeDisplayedStructure();
    if(result&&result.fingerprint!==fingerprint(app().getState()))clearResult();
    if(!job&&!result&&$('engineMode').value!=='batch'){const s=app().getDisplayedState();$('engineCharge').value=s.metadata.totalCharge??s.atoms.reduce((sum,a)=>sum+(Number(a.charge)||0),0);$('engineMultiplicity').value=s.metadata.multiplicity??1;$('engineScope').value=s.metadata.trajectory?'all':'current';$('engineMode').value=s.metadata.trajectory?.length>=3?'cineb':'evaluate';settings();}
    $('engineDialog').showModal();
  }
  function prepareBatch(){
    if(job){message('実行中の計算が終わるまでお待ちください。');$('engineDialog').showModal();return;}
    open();$('engineMode').value='batch';settings();
  }
  function prepareNEB(){
    if(job)throw Error('実行中の計算を終了してください。');
    clearResult();open();$('engineMode').value='cineb';$('engineScope').value='all';settings();
    message('構造列をCI-NEB入力に設定しました。電荷・多重度とCI開始ステップを含む計算条件を確認して実行してください。AFIRの人工力はCI-NEB計算へ加えません。');
  }
  function prepareSingle(mode){
    if(job){message('実行中の計算を終了してください。');$('engineDialog').showModal();return;}
    try{app().useDisplayedStructure();}catch(e){message(e.message);$('engineDialog').showModal();return;}
    clearResult();open();$('engineMode').value=mode;$('engineScope').value='current';settings();
    message(mode==='ts'?'現在表示中の構造をTS入力にしました。手法・電荷・多重度・振動解析の有無を確認して実行してください。':'現在の構造で振動解析します。未収束構造も対象にできます。');
  }
  function refineResult(){
    try{
      const j=result;if(!j)return;if(job)throw Error('計算の終了処理を待ってください。');
      if(dirty()||fingerprint(app().getState())!==j.fingerprint)throw Error('計算後に入力が変更されています。結果JSONを保存するか、再計算してください。');
      validateResult(j.result,j);
      const frames=j.frames.map((f,k)=>{const s=MV.Model.createState(f);s.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=j.result.images[k][i];});s.metadata.totalCharge=j.data.charge;s.metadata.multiplicity=j.data.multiplicity;delete s.metadata.externalCalculation;delete s.metadata.afirCalculation;MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);});
      $('engineDialog').close();MV.PathRefinement.open(frames);
    }catch(e){message(e.message);}
  }
  function init(){
    if(location.hostname==='127.0.0.1'||location.hostname==='localhost')$('engineURL').value=location.origin;
    $('btnTS').addEventListener('click',()=>prepareSingle('ts'));$('btnVibrations').addEventListener('click',()=>prepareSingle('vibrations'));
    $('engineVibrationShow').addEventListener('click',()=>{$('engineDialog').close();MV.VibrationUI.show();});$('engineRefine').addEventListener('click',refineResult);
    $('enginePause').addEventListener('click',()=>{if(job){job.pauseRequested=true;cancel();}});
    $('btnExternalEngine').addEventListener('click',open);$('engineConnect').addEventListener('click',connect);$('engineMode').addEventListener('change',chooseMode);$('engineRun').addEventListener('click',run);$('engineCancel').addEventListener('click',cancel);$('engineApply').addEventListener('click',()=>apply());$('engineDownload').addEventListener('click',download);
    for(const id of ['engineURL','engineToken'])$(id).addEventListener('input',()=>{connection=null;$('engineRun').disabled=true;$('engineConnected').textContent='未接続';MV.AFIRUI?.sync();});
    $('engineProfile').addEventListener('click',()=>{if(result){showProfile(result.result,result);$('engineDialog').close();MV.EnergyProfile.reveal();}});
    $('engineXYZ').addEventListener('click',()=>{if(result)exportXYZ(result.result,result);});
    $('engineDialog').addEventListener('cancel',e=>{if(job){e.preventDefault();cancel();}});settings();
  }
  MV.EngineUI={init,open,prepareBatch,endpoint,frames,validateResult,request,prepareNEB,prepareSingle,isBusy:()=>!!job,getConnection:()=>connection?{...connection}:null};
})(window);
