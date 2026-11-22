/* Local-only external energy/gradient jobs. Tokens live in memory, never in projects. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),app=()=>MV.App;
  let connection=null,job=null,result=null;
  let settingsMode=null,restoredInputFingerprint=null,lastSettingsSource=null,pendingMethod=null;
  const pathModes=['perpendicular','neb','cineb','lup'],climbingModes=['cineb','lup'];
  const modeSettings=new Map(),relaxFields=['engineSteps','engineFmax','engineMove','engineSpring','engineClimb','engineEndpointMode'];
  const fingerprint=s=>JSON.stringify([s.atoms,s.bonds,s.metadata]);
  const dirty=()=>/未適用|編集中/.test($('xyzEditStatus').textContent);
  const message=text=>{$('engineMessage').textContent=text;};
  const modeText={dsafir:'DS-AFIR',evaluate:'エネルギー・力の評価',optimize:'単一構造の最適化',perpendicular:'接線に直交する緩和',neb:'NEB',cineb:'CI-NEB',lup:'LUP系（CI-String）',ts:'Sella TS最適化',vibrations:'振動解析',irc:'IRC',scan:'緩和スキャン',afir:'AFIR-MIN'};
  function endpoint(value){
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('接続先は http://127.0.0.1:8766 など、このPCのlocalhost URLにしてください。');
    return url.origin;
  }
  async function pollJob(j,live){
    const compact=j.connection.info?.compactPolling===1;
    if(!live)delete j.previewVersion;
    let query=live?'preview=1&after='+(j.previewCursor||0):'';
    if(compact&&live&&Number.isInteger(j.previewVersion))query+='&since='+j.previewVersion;
    if(compact)query+=(query?'&':'')+'compact=1';
    let state;
    try { state=await MV.EngineUI.request(j.connection,'/api/jobs/'+j.id+(query?'?'+query:'')); }
    catch(error) { MV.Activity?.pollFailed(j); throw error; }
    MV.Activity?.recordJob(j.connection,{...state,id:j.id},j.data?.mode,false,j.activityLabel);
    if(live&&state.preview&&Number.isInteger(state.previewVersion))j.previewVersion=state.previewVersion;
    return state;
  }
  async function request(c,path,body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(c.url+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+c.token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
      const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
      if(body!==undefined&&(path==='/api/jobs'||path.endsWith('/resume')))MV.Activity?.submitted(c,data,body.mode);
      if(body!==undefined&&path.endsWith('/cancel'))MV.Activity?.recordJob(c,data);
      return data;
    }catch(error){if(error.name==='TypeError'||error.name==='AbortError')throw Error('ローカルサービスに接続できません。起動状態・URL・許可Origin・ブラウザのローカルネットワーク許可を確認してください。接続が遮断される場合は --site-dir で画面もローカル配信できます。');throw error;}finally{clearTimeout(timer);}
  }
  function busy(value){const editable=!value||!!connection?.info.jobQueue;$('engineModelSettings').disabled=!editable||!!MV.AFIRUI?.isBusy?.();$('engineSettings').disabled=!editable;$('engineConnection').disabled=value;$('engineRun').disabled=!editable||!connection;$('engineRun').textContent=value&&editable?'現在の設定をキューへ追加':'計算を実行';$('engineCancel').disabled=!value;$('engineClose').disabled=false;$('engineLive').disabled=value;$('enginePause').disabled=!value||!connection?.info.pathCheckpoint;MV.BatchUI?.render();MV.ConstraintUI?.sync();MV.GroupConstraintUI?.sync();}
  function endpointModeInput(mode,value,info){
    if(!climbingModes.includes(mode))return {};
    if(!['relax','fixed'].includes(value))throw Error('端点を緩和するか固定するかを選択してください。');
    if(info.pathEndpointModes?.includes(value))return {endpointMode:value};
    if(value==='fixed'&&!info.pathEndpointModes)return {};
    throw Error('両端を緩和するにはbridge.py 1.18.0以降へ更新して再接続してください。旧版で実行する場合は「入力座標に固定」を選択してください。');
  }
  function endpointDescription(mode,value){
    if(!climbingModes.includes(mode)||value==='fixed')return '両端点を入力座標に固定します。';
    return '両端点を選んだポテンシャル面の力で極小構造へ緩和します。';
  }
  function syncEndpointMode(){
    const mode=$('engineMode').value,value=$('engineEndpointMode').value;
    $('engineEndpointSettings').hidden=!climbingModes.includes(mode);
    if(!climbingModes.includes(mode))return;
    const old=connection&&!connection.info.pathEndpointModes?.includes('relax');
    $('engineEndpointHelp').textContent=endpointDescription(mode,value)+(old?' この接続は端点固定にのみ対応します。端点を緩和するにはbridge.pyを更新してください。':'')+
      '登坂ノードでは経路の接線方向の力を反転させ、接線に直交する方向は緩和します。';
  }
  function settings(){
    const mode=$('engineMode').value,path=pathModes.includes(mode),single=['optimize','ts','vibrations','irc','scan'].includes(mode),batch=mode==='batch';
    MV.Activity?.showMethod(mode==='batch'?'一括最適化':modeText[mode]);
    if(mode!==settingsMode){
      if(settingsMode)modeSettings.set(settingsMode,relaxFields.map(id=>$(id).value));
      const values=modeSettings.get(mode)||(mode==='dsafir'?['300','0.05','0.04','1','5','relax']:climbingModes.includes(mode)?['100','0.05','0.03','1','5','relax']:['150','0.05','0.04','1','5','relax']);
      relaxFields.forEach((id,i)=>{$(id).value=values[i];});settingsMode=mode;
    }
    if(path||mode==='dsafir')$('engineScope').value='all';if(single)$('engineScope').value='current';$('engineScope').disabled=path||single||batch||mode==='dsafir';$('engineScope').closest('label').hidden=batch||mode==='dsafir';$('batchInput').hidden=!batch;
    $('engineRelaxSettings').hidden=['evaluate','vibrations'].includes(mode);$('engineSpringLabel').hidden=!['neb','cineb'].includes(mode);$('engineClimbLabel').hidden=!climbingModes.includes(mode);
    $('engineOptimizerLabel').hidden=!['optimize','batch','scan'].includes(mode);$('engineTSMethodLabel').hidden=$('engineTrustLabel').hidden=mode!=='ts';$('engineMoveLabel').hidden=['ts','dsafir'].includes(mode);
    $('engineFmax').closest('label').hidden=mode==='dsafir';
    $('engineSteps').max=mode==='dsafir'?9999:10000;
    $('engineDSAFIRSettings').hidden=mode!=='dsafir';
    if(mode==='dsafir')syncEndpoints();
    syncEndpointMode();
    $('engineVibrationOptions').hidden=!['optimize','ts','vibrations'].includes(mode);$('engineVibrationCheckLabel').hidden=mode==='vibrations';$('enginePause').hidden=!['neb','cineb','lup'].includes(mode);$('enginePause').textContent=modeText[mode]+'を一時停止してノード追加';
    MV.ResearchUI?.settings(mode);MV.ModelFUI?.sync();
    $('engineModeHelp').textContent={dsafir:'同じ原子を含む2つの構造から、両側の探索点が出会うまで経路をたどります。中間構造やAFIR原子団の指定は不要です。',lup:'ばねを使わず、経路に直交する緩和と弧長に沿った再分布を交互に行います。CI開始後は最高点を登らせます。GRRM独自のLUP実装とは異なります。',irc:'TS候補から質量重み付きIRCを追跡し、到達した構造を比較します。',scan:'内部座標を固定し、各点で残りの自由度を最適化します。',batch:'複数構造を同じ条件で、1構造ずつ独立に最適化します。人工力や経路のばねは加えません。',evaluate:'指定構造のエネルギーと力を計算します。',optimize:'現在の構造を極小化します。人工力は「AFIR法の設定を開く」で指定してください。',ts:'Sellaで一次鞍点を探索します。経路の結果表からTS候補を選べます。人工力・ばねは加えません。',vibrations:'現在の構造でASEの有限差分振動解析を行います。未収束構造も解析できます。',perpendicular:'端点を固定し、経路の接線に直交する力で緩和します。',neb:'端点を固定して経路を緩和します。一時停止してノードを追加できます。',cineb:'CI開始後は最高エネルギーの内部ノードを登らせます。一時停止してノードを追加できます。'}[mode];
  }
  function chooseMode(){
    pendingMethod=$('engineMode').value==='afir'?null:$('engineMode').value;
    if($('engineMode').value!=='afir'){settings();return;}
    // AFIR has its own fragment pairs and conditions; selecting it only opens setup.
    $('engineMode').value='optimize';settings();$('engineDialog').close();MV.AFIRUI.toggle(true);
    $('afirPanel').scrollIntoView({block:'nearest',behavior:'smooth'});$('afirName').focus({preventScroll:true});
  }
  function syncEndpoints(){
    if($('engineMode').value!=='dsafir')return;
    const state=app().getState(),count=state.metadata.trajectory?.length||(state.atoms.length?1:0);
    const start=$('dsafirStart'),end=$('dsafirEnd');
    if(start.children.length!==count){
      for(const select of [start,end]){
        const options=Array.from({length:count},(_,i)=>{
          const option=document.createElement('option');option.value=i;option.textContent='構造 '+(i+1);return option;
        });
        select.replaceChildren(...options);
      }
      start.value=0;end.value=count-1;
    }
    start.disabled=end.disabled=count<2;
    let help=count<2?'「ファイルを開く」で反応物と生成物の2ファイル、または2構造以上を含むXYZを読み込んでください。':'同じ番号の原子同士を対応させます。両構造の元素と原子の並びを確認してください。';
    if(count>=2&&start.value!==end.value){
      const frame=i=>i===(state.metadata.frameIndex||0)?state:state.metadata.trajectory[i];
      const a=frame(Number(start.value))?.atoms,b=frame(Number(end.value))?.atoms;
      if(a?.length>=3&&a.length<=500&&a.length===b?.length&&a.every((atom,i)=>atom.element===b[i].element)){
        const positions=atoms=>atoms.map(atom=>[atom.x,atom.y,atom.z]);
        if(MV.StructureAnalysis.hasLinearOrderChange(positions(a),positions(b))){
          help='両端はほぼ直線で、直線上の原子の並び順が異なります。軸の外へ回り込む経路を探索する場合は、入力のコピーで反応に関わる原子を軸からわずかにずらしてください。';
        }
      }
    }
    if($('dsafirEndpointHelp').textContent!==help)$('dsafirEndpointHelp').textContent=help;
  }
  function endpointFrames(state){
    syncEndpoints();
    const trajectory=state.metadata.trajectory;
    if(!trajectory||trajectory.length<2)throw Error('DS-AFIRには反応物と生成物の2構造が必要です。「ファイルを開く」から読み込んでください。');
    const indices=[$('dsafirStart'),$('dsafirEnd')].map(el=>Number(el.value));
    if(indices.some(i=>!Number.isInteger(i)||i<0||i>=trajectory.length)||indices[0]===indices[1])throw Error('反応物と生成物には異なる構造を指定してください。');
    const selected=indices.map(i=>MV.Periodic.snapshot(i===(state.metadata.frameIndex||0)?state:trajectory[i]));
    // Independent coordinate files have independent IDs. When IDs are shared, require the same correspondence.
    const startIds=new Map(selected[0].atoms.map((a,i)=>[a.id,i]));
    if(selected[1].atoms.some((a,i)=>startIds.has(a.id)&&startIds.get(a.id)!==i))throw Error('原子IDとファイル内の順序が一致しません。両端の原子を同じ順序にしてください。');
    return selected;
  }
  function baseFrame(j,i){return j.data?.mode==='dsafir'?j.frames[0]:j.frames[i]||j.frames[0];}
  function frames(state,scope){
    if(scope==='current'||!state.metadata.trajectory)return [MV.Periodic.snapshot(state)];
    const all=JSON.parse(JSON.stringify(state.metadata.trajectory));all[state.metadata.frameIndex||0]=MV.Periodic.snapshot(state);return all;
  }
  function input(batchFrames){
    MV.ConstraintUI?.flush();MV.OptimizationUI?.captureInternal();
    if(dirty())throw Error('座標編集欄の未適用データを先に適用するか、現在の構造を再表示してください。');
    if(!batchFrames&&$('engineScope').value==='current')app().useDisplayedStructure();
    const state=app().getState(),mode=batchFrames?'optimize':$('engineMode').value;
    const all=batchFrames||(mode==='dsafir'?endpointFrames(state):frames(state,$('engineScope').value));
    const symbols=all[0].atoms.map(a=>a.element),cell=all[0].metadata.cell||null;
    if(!symbols.length||symbols.length>500||all.length>(batchFrames?100:connection.info.maxImages||20))throw Error(`外部計算は1〜500原子、最大${connection.info.maxImages||20}構造です。必要に応じてbridge.pyを更新してください。`);
    if(pathModes.includes(mode)&&all.length<3)throw Error('先に「反応経路」で端点を含む3〜100構造を生成するか、複数構造XYZなどを読み込んでください。');
    for(const f of all){
      if(JSON.stringify(f.atoms.map(a=>a.element))!==JSON.stringify(symbols))throw Error('全フレームの元素とFile-orderを一致させてください。');
      if(JSON.stringify(f.metadata.cell||null)!==JSON.stringify(cell))throw Error('経路全体で同じセル・周期方向が必要です。可変セル計算には対応していません。');
      if(f.atoms.some(a=>a.xyzExtras?.occupancy&&Number(a.xyzExtras.occupancy.values[0])!==1))throw Error('部分占有サイトがあります。計算前に占有を確定した構造にしてください。');
    }
    if(mode==='dsafir'&&cell?.pbc.some(Boolean))throw Error('DS-AFIRは非周期分子用です。周期構造は選択できません。');
    if(cell?.pbc.some(Boolean)&&!connection.info.periodic)throw Error('接続中のエンジンは非周期系専用です。周期セルを無効にするか、周期系対応のエンジンへ接続してください。');
    const data={symbols,images:all.map(f=>f.atoms.map(a=>[a.x,a.y,a.z])),cell,mode,charge:Number($('engineCharge').value),multiplicity:Number($('engineMultiplicity').value),maxSteps:Number($('engineSteps').value),fmax:Number($('engineFmax').value),spring:Number($('engineSpring').value),maxMove:Number($('engineMove').value),climbAfter:Number($('engineClimb').value)};
    if(mode==='lup')delete data.spring;
    if(mode==='dsafir'){
      for(const key of ['fmax','maxMove','spring','climbAfter'])delete data[key];
      if(data.maxSteps>9999)throw Error('DS-AFIRの最大ステップ数は1〜9999です。');
    }
    for(const [key,lo,hi,integer] of [['charge',-100,100,true],['multiplicity',1,101,true],['maxSteps',1,10000,true],['fmax',.00001,10,false],['spring',.001,10,false],['maxMove',.001,.2,false],['climbAfter',0,500,true]].filter(([key])=>Object.hasOwn(data,key)))if(!Number.isFinite(data[key])||data[key]<lo||data[key]>hi||(integer&&!Number.isInteger(data[key])))throw Error(`${key}は${lo}〜${hi}${integer?'の整数':''}にしてください。`);
    Object.assign(data,modelInput(),endpointModeInput(mode,$('engineEndpointMode').value,connection.info));validateEngineInput(data,connection.info);
    if(['ts','vibrations','irc','scan','lup','dsafir'].includes(mode)&&!connection.info.modes.includes(mode))throw Error(`${modeText[mode]}に対応するbridge.pyへ更新・再接続してください。`);
    if(mode==='ts'){
      if(!connection.info.sellaVersion)throw Error('接続中のPythonにSellaがありません。python -m pip install "sella>=2.6,<3" を実行し、再接続してください。');
      data.optimizer=$('engineTSMethod').value;data.trustRadius=Number($('engineTrust').value);
      if(!Number.isFinite(data.trustRadius)||data.trustRadius<.001||data.trustRadius>.2)throw Error('初期信頼半径は0.001〜0.2 Åにしてください。');
    }
    if(['optimize','scan'].includes(mode)&&$('engineOptimizer').value!=='fire'){
      if(!connection.info.modes.includes('ts'))throw Error('L-BFGS・BFGSを使うにはbridge.pyを更新してください。');
      data.optimizer=$('engineOptimizer').value;
    }
    if(mode==='vibrations'||(!batchFrames&&['ts','optimize'].includes(mode)&&($('engineVibrationCheck').checked||$('thermoEnabled').checked))){
      if(!connection.info.vibrations)throw Error('振動解析を使うにはbridge.pyを更新してください。');
      if(symbols.length>(connection.info.maxVibrationAtoms||200))throw Error('振動解析は最大200原子です。');
      if(all[0].atoms.some(a=>a.mol?.props?.MASS||a.xyzExtras?.mass||a.xyzExtras?.masses))throw Error('この振動解析はASE標準原子質量を使用します。同位体・個別質量を持つ構造には未対応です。');
      data.vibrations={delta:Number($('engineVibrationDelta').value),nfree:Number($('engineVibrationNfree').value),imaginaryThreshold:Number($('engineVibrationThreshold').value)};
      const v=data.vibrations;if(!Number.isFinite(v.delta)||v.delta<.0001||v.delta>.1||![2,4].includes(v.nfree)||!Number.isFinite(v.imaginaryThreshold)||v.imaginaryThreshold<0||v.imaginaryThreshold>1000)throw Error('振動解析の変位幅は0.0001〜0.1 Å、差分点数は2/4、虚振動の閾値は0〜1000 cm⁻¹です。');
    }
    MV.ResearchUI?.input(data,state,connection.info,{batch:!!batchFrames});
    if((['ts','irc'].includes(mode)||data.vibrations)&&cell?.pbc.some(Boolean))throw Error('TS・振動モード表示は非周期分子用です。');
    const fixed=MV.Constraints.forJob(state,data,connection.info);
    if(fixed.length){data.fixedAtoms=fixed;all.forEach(f=>MV.Constraints.attach(f,fixed));}
    const group=MV.GroupConstraints?.forJob(state,data,connection.info,MV.Geometry.atomicMass);
    if(group){
      if(all.some(f=>JSON.stringify(f.atoms.map(MV.Geometry.atomicMass))!==JSON.stringify(group.masses)))throw Error('重心拘束には全構造で同じ元素・原子順序・原子質量が必要です。');
      data.groupConstraints=group;all.forEach(f=>MV.GroupConstraints.attach(f,group));
    }
    MV.OptimizationUI?.input(data,state,connection.info);validateEngineInput(data,connection.info);
    if(mode==='dsafir'||connection.info.vibrations)data.atomIds=all[0].atoms.map(a=>a.id);
    if(data.maxSteps>(connection.info.maxSteps??1000))throw Error('指定したステップ数に対応するため、bridge.pyを更新・再起動して再接続してください。');
    if(climbingModes.includes(mode)&&data.climbAfter>=data.maxSteps)throw Error('CI開始ステップを最大ステップ数より小さくしてください。');
    const original=MV.Model.cloneState(state);MV.Optimization?.rememberCoordinates(original,data);all.forEach(f=>MV.Optimization?.rememberCoordinates(f,data));
    return {data,frames:all,scope:$('engineScope').value,fingerprint:fingerprint(state),original};
  }
  function validateEngineInput(data,info){
    MV.LLMLIPUI?.validate(data,info);
    MV.ModelF?.validateInput(data,info);
    if(info.uma&&data.multiplicity>100)throw Error('UMAのスピン多重度は1〜100にしてください。');
    if(info.uma&&data.cell?.pbc.some(Boolean))throw Error('このUMA接続は分子用omol・非周期系専用です。');
    if(data.solvation&&(!info.anysolv?.enabled||!info.anysolv.models.includes(data.solvation.model)||!info.anysolv.solvents.includes(data.solvation.solvent)))throw Error('AnySolvの接続条件を確認してください。');
  }
  function modelInput(primary=Number($('engineMultiplicity').value)){
    const info=connection?.info,data={...(MV.ModelFUI?.input(primary,info)||{}),...(MV.LLMLIPUI?.input()||{})};if(!info?.uma)return data;
    if(info.devices?.length)data.umaDevice=$('engineUMADevice').value;
    if($('engineAnySolv').checked){
      if(!info.anysolv?.enabled)throw Error('AnySolvを使用するには --anysolv で起動して再接続してください。');
      data.solvation={model:$('engineAnySolvModel').value,solvent:$('engineSolvent').value,device:$('engineAnySolvDevice').value};
    }
    return data;
  }
  function modelSummary(){
    const parts=[];if($('modelFEnabled')?.checked)parts.push(`AMF${$('modelFSurface').value==='lower'?'下側':'上側'} · 状態2 M=${$('modelFMultiplicity2').value} · α=${$('modelFAlpha').value} kJ/mol`);
    if(connection?.info.uma)parts.push($('engineAnySolv').checked?`AnySolv · ${$('engineSolvent').value} · ${$('engineAnySolvModel').value}`:'気相（溶媒補正なし）');
    if(connection?.info.llmlip)parts.push(MV.LLMLIPUI.summary());
    return parts.join(' · ');
  }
  function modelControls(){
    const info=connection?.info,on=$('engineAnySolv').checked;
    $('engineAnySolvFields').hidden=!on;
    $('engineSolvationHelp').textContent=!info?.anysolv?.enabled?'AnySolvを追加するにはセットアップ案内を開き、--anysolv で起動してください。':on?
      'E = UMA + 溶媒補正、力も加算します。MIN・AFIR・CI-NEB・LUP系・TS・IRC・スキャン・振動解析に共通です。'+($('engineUMADevice').value===$('engineAnySolvDevice').value&&$('engineUMADevice').value!=='cpu'?' 同じGPUを選択中：2モデル分のメモリが必要です。':''):'溶媒補正なしで計算します。';
    MV.AFIRUI?.sync();
  }
  function validateSolvationResult(r,data){
    MV.LLMLIPUI?.validateResult(r,data);
    if(!data.solvation)return;
    const p=r?.provenance?.anysolv;
    if(!p||['model','solvent','device'].some(k=>p[k]!==data.solvation[k])||(data.umaDevice&&r.provenance.uma?.device!==data.umaDevice))throw Error('結果のAnySolv条件が入力と一致しません。');
    if(data.modelF){MV.ModelF.validateResult(r,data);return;}
    for(const item of [r,...(r.trajectory?[r.trajectory]:[])]){
      const c=item.energyComponents;
      if(!c||!['uma','solvation'].every(k=>Array.isArray(c[k])&&c[k].length===item.energies.length&&c[k].every(Number.isFinite))||item.energies.some((e,i)=>Math.abs(e-c.uma[i]-c.solvation[i])>1e-7))throw Error('UMA・溶媒補正・合計エネルギーの対応が不正です。');
    }
  }
  function connectionDetails(){
    MV.Activity?.connect(connection);
    syncEndpointMode();
    const u=connection?.info.uma;
    $('engineUMADetails').hidden=!u;
    $('engineMultiplicity').max=u?'100':'101';
    if(u)$('engineUMASummary').textContent=`${u.model} · task: ${u.task} · ${u.device.toUpperCase()} · ${u.precision} · TF32無効。${u.precision==='float32'?' TS・振動解析ではfloat64を推奨します。':''}`;
    const info=connection?.info,a=info?.anysolv;
    $('engineModelSettings').hidden=!u&&!info?.llmlip;$('engineUMAFields').hidden=!u;MV.LLMLIPUI?.connected(info);$('engineUMADeviceLabel').hidden=!info?.devices?.length;
    $('engineAnySolv').checked=false;$('engineAnySolv').disabled=!a?.enabled;
    const options=(id,items,selected)=>{const el=$(id);el.replaceChildren(...items.map(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.label;return o;}));el.value=selected||items[0]?.id||'';};
    options('engineUMADevice',info?.devices||[],u?.device);
    options('engineAnySolvDevice',info?.devices||[],a?.device);
    options('engineAnySolvModel',(a?.models||[]).map(id=>({id,label:id==='model_moe'?'MoE（大規模モデル）':'Compact（軽量モデル）'})),a?.model);
    options('engineSolvent',(a?.solvents||[]).map(id=>({id,label:id})),a?.solvents?.includes('water')?'water':a?.solvents?.[0]);
    modelControls();
  }
  async function connect(){
    if(job)return;connection=null;connectionDetails();$('engineRun').disabled=true;$('engineConnect').disabled=true;
    try{
      const c={url:endpoint($('engineURL').value),token:$('engineToken').value.trim()};if(!c.token)throw Error('サービス起動時に表示されるTokenを入力してください。');
      c.info=await request(c,'/api/info');if(!['1.0.0','1.1.0','1.1.1','1.1.2','1.2.0','1.3.0','1.4.0','1.5.0','1.6.0','1.7.0','1.8.0','1.9.0','1.10.0','1.11.0','1.12.0','1.13.0','1.14.0','1.15.0','1.16.0','1.17.0','1.18.0','2.0.0'].includes(c.info.version)||!Array.isArray(c.info.modes))throw Error('サービスのバージョンが一致しません。最新のbridge.pyを使用してください。');if($('engineChoice').value!=='auto'&&$('engineChoice').value!==c.info.engine)throw Error('選択したエンジンと接続先が一致しません。対応する--engineでbridgeを起動してください。');connection=c;$('engineChoice').value=c.info.engine;connectionDetails();MV.JobHistoryUI?.connected();
      $('engineConnected').textContent=`接続済み: ${c.info.engine} / ${c.info.method} · ${c.info.engineVersion} · ${c.info.llmlip?'周期条件は選択モデルによる':c.info.periodic?'固定セル周期系対応':'非周期系'} · Sella ${c.info.sellaVersion||'未導入'}`;message(c.info.llmlip?'llmlip.rs（CPU・β版）へ接続しました。登録モデル・対応元素・headと計算精度を確認してください。':c.info.uma?'サービスに接続しました。モデルは計算実行時に読み込みます。電荷とスピン多重度を確認してください。':'接続しました。電荷と多重度を確認して計算を実行してください。');
    }catch(error){$('engineConnected').textContent='未接続';message(error.message);}finally{$('engineConnect').disabled=false;busy(false);MV.AFIRUI?.sync();}
  }
  function clearResult(){result=null;$('engineResult').hidden=true;$('engineApply').disabled=true;$('engineDownload').disabled=true;}
  function validateDSPath(r,j){
    const ds=r.dsafir,requested=j.data.dsafir;
    if(!ds||typeof ds.connected!=='boolean'||!Number.isFinite(ds.gap)||ds.gap<0||
       !Number.isInteger(ds.joinIndex)||ds.joinIndex<0||ds.joinIndex>=r.images.length-1||
       !['delta','threshold','stepSize'].every(k=>ds[k]===requested[k])||
       r.converged!==ds.connected||ds.connected!==(ds.gap<=ds.threshold)||
       !Number.isInteger(r.steps)||r.steps<0||r.steps>j.data.maxSteps||r.images.length!==r.steps+2||
       JSON.stringify(r.atomIds)!==JSON.stringify(j.data.atomIds))
      throw Error('DS-AFIRの条件、原子IDまたは接続状態が入力と一致しません。');
    const left=r.images[ds.joinIndex],right=r.images[ds.joinIndex+1];
    let squared=0;
    left.forEach((xyz,i)=>{for(let k=0;k<3;k++)squared+=(xyz[k]-right[i][k])**2;});
    if(Math.abs(Math.sqrt(squared)-ds.gap)>1e-7||
       !MV.Optimization.near(r.images[0],j.data.images[0],1e-8)||
       MV.StructureAnalysis.align(r.images.at(-1),j.data.images[1]).maxDeviation>1e-6)
      throw Error('DS-AFIRの端点構造または探索点の距離が一致しません。');
  }
  function canApplyDSPath(r){
    return r.dsafir.connected&&r.images.length<=200&&r.images.length*r.symbols.length<=100000;
  }
  function validateClimbingResult(r,data){
    const mode=data.endpointMode??'fixed';
    if((r.endpointMode??'fixed')!==mode||(data.endpointMode&&r.endpointMode!==mode))throw Error('経路計算の端点条件が入力と一致しません。');
    if(!r.endpointMode&&!data.endpointMode)return; // Results from fixed-endpoint bridges.
    const d=r.diagnostics,endpoints=d?.endpointPhysicalFmax,ci=r.climbingImage;
    if(!Array.isArray(endpoints)||endpoints.length!==2||!endpoints.every(f=>Number.isFinite(f)&&f>=0)||
       (ci!=null&&(!Number.isInteger(ci)||ci<1||ci>=r.images.length-1||
         !Number.isFinite(d.climbingPhysicalFmax)||d.climbingPhysicalFmax<0||typeof d.climbingBracketed!=='boolean')))
      throw Error('両端点または登坂ノードの力の情報が不正です。');
    if(r.converged&&(ci==null||!d.climbingBracketed||d.climbingPhysicalFmax>data.fmax||
      (mode==='relax'&&endpoints.some(f=>f>data.fmax))||r.effectiveFmax>data.fmax))
      throw Error('登坂ノードまたは経路の収束条件と結果が一致しません。');
  }
  function validateResult(r,j){
    validateSolvationResult(r,j.data);MV.ModelF?.validateResult(r,j.data);MV.Optimization?.validateResult(r,j.data);
    MV.Constraints?.validateResult(r,j.data);MV.GroupConstraints?.validateResult(r,j.data);
    if(!r||r.mode!==j.data.mode||JSON.stringify(r.symbols)!==JSON.stringify(j.data.symbols)||(!j.data.cellOptimization||j.data.cellOptimization.mode==='fixed')&&JSON.stringify(r.cell)!==JSON.stringify(j.data.cell)||!Array.isArray(r.images)||!r.images.length||r.images.length>40001||(!['irc','scan','afir','dsafir'].includes(j.data.mode)&&!j.data.adaptiveNEB?.enabled&&r.images.length!==j.frames.length)||r.energies?.length!==r.images.length||r.units?.energy!=='eV'||r.units?.length!=='angstrom')throw Error('結果の元素・セル・構造数・単位が入力と一致しません。');
    if(!r.images.every(p=>Array.isArray(p)&&p.length===j.data.symbols.length&&p.every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000)))||!r.energies.every(Number.isFinite)||(j.data.mode!=='dsafir'&&!Number.isFinite(r.effectiveFmax))||!Array.isArray(r.imageFmax)||r.imageFmax.length!==r.images.length||!r.imageFmax.every(Number.isFinite))throw Error('計算結果に不正な座標・エネルギー・力が含まれます。');
    if(j.data.mode==='dsafir')validateDSPath(r,j);
    if(climbingModes.includes(j.data.mode))validateClimbingResult(r,j.data);
    if(pathModes.includes(j.data.mode)&&j.data.endpointMode!=='relax')for(const [i,k] of [[0,0],[r.images.length-1,j.data.images.length-1]])if(JSON.stringify(r.images[i])!==JSON.stringify(j.data.images[k]))throw Error('端点座標が変更された結果は適用できません。');
    if(['optimize','ts'].includes(j.data.mode)){
      if(!r.trajectory){if(j.connection?.info.optimizationTrajectory)throw Error('最適化の構造履歴がありません。');return;}
      const t=r.trajectory;if(!Array.isArray(t.energies))throw Error('最適化履歴のエネルギーがありません。');MV.Trajectory.validate({...t,symbols:r.symbols});
      if(!Number.isInteger(r.steps)||r.steps<0||r.steps>j.data.maxSteps||t.images.length!==r.steps+1||!(j.data.cellOptimization&&j.data.cellOptimization.mode!=='fixed'?MV.Optimization.near(t.images[0],j.data.images[0],1e-9):JSON.stringify(t.images[0])===JSON.stringify(r.constraintProjection?.positions||j.data.images[0]))||JSON.stringify(t.images.at(-1))!==JSON.stringify(r.images[0])||t.energies.at(-1)!==r.energies[0])throw Error('最適化の履歴・始点・最終構造が一致しません。');
    }
  }
  function syncDSRelaxation(){
    const r=result?.result, panel=$('dsafirRelaxation');
    panel.hidden=r?.mode!=='dsafir';
    if(panel.hidden)return;
    const mode=$('dsafirRelaxMode').value;
    $('dsafirRelaxEndpointsLabel').hidden=!climbingModes.includes(mode);
    const count=$('dsafirRelaxCount'),maximum=Math.min(r.images.length,100);
    count.max=maximum;
    const valid=r.dsafir.connected&&Number.isInteger(Number(count.value))&&Number(count.value)>=3&&Number(count.value)<=maximum;
    $('dsafirRelaxPrepare').disabled=!valid;
    const sourceLabel=r.method||r.engine||'DS-AFIRのモデル';
    const potentialNote=$('dsafirRelaxPotential').value==='current'?'座標・原子対応・電荷・多重度を引き継ぎ、全ノードのエネルギーと力を現在のモデル設定で再計算します。':'ポテンシャルは'+sourceLabel+'を引き継ぎます。';
    $('dsafirRelaxHelp').textContent=!r.dsafir.connected?'未接続のため経路緩和には使用できません。':
      maximum<3?'中間構造がありません。接続距離を小さくして再探索してください。':
      !valid?`端点を含む3〜${maximum}ノードを指定してください。`:
      `全${r.images.length}構造から${count.value}ノードを使用します。両端点と物理エネルギーの最高点を残し、経路に沿った累積変位と極大点を考慮して選びます。${endpointDescription(mode,$('dsafirRelaxEndpoints').value)}${potentialNote}`;
  }
  function showResult(r,j){
    validateResult(r,j);if(r.vibrations?.status==='completed')MV.VibrationUI.validate(r.vibrations,r.symbols,r.images[0]);result={...j,result:r};$('engineResult').hidden=false;$('engineApply').disabled=false;$('engineDownload').disabled=false;
    const ds=r.mode==='dsafir'?r.dsafir:null;
    const incomplete=ds&&!ds.connected;
    if(ds){
      $('dsafirRelaxMode').value='cineb';$('dsafirRelaxPotential').value='source';$('dsafirRelaxEndpoints').value='relax';
      $('dsafirRelaxCount').value=Math.min(15,r.images.length);
    }
    syncDSRelaxation();
    $('engineXYZ').disabled=!!incomplete;
    $('engineApply').disabled=!!ds&&!canApplyDSPath(r);
    $('engineResultForceLabel').textContent=ds?'物理力 (eV/Å)':'有効力 (eV/Å)';
    const reason=r.mode==='vibrations'?(r.vibrations?.status==='completed'?'振動解析完了':'振動解析未完了（構造評価は完了）'):{connected:'経路接続',no_resolved_peak:'経路方向の極大を確認できず終了（未収束）',interrupted:'サービス停止（途中結果）',converged:'収束',step_limit:'ステップ上限（未収束）',evaluated:'評価完了',cancelled:'中止（途中結果）',failed:'計算失敗（途中結果）'}[r.reason]||r.reason;
    $('engineResultSummary').textContent=`${modeText[r.mode]}${j.data.modelF?" · "+MV.ModelF.label(j.data.modelF):""}${j.data.solvation?" · AnySolv / "+j.data.solvation.solvent:""} · ${reason} · ${r.steps}ステップ · ${r.evaluations}回の評価${ds?` · 探索点間距離 ${ds.gap.toFixed(4)} Å（接続基準 ${ds.threshold} Å）`:` · 最大有効力 ${r.effectiveFmax.toPrecision(4)} eV/Å`}${j.data.fixedAtoms?.length?'（可動原子のみ） · 固定 '+j.data.fixedAtoms.length+'原子':''}`+(r.maxTangentialStep!=null?` · 接線方向の最大更新 ${r.maxTangentialStep.toExponential(2)} Å`:'');
    if(climbingModes.includes(r.mode)){
      const d=r.diagnostics||{}, endpoints=d.endpointPhysicalFmax;
      const parts=[j.data.endpointMode==='relax'?'両端緩和':'両端固定'];
      if(endpoints)parts.push('端点の物理力 A '+endpoints[0].toPrecision(4)+' / B '+endpoints[1].toPrecision(4)+' eV/Å');
      if(Number.isFinite(d.climbingPhysicalFmax))parts.push('登坂ノード '+(r.climbingImage+1)+' の物理力 '+d.climbingPhysicalFmax.toPrecision(4)+' eV/Å');
      $('engineResultSummary').textContent+=' · '+parts.join(' · ');
    }
    const body=$('engineEnergyRows');body.replaceChildren();r.energies.forEach((energy,i)=>{
      const tr=document.createElement('tr'),path=pathModes.includes(r.mode)||ds?.connected,endpoint=path&&(i===0||i===r.energies.length-1),fixed=endpoint&&j.data.endpointMode!=='relax',peak=path&&i>0&&i<r.energies.length-1&&energy>r.energies[i-1]&&energy>=r.energies[i+1];
      for(const value of [ds?`${i+1} · ${i<=ds.joinIndex?'A側':'B側'}`:i+1,energy.toFixed(8),(energy-r.energies[0]).toFixed(6),fixed&&!ds?'端点固定':r.imageFmax[i].toPrecision(4)]){const td=document.createElement('td');td.textContent=value;if(tr.children.length===1&&r.energyComponents)td.title=`UMA ${r.energyComponents.uma[i].toFixed(8)} + 溶媒補正 ${r.energyComponents.solvation[i].toFixed(8)} eV`;tr.append(td);}
      const td=document.createElement('td');td.textContent=i===r.climbingImage?(r.diagnostics?.climbingBracketed===false?'CI（極大未確認） ':'CI '):endpoint&&!ds?(i===0?'反応物端点 ':'生成物端点 '):peak?'極大候補 ':'';
      if(!incomplete){
        const button=document.createElement('button');button.className='mv-btn';button.textContent='TS入力';
        button.setAttribute('aria-label',`構造${i+1}をTS入力にする`);
        button.addEventListener('click',()=>{if(apply(i))prepareSingle('ts');});td.append(button);
      }
      tr.append(td);body.append(tr);
    });
    $('engineRefine').hidden=!pathModes.includes(r.mode);
    $('engineVibrationShow').hidden=r.vibrations?.status!=='completed';
    $('engineVibrationStatus').textContent=r.vibrations?(r.vibrations.status==='completed'?`振動解析完了 · ${r.vibrations.settings.imaginaryThreshold} cm⁻¹超の虚振動 ${r.vibrations.significantImaginaryCount}本（全モードは表を表示）`:'振動解析は未完了: '+r.vibrations.error+' 構造の結果は保持しています。'):(r.mode==='ts'?'振動解析は未実施です。力の収束だけではTSは確定しません。':'');
    if(r.vibrations?.status==='completed'){
      const state=MV.Model.createState(j.frames[0]);state.atoms.forEach((a,k)=>{[a.x,a.y,a.z]=r.images[0][k];});state.metadata.totalCharge=j.data.charge;state.metadata.multiplicity=j.data.multiplicity;
      MV.ModelF?.attach(state,j.data,r,0);MV.VibrationUI.set(r.vibrations,state,`${j.original.metadata.title||'構造'} · ${r.engine} / ${r.method} · ${modeText[r.mode]} · ${reason}`);
    }
    MV.ModelFUI?.showResult(r,j.data);MV.ResearchUI?.showResult(r,j);MV.OptimizationUI?.showResult(r,j);MV.DiagnosticsUI?.load(r,j);MV.StructureAnalysisUI?.setSource(r,j);MV.JobHistoryUI?.changed();
    showProfile(r,j,!!j.livePreview&&MV.EnergyProfile.following());
    if(ds){
      message(incomplete?'両側の探索点は未接続です。各側の構造とエネルギーをグラフで確認し、途中結果をJSONで保存できます。'+(r.error?' '+r.error:''):
        '両側の探索点が接続しました。「DS-AFIRの初期経路を緩和」から中間構造を緩和できます。'+
        (canApplyDSPath(r)?'':'経路全体の適用には構造が多いため、「構造列を保存・抽出」でノードを選んでください。'));
      return;
    }
    message((r.reason==='no_resolved_peak'?'経路方向の極大を確認できませんでした。経路の分解能と物理エネルギーを確認してください。':r.vibrations&&r.vibrations.status!=='completed'?'振動解析は未完了です。構造の結果は保持しています。':r.reason==='failed'?'計算に失敗しました。'+(r.error||''):r.reason==='cancelled'?'計算を中止しました。':'計算が完了しました。')+' 結果を確認し、構造列の保存・抽出または「結果を構造へ適用」で反映できます。'+(j.data.mode==='optimize'&&!r.trajectory?' 旧bridgeのため最終構造のみです。全ステップの保存にはbridge.pyを更新・再接続して再計算してください。':''));
  }
  function resultSource(r,j){
    if(r.mode==='dsafir'&&!r.dsafir.connected)throw Error('探索点が未接続のため、経路全体の取り込みはできません。途中結果はJSONで保存できます。');
    const t=r.trajectory||r;
    return {prepareRelaxation:r.mode==='dsafir'?(mode,indices)=>prepareDSRelaxation(r,mode,indices):null,
      title:modeText[j.data.mode],name:j.original.metadata.title,kind:j.data.mode,dsafir:r.dsafir,atomIds:j.data.mode==='dsafir'?r.atomIds:undefined,symbols:r.symbols,cell:r.cell,cells:t.cells,images:t.images,energies:t.energies,biasEnergies:t.biasEnergies,modelF:j.data.modelF,surfaceComponents:t.surfaceComponents,
      charge:j.data.charge,multiplicity:j.data.multiplicity,engine:r.engine,method:r.method,base:i=>{const base=baseFrame(j,r.trajectory?0:i);if(!r.nodeIds||r.trajectory)return base;const f=MV.Periodic.snapshot(MV.Model.createState(base));f.metadata.pathNodeId=r.nodeIds[i];return f;},
      stepNumbers:j.data.mode==='optimize'&&!r.trajectory?[r.steps]:null,
      notice:j.data.mode==='optimize'&&!r.trajectory?'旧bridgeの結果には最終構造しかありません。全ステップの保存にはbridge.pyを更新・再接続して再計算してください。':''};
  }
  function exportXYZ(r,j){$('engineDialog').close();MV.TrajectoryUI.open(resultSource(r,j));}
  function showProfile(r,j,follow=false){
    const t=r.trajectory||r,history=!!r.trajectory,ds=j.data.mode==='dsafir'?r.dsafir:null;
    const label=ds?(r.step!=null?' · A側とB側の探索点':ds.connected?' · 接続済み':' · 未接続'):'';
    const separated=ds&&!ds.connected;
    const legend=ds?(r.step!=null?'A側・B側の最新の探索点における物理エネルギー。':
      separated?`構造${ds.joinIndex+1}と${ds.joinIndex+2}の間は未接続です。各側で実際に評価した物理エネルギーを表示しています。`:
      '反応物Aから生成物Bまで、評価した構造の順に物理エネルギーを表示しています。') : undefined;
    MV.EnergyProfile.set({title:modeText[j.data.mode]+(j.data.modelF?' · '+MV.ModelF.label(j.data.modelF):'')+(j.data.solvation?' · '+j.data.solvation.solvent:'')+' · エネルギープロファイル'+label+(r.step!=null?' · ステップ '+r.step:''),kind:history?'optimize':j.data.mode==='afir'?'afir':j.data.mode==='evaluate'?'evaluate':'path',focusIndex:(history||j.data.mode==='afir')?t.images.length-1:Math.floor((r.images.length-1)/2),energies:t.energies,biasEnergies:t.biasEnergies,legend,breakAfter:separated?ds.joinIndex:undefined,nodeIds:r.nodeIds,positions:i=>t.images[i],base:i=>{const f=MV.Model.createState(baseFrame(j,history?0:i));f.metadata.cell=t.cells?.[i]||r.cell||j.data.cell;MV.ModelF?.attach(f,j.data,t,i);return MV.Periodic.snapshot(f);},details:open,exportXYZ:r.step==null&&!separated?()=>exportXYZ(r,j):null},follow);
  }
  async function run(){
    if(MV.WorkflowUI?.isBusy()){message('計算手順の終了または中止を待ってください。');return;}
    if(!connection)return;if(job){try{await enqueueCurrent();}catch(_){}return;}
    if($('engineMode').value==='batch'){await runBatch();return;}
    if(MV.AFIRUI?.isBusy?.()){if(connection.info.jobQueue||connection.info.queue){try{await enqueueCurrent();}catch(_){}}else message('AFIR計算の完了または中止後に実行してください。');return;}
    let j;
    try{
      j={...input(),connection:{...connection},cancelRequested:false,livePreview:$('engineLive').checked};
      if(j.livePreview&&!connection.info.livePreview)throw Error('ライブ表示を使うにはbridge.pyを更新・再接続してください。');
      if(j.livePreview)j.data.livePreview=true;
      MV.VibrationUI.hide();MV.EnergyProfile.reset();MV.DiagnosticsUI?.reset();clearResult();job=j;busy(true);message('ローカル計算を開始しています…');
      if(j.livePreview)MV.EnergyProfile.begin(cancel,open);
      const created=await request(j.connection,'/api/jobs',j.data);if(!/^[a-f0-9]{32}$/.test(created.id))throw Error('不正な計算IDです。');j.id=created.id;if(pendingMethod!=='dsafir')pendingMethod=null;if(j.livePreview){$('engineDialog').close();MV.EnergyProfile.reveal();}
      if(j.cancelRequested)await request(j.connection,`/api/jobs/${j.id}/cancel`,{});
      await watch(j);
    }catch(error){MV.EnergyProfile.restore();message(error.message+(j?.id?' 接続が途切れた場合、計算はローカル側で継続している可能性があります。サービスをCtrl+Cで停止できます。':''));}
    finally{if(job===j){job=null;MV.EnergyProfile.finish();busy(false);if(j.pauseRequested&&result)refineResult();}}
  }
  async function watch(j){
      while(job===j){
        const live=j.livePreview&&MV.EnergyProfile.following();
        const state=await pollJob(j,live);
        if(state.status==='completed'||(['cancelled','error','interrupted'].includes(state.status)&&state.result)){showResult(state.result,j);if(state.storageError)message($('engineMessage').textContent+' '+state.storageError);break;}
        if(state.status==='error')throw Error(state.error||'計算に失敗しました。');
        if(['cancelled','interrupted'].includes(state.status)){MV.EnergyProfile.restore();message('計算を中止しました。構造は変更していません。');break;}
        if(live&&j.data.mode==='afir'&&state.preview?.positions){
          const p=state.preview;if(Number.isInteger(p.from)&&Number.isInteger(p.next)&&p.from===(j.previewCursor||0)&&Array.isArray(p.energies)&&p.energies.every(Number.isFinite)&&Array.isArray(p.biasEnergies)&&p.biasEnergies.every(Number.isFinite)){
            j.previewEnergies=(j.previewEnergies||[]).concat(p.energies);j.previewBiases=(j.previewBiases||[]).concat(p.biasEnergies);j.previewCursor=p.next;
            const images=Array(j.previewEnergies.length).fill(null);images[images.length-1]=p.positions;showProfile({step:p.next-1,images,energies:j.previewEnergies,biasEnergies:j.previewBiases},j,true);
          }
        }else if(live&&state.preview&&`${state.progress?.scanNode??''}:${state.preview.step}`!==j.previewStep){
          const p=state.preview,stepLimit=j.data.maxSteps*(j.data.mode==='irc'?4:j.data.mode==='scan'?400:1);
          if(j.data.fixedAtoms)MV.Constraints.checkPositions(p.images,j.data.images[0],j.data.fixedAtoms);
          MV.GroupConstraints?.checkPositions(p.images,j.data);MV.Optimization?.checkPositions(p.images,j.data);if(j.data.cellOptimization?.mode!=='fixed'&&j.data.cellOptimization)MV.Optimization.checkCell(p.cell,j.data);
          if(Number.isInteger(p.step)&&p.step>=0&&p.step<=stepLimit&&Array.isArray(p.images)&&(p.images.length===j.frames.length||j.data.adaptiveNEB?.enabled||['scan','irc'].includes(j.data.mode))&&p.images.every(a=>Array.isArray(a)&&a.length===j.data.symbols.length&&a.every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000)))&&Array.isArray(p.energies)&&p.energies.length===p.images.length&&p.energies.every(Number.isFinite)){
            if(j.data.mode==='dsafir'&&(!p.dsafir||p.images.length!==2||p.dsafir.joinIndex!==0||typeof p.dsafir.connected!=='boolean'||!Number.isFinite(p.dsafir.gap)))throw Error('DS-AFIRの探索点の途中表示を読み取れません。');
            j.previewStep=`${state.progress?.scanNode??''}:${p.step}`;showProfile(p,j,true);
          }
        }
        const p=state.progress||{};MV.DiagnosticsUI?.update(p,j);
        const pathStatus=climbingModes.includes(j.data.mode)?' · '+(j.data.endpointMode==='relax'?'両端緩和':'両端固定')+
          (Number.isInteger(p.climbingImage)?' · 登坂ノード '+(p.climbingImage+1):''):'';
        message(state.status==='queued'?'実行待ちです。履歴・キューから順番と状態を確認できます。':p.phase==='loading_model'?(j.connection.info.llmlip?'llmlip.rsのローカルモデルを読み込み中…':'UMAモデルを読み込み中（初回はダウンロードを含みます）…'):j.data.mode==='dsafir'&&Number.isFinite(p.gap)?`DS-AFIR · ${p.side==='reactant'?'A側':p.side==='product'?'B側':'両端点'}を評価 · ステップ ${p.step} / ${j.data.maxSteps} · 探索点間距離 ${p.gap.toFixed(4)} Å`+(j.cancelRequested?' · 中止処理中':''):p.phase==='vibrations'?`振動解析中: 力の評価 ${p.vibrationDone??0} / ${p.vibrationTotal??'?'}（構造最適化とは別の処理）`+(j.cancelRequested?' · 中止処理中':''):`計算中: ステップ ${p.step??0} / ${j.data.maxSteps} · 構造 ${p.image??0}/${p.images??j.frames.length}`+pathStatus+(p.fmax!=null?` · 最大有効力 ${p.fmax.toPrecision(4)} eV/Å`:'')+(j.cancelRequested?' · 中止処理中':''));
        await new Promise(resolve=>setTimeout(resolve,600));
      }
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
        j.activityLabel=`一括最適化 · 入力 ${index+1}/${entries.length}`;
        const single={...plan,frames:[entry.frame],connection:j.connection,data:{...plan.data,images:[plan.data.images[index]],...(plan.data.atomIds?{atomIds:entry.frame.atoms.map(a=>a.id)}:{})}};
        if(j.livePreview){single.data.livePreview=true;MV.EnergyProfile.begin(cancel,open);}
        message(`一括最適化: ${index+1} / ${entries.length} を開始しています…`);j.id=null;
        const created=await request(j.connection,'/api/jobs',single.data);
        if(!/^[a-f0-9]{32}$/.test(created.id))throw Error('不正な計算IDです。');j.id=created.id;
        if(j.livePreview){$('engineDialog').close();MV.EnergyProfile.reveal();}
        if(j.cancelRequested)await request(j.connection,`/api/jobs/${j.id}/cancel`,{});
        let previewStep=-1;
        while(true){
          const live=j.livePreview&&MV.EnergyProfile.following(),state=await pollJob(j,live);
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
          if(!['queued','running','stopping'].includes(state.status))throw Error('計算状態が不正です。');
          const p=state.preview;
          if(live&&p&&p.step!==previewStep&&Number.isInteger(p.step)&&p.step>=0&&p.step<=single.data.maxSteps&&p.images?.length===1&&p.images[0].length===single.data.symbols.length&&p.images[0].every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000))&&p.energies?.length===1&&p.energies.every(Number.isFinite)){
            if(single.data.fixedAtoms)MV.Constraints.checkPositions(p.images,single.data.images[0],single.data.fixedAtoms);
            MV.GroupConstraints?.checkPositions(p.images,single.data);
            previewStep=p.step;showProfile(p,single,true);$('profileTitle').textContent=`一括最適化 · 入力 ${index+1} / ${entries.length} · ステップ ${p.step}`;
          }
          message(`一括最適化: ${index+1} / ${entries.length} · `+(state.progress?.phase==='loading_model'?(j.connection.info.llmlip?'llmlip.rsのローカルモデルを読み込み中…':'UMAモデルを読み込み中…'):`ステップ ${state.progress?.step??0} / ${single.data.maxSteps}`)+(j.cancelRequested?' · 中止処理中':''));
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
  function resultFrame(j,k){
    const r=j.result,ds=r.mode==='dsafir',f=baseFrame(j,k);
    const s=MV.Model.createState(f);s.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=r.images[k][i];});
    s.metadata.cell=r.cells?.[k]||r.cell||null;s.metadata.totalCharge=j.data.charge;s.metadata.multiplicity=j.data.multiplicity;if(r.nodeIds)s.metadata.pathNodeId=r.nodeIds[k];
    delete s.metadata.afirCalculation;
    s.metadata.externalCalculation={...(j.data.llmlip?{llmlip:r.provenance.llmlip}:{}),...(j.data.solvation?{solvation:j.data.solvation,umaDevice:j.data.umaDevice}:{}),fixedAtoms:j.data.fixedAtoms||[],engine:r.engine,method:r.method,energyEV:r.energies[k],mode:r.mode,converged:r.converged,reason:r.reason,steps:r.steps,...(r.endpointMode?{endpointMode:r.endpointMode}:{}),...(ds?{physicalFmax:r.imageFmax[k],dsafir:{...r.dsafir},pathFrame:k}:{effectiveFmax:r.imageFmax[k]}),charge:j.data.charge,multiplicity:j.data.multiplicity};
    MV.ModelF?.attach(s,j.data,r,k);if(r.mode!=='evaluate')MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);
  }
  function apply(targetIndex){
    try{
      const j=result;if(!j)return;const current=fingerprint(app().getState());if(dirty()||(current!==j.fingerprint&&current!==j.appliedFingerprint))throw Error('計算開始後に構造または編集欄が変更されています。結果は適用できません。JSONを保存するか、再計算してください。');validateResult(j.result,j);
      const r=j.result,ds=r.mode==='dsafir';
      if(ds&&!r.dsafir.connected)throw Error('DS-AFIRの探索点は未接続です。途中結果をJSONで保存してください。');
      const singleDS=ds&&Number.isInteger(targetIndex);
      if(ds&&!singleDS&&!canApplyDSPath(r))throw Error('「構造列を保存・抽出」で取り込むノードを選んでください。');
      const updated=(singleDS?[targetIndex]:r.images.map((_,k)=>k)).map(k=>resultFrame(j,k));
      let next;
      if(updated.length===1&&j.scope==='current'&&j.original.metadata.trajectory){
        next=MV.Model.createState(updated[0]);next.metadata.trajectory=MV.Model.shareTrajectory(j.original.metadata.trajectory);next.metadata.frameIndex=j.original.metadata.frameIndex||0;next.metadata.trajectory[next.metadata.frameIndex]=updated[0];
      }else{const index=ds?0:Number.isInteger(targetIndex)?targetIndex:j.scope==='all'?j.original.metadata.frameIndex||0:0;next=MV.Model.createState(updated[index]||updated[0]);if(updated.length>1){next.metadata.trajectory=updated;next.metadata.frameIndex=index;}}
      if(j.original.metadata.measurements)next.metadata.measurements=JSON.parse(JSON.stringify(j.original.metadata.measurements));
      next.viewSettings={...j.original.viewSettings};app().change('external engine result',()=>next,true);$('dataReset').click();if(ds)j.appliedFingerprint=fingerprint(app().getState());$('engineApply').disabled=true;if(next.metadata.trajectory&&updated.length>1)MV.EnergyProfile.bindTrajectory(next.metadata.trajectory);$('engineDialog').close();app().setStatus(`${modeText[r.mode]}の結果を反映しました（${ds?'経路接続':r.reason==='converged'?'収束':r.reason==='evaluated'?'評価済み':r.reason==='cancelled'?'未収束・中止':r.reason==='failed'?'未収束・計算失敗':r.reason==='no_resolved_peak'?'未収束・経路上の極大を確認できず':'未収束・ステップ上限'}）。「戻す」で計算前へ戻れます。`);
      return true;
    }catch(error){message(error.message);return false;}
  }
  function download(){if(!result)return;const payload={input:result.data,result:result.result},url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='molecule-engine-result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function showSettings(){const dialog=$('engineDialog');if(!dialog.open){if(MV.OptimizationUI?.docked())dialog.show();else dialog.showModal();}}
  function open(){
    if(!job&&!MV.AFIRUI?.isBusy?.())app().freezeDisplayedStructure();
    if(result){const current=fingerprint(app().getState());if(result.fingerprint!==current&&result.appliedFingerprint!==current)clearResult();}
    // Reopening saved input must retain its conditions until the structure changes.
    if(restoredInputFingerprint!==fingerprint(app().getState()))restoredInputFingerprint=null;
    if(!job&&!result&&!restoredInputFingerprint&&$('engineMode').value!=='batch'&&lastSettingsSource!==app().getDisplayedState()){const s=app().getDisplayedState();lastSettingsSource=s;$('engineCharge').value=s.metadata.totalCharge??s.atoms.reduce((sum,a)=>sum+(Number(a.charge)||0),0);$('engineMultiplicity').value=s.metadata.multiplicity??1;if(s.metadata.modelF)MV.ModelFUI?.restore(s.metadata);$('engineScope').value=s.metadata.trajectory?'all':'current';$('engineMode').value=pendingMethod||(s.metadata.trajectory?.length>=3?'cineb':'evaluate');settings();}
    if($('engineMode').value==='dsafir')syncEndpoints();
    showSettings();
  }
  function prepareMethod(mode){
    if(![...Object.keys(modeText),'batch'].includes(mode))throw Error('未対応の計算手法です。');
    open();
    if((job||MV.AFIRUI?.isBusy?.())&&!connection?.info.jobQueue&&!connection?.info.queue){
      message('実行中の計算が終わってから設定を変更してください。');return;
    }
    $('engineMode').value=mode;chooseMode();
    if(mode==='dsafir')message('反応物と生成物を選び、電荷と多重度を確認して実行してください。');
  }
  function prepareBatch(){
    if(job){message('実行中の計算が終わるまでお待ちください。');showSettings();return;}
    open();$('engineMode').value='batch';chooseMode();
  }
  function prepareNEB(mode='cineb'){
    if(!['neb','cineb','lup'].includes(mode))throw Error('未対応の経路計算です。');
    if(job)throw Error('実行中の計算を終了してください。');
    clearResult();open();$('engineMode').value=mode;$('engineScope').value='all';chooseMode();
    message(`構造列を${modeText[mode]}入力に設定しました。電荷・多重度と緩和条件を確認して実行してください。AFIRの人工力は加えません。`);
  }
  function relaxationPotential(j,mode,info){
    const {data,result:r}=j;
    const geometry={mode,symbols:data.symbols,cell:data.cell,charge:data.charge,multiplicity:data.multiplicity};
    const useCurrent=$('dsafirRelaxPotential').value==='current';
    const adjustments=[];
    let potential;
    if(useCurrent){
      potential=modelInput(data.multiplicity);
    }else{
      const uma=r.provenance?.uma,llmlip=r.provenance?.llmlip,solvent=r.provenance?.anysolv;
      const checkpoint=info.anysolv?.checkpointSHA256?.[solvent?.model];
      if(info.engine!==r.engine||(r.engine==='tblite'&&info.method!==r.method)||
         (info.binarySHA256&&r.provenance?.binarySHA256&&info.binarySHA256!==r.provenance.binarySHA256)||
         (checkpoint&&solvent?.checkpointSHA256&&checkpoint!==solvent.checkpointSHA256)||
         (uma&&(uma.model!==info.uma?.model||uma.inference?.base_precision_dtype!==info.uma?.precision))||
         (llmlip&&info.llmlip?.models.find(m=>m.id===llmlip.model)?.sha256!==llmlip.modelSHA256))
        throw Error('DS-AFIRと同じ計算エンジン・モデルに再接続するか、「現在の接続・モデル設定で再評価する」を選択してください。');
      potential={modelF:data.modelF,umaDevice:data.umaDevice,solvation:data.solvation&&{...data.solvation}};
      if(llmlip)potential.llmlip={model:llmlip.model,head:llmlip.head,dtype:llmlip.dtype,...data.llmlip};
      function availableDevice(previous,preferred){
        if(!previous||info.devices?.some(d=>d.id===previous))return previous;
        const available=info.devices?.length?(info.devices.some(d=>d.id===preferred)?preferred:info.devices[0].id):preferred;
        if(!available)throw Error('元のモデルで使用できるデバイスを確認して再接続してください。');
        adjustments.push(previous+' → '+available);
        return available;
      }
      potential.umaDevice=availableDevice(data.umaDevice||uma?.device,$('engineUMADevice').value||info.uma?.device);
      if(potential.solvation)potential.solvation.device=availableDevice(potential.solvation.device,$('engineAnySolvDevice').value||info.anysolv?.device);
      if(potential.llmlip&&info.llmlip){
        const minimum=info.llmlip.workers||1,defaultThreads=info.llmlip.threads||minimum;
        const n=potential.llmlip.threads??llmlip?.threads??defaultThreads;
        potential.llmlip.threads=Math.max(minimum,Math.min(n,info.llmlip.maxThreads??defaultThreads));
        if(n!==potential.llmlip.threads)adjustments.push(n+' → '+potential.llmlip.threads+'スレッド');
      }
    }
    const target={...geometry,...potential};
    validateEngineInput(target,info);
    return {target,useCurrent,adjustments};
  }
  function prepareDSRelaxation(r,mode,indices){
    const j=result,info=connection?.info;
    if(!j||j.result!==r||r?.mode!=='dsafir'||!r.dsafir.connected)throw Error('接続済みのDS-AFIR結果を開いてください。');
    if(job||MV.WorkflowUI?.isBusy()||MV.AFIRUI?.isBusy?.())throw Error('実行中の計算を終了してから経路を取り込んでください。');
    const current=fingerprint(app().getState());
    if(dirty()||(current!==j.fingerprint&&current!==j.appliedFingerprint))throw Error('計算後に入力が変更されています。履歴からDS-AFIR結果を開き直してください。');
    if(!['neb','cineb','lup'].includes(mode)||!info?.modes.includes(mode))throw Error('選択した緩和手法に対応する計算エンジンに接続してください。');
    const {target,useCurrent,adjustments}=relaxationPotential(j,mode,info);
    const endpoints=$('dsafirRelaxEndpoints').value;
    Object.assign(target,endpointModeInput(mode,endpoints,info));
    const max=Math.min(r.images.length,info.maxImages||100,100);
    if(!indices){
      const n=Number($('dsafirRelaxCount').value);
      if(!Number.isInteger(n)||n<3||n>max)throw Error(`緩和には端点を含む3〜${max}ノードを指定してください。`);
      indices=MV.Trajectory.extract(resultSource(r,j),n,'distance',{preservePeaks:true,preserveValleys:true}).indices;
    }
    if(indices.length<3||indices.length>max||indices[0]!==0||indices.at(-1)!==r.images.length-1||
       indices.some((id,k)=>!Number.isInteger(id)||(k>0&&id<=indices[k-1])))throw Error('緩和には両端点を含む順序付きのノード列が必要です。');
    const frames=indices.map(k=>{
      const frame=resultFrame(j,k);
      frame.metadata.pathNodeId='dsafir-'+(k+1);
      if(useCurrent){
        // Only coordinates cross to the new PES. Keep the source index, not its energy as a current result.
        frame.metadata.trajectoryExtraction={sourceKind:'dsafir',sourceFrame:k,sourceCount:r.images.length,
          sourceEngine:r.engine,sourceMethod:r.method,sourceJob:j.id};
        delete frame.metadata.externalCalculation;
        MV.ModelF?.attach(frame,target);
      }
      return frame;
    });
    const next=MV.Model.createState(frames[0]);
    next.metadata.trajectory=frames;next.metadata.frameIndex=0;next.viewSettings={...app().getState().viewSettings};
    if(j.original.metadata.measurements)next.metadata.measurements=JSON.parse(JSON.stringify(j.original.metadata.measurements));
    MV.Constraints?.forJob(next,target,info);
    MV.GroupConstraints?.forJob(next,target,info,MV.Geometry.atomicMass);
    MV.Optimization?.forJob(next,target,info);
    MV.Studio.stop();MV.EnergyProfile.reset();
    app().change('prepare DS-AFIR path relaxation',()=>next,true);$('dataReset').click();
    if($('trajectoryDialog').open)$('trajectoryDialog').close();
    prepareNEB(mode);
    if(climbingModes.includes(mode)){$('engineEndpointMode').value=endpoints;syncEndpointMode();}
    $('engineCharge').value=j.data.charge;$('engineMultiplicity').value=j.data.multiplicity;
    restorePotential(target);
    const note=useCurrent?'現在のモデル設定で各ノードのエネルギーと力を再評価します。':'';
    const resources=adjustments.length?'元の設定から計算資源を変更しました（'+[...new Set(adjustments)].join('、')+'）。':'';
    message(`DS-AFIRの初期経路（${frames.length}ノード）を${modeText[mode]}の入力にしました。${endpointDescription(mode,endpoints)}${note}${resources}緩和条件を確認して「計算を実行」を押してください。`);
    $('engineMode').focus?.();
  }
  function prepareSingle(mode){
    if(job){message('実行中の計算を終了してください。');showSettings();return;}
    try{app().useDisplayedStructure();}catch(e){message(e.message);showSettings();return;}
    clearResult();open();$('engineMode').value=mode;$('engineScope').value='current';chooseMode();
    message(mode==='optimize'?'現在の構造を最適化入力にしました。重心拘束・原子固定・計算条件を確認して実行してください。':mode==='irc'?'現在の構造をIRC入力にしました。TS候補の収束と計算条件を確認してください。':mode==='scan'?'現在の構造をスキャンの出発点にしました。原子番号と座標の範囲を指定してください。':mode==='ts'?'現在表示中の構造をTS入力にしました。手法・電荷・多重度・振動解析の有無を確認して実行してください。':'現在の構造で振動解析します。未収束構造も対象にできます。');
  }
  function refineResult(){
    try{
      const j=result;if(!j)return;if(job)throw Error('計算の終了処理を待ってください。');
      if(dirty()||fingerprint(app().getState())!==j.fingerprint)throw Error('計算後に入力が変更されています。結果JSONを保存するか、再計算してください。');
      validateResult(j.result,j);
      const frames=j.result.images.map((_,k)=>{const f=baseFrame(j,k);const s=MV.Model.createState(f);s.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=j.result.images[k][i];});s.metadata.totalCharge=j.data.charge;s.metadata.multiplicity=j.data.multiplicity;if(j.result.nodeIds)s.metadata.pathNodeId=j.result.nodeIds[k];delete s.metadata.externalCalculation;delete s.metadata.afirCalculation;MV.ModelF?.attach(s,j.data);MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);});
      $('engineDialog').close();MV.PathRefinement.open(frames,['lup','neb'].includes(j.data.mode)?j.data.mode:'cineb');
    }catch(e){message(e.message);}
  }
  function framesFromData(data){
    return data.images.map(positions=>{const s=MV.Model.createState({atoms:data.symbols.map((element,i)=>({id:data.atomIds?.[i],element,x:positions[i][0],y:positions[i][1],z:positions[i][2]})),metadata:{title:'保存された計算',cell:data.cell,totalCharge:data.charge,multiplicity:data.multiplicity,...(data.afir?{afir:JSON.parse(JSON.stringify(data.afir))}:{})}});MV.Bonding.refreshInferredBonds(s);MV.Optimization.attach(s,data);MV.ModelF?.attach(s,data);if(data.fixedAtoms?.length)MV.Constraints.attach(s,data.fixedAtoms);if(data.groupConstraints){MV.GroupConstraints.attach(s,data.groupConstraints);s.atoms.forEach((a,i)=>{a.xyzExtras={...a.xyzExtras,mass:{type:'R',values:[String(data.groupConstraints.masses[i])]}};});}return MV.Periodic.snapshot(s);});
  }
  function restorePotential(data){
    if(data.umaDevice)$('engineUMADevice').value=data.umaDevice;
    $('engineAnySolv').checked=!!data.solvation;
    if(data.solvation){
      $('engineAnySolvModel').value=data.solvation.model;
      $('engineAnySolvDevice').value=data.solvation.device;
      $('engineSolvent').value=data.solvation.solvent;
    }
    MV.LLMLIPUI?.restore(data);MV.ModelFUI?.restore(data);modelControls();
  }
  function restoreInput(data){
    const mode=data.mode==='afir'?'optimize':data.mode;pendingMethod=null;$('engineMode').value=mode;settings();$('engineScope').value=pathModes.includes(mode)||mode==='dsafir'?'all':'current';
    for(const [key,id] of Object.entries({charge:'engineCharge',multiplicity:'engineMultiplicity',maxSteps:'engineSteps',fmax:'engineFmax',spring:'engineSpring',maxMove:'engineMove',climbAfter:'engineClimb',trustRadius:'engineTrust'}))if(data[key]!=null)$(id).value=data[key];
    if(climbingModes.includes(mode)){$('engineEndpointMode').value=data.endpointMode??'fixed';syncEndpointMode();}
    if(data.optimizer&&!['lup','dsafir'].includes(data.mode))$(data.mode==='ts'?'engineTSMethod':'engineOptimizer').value=data.optimizer;
    $('engineVibrationCheck').checked=!!data.vibrations;if(data.vibrations)for(const [key,id] of Object.entries({delta:'engineVibrationDelta',nfree:'engineVibrationNfree',imaginaryThreshold:'engineVibrationThreshold'}))$(id).value=data.vibrations[key];
    restorePotential(data);MV.ResearchUI?.restore(data);MV.OptimizationUI?.restore(data);
  }
  function contextForSaved(saved){
    if(!saved?.data||!Array.isArray(saved.data.symbols)||!Array.isArray(saved.data.images))throw Error('保存された入力構造がありません。');
    const all=framesFromData(saved.data),original=MV.Model.createState(all[0]);if(all.length>1){original.metadata.trajectory=all;original.metadata.frameIndex=0;}
    return {id:saved.id,data:saved.data,frames:all,original,fingerprint:fingerprint(app().getState()),scope:all.length>1?'all':'current',connection:{...connection},livePreview:false};
  }
  function restoreJob(saved,inputOnly=false){
    if(job||MV.AFIRUI?.isBusy?.())throw Error('実行中の計算の追跡を終了してから、履歴を開いてください。');
    const j=contextForSaved(saved);MV.EnergyProfile.reset();restoreInput(saved.data);clearResult();restoredInputFingerprint=null;
    if(inputOnly){app().change('restore saved calculation input',()=>j.original,true);$('dataReset').click();restoredInputFingerprint=fingerprint(app().getState());if(saved.data.mode==='dsafir'){syncEndpoints();$('dsafirStart').value=0;$('dsafirEnd').value=1;}message(saved.data.mode==='afir'?'AFIRの保存入力を復元しました。人工力を含む再計算は履歴の「保存構造から再開」を使用してください。':'保存された入力構造と計算条件を復元しました。');}
    else if(saved.result){showResult(saved.result,j);if(saved.data.mode!=='dsafir')message('保存済みの結果を開きました。構造への適用・構造列の保存ができます。');}
    else message('結果はまだ保存されていません。実行中の計算は履歴から追跡できます。');
    $('jobHistoryDialog').close();showSettings();return j;
  }
  async function enqueueCurrent(){
    if(!connection?.info.jobQueue&&!connection?.info.queue)throw Error('接続中のサーバーはキューに対応していません。');
    try{if($('engineMode').value==='batch')throw Error('実行中の計算がある場合、一括最適化は完了後に開始してください。');const j=input();j.data.livePreview=$('engineLive').checked;const created=await request(connection,'/api/jobs',j.data);message(`キューへ追加しました（${created.id.slice(0,8)}）。現在追跡している計算は継続します。`);MV.JobHistoryUI?.changed();return created;}catch(e){message(e.message);throw e;}
  }
  async function watchSaved(saved){
    if(job||MV.AFIRUI?.isBusy?.())throw Error('別の計算を追跡中です。終了後に履歴から選択してください。');
    const j=contextForSaved(saved);j.livePreview=$('engineLive').checked;j.cancelRequested=false;
    restoreInput(saved.data);clearResult();MV.EnergyProfile.reset();job=j;busy(true);MV.DiagnosticsUI?.reset();
    if(j.livePreview){MV.EnergyProfile.begin(cancel,open);MV.EnergyProfile.reveal();}
    try{await watch(j);}catch(e){message(e.message);}finally{if(job===j){job=null;busy(false);MV.EnergyProfile.finish();MV.JobHistoryUI?.changed();}}
  }
  function prepareSegment(segment){
    const j=result;if(!j)return;if(job)throw Error('計算の完了後に区間を選んでください。');if(dirty()||fingerprint(app().getState())!==j.fingerprint)throw Error('入力が変更されています。履歴から結果を開き直してください。');
    const a=segment.start,b=segment.end;if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b>=j.result.images.length||b<=a)throw Error('分割区間が不正です。');
    const frames=j.result.images.slice(a,b+1).map((positions,k)=>{const f=MV.Model.createState(baseFrame(j,a+k));f.atoms.forEach((atom,i)=>{[atom.x,atom.y,atom.z]=positions[i];});delete f.metadata.externalCalculation;delete f.metadata.afirCalculation;f.metadata.totalCharge=j.data.charge;f.metadata.multiplicity=j.data.multiplicity;f.metadata.pathNodeId=j.result.nodeIds?.[a+k];MV.ModelF?.attach(f,j.data);MV.Bonding.refreshInferredBonds(f);return MV.Periodic.snapshot(f);});
    if(frames.length===2){const f=MV.Model.createState(frames[0]);f.atoms.forEach((atom,i)=>{for(const axis of ['x','y','z'])atom[axis]=(frames[0].atoms[i][axis]+frames[1].atoms[i][axis])/2;});delete f.metadata.pathNodeId;frames.splice(1,0,MV.Periodic.snapshot(f));}
    const mode=j.data.mode==='lup'?'lup':'cineb',next=MV.Model.createState(frames[0]);next.metadata.trajectory=frames;next.metadata.frameIndex=0;app().change('select path segment',()=>next,true);$('dataReset').click();prepareNEB(mode);message(segment.needsEndpointOptimization?`この区間の端点には未収束の谷が含まれます。「両端を極小構造へ緩和」を選ぶと、端点も${modeText[mode]}で同時に緩和できます。`:`分割した区間を${modeText[mode]}入力にしました。計算条件を確認してください。`);
  }
  function init(){
    if(location.hostname==='127.0.0.1'||location.hostname==='localhost')$('engineURL').value=location.origin;
    for(const id of ['dsafirStart','dsafirEnd'])$(id).addEventListener('change',syncEndpoints);
    $('btnTS').addEventListener('click',()=>prepareSingle('ts'));$('btnVibrations').addEventListener('click',()=>prepareSingle('vibrations'));
    $('engineVibrationShow').addEventListener('click',()=>{$('engineDialog').close();MV.VibrationUI.show();});$('engineRefine').addEventListener('click',refineResult);
    $('enginePause').addEventListener('click',()=>{if(job){job.pauseRequested=true;cancel();}});
    $('btnExternalEngine').addEventListener('click',open);$('engineConnect').addEventListener('click',connect);$('engineMode').addEventListener('change',chooseMode);$('engineRun').addEventListener('click',run);$('engineCancel').addEventListener('click',cancel);$('engineApply').addEventListener('click',()=>apply());$('engineDownload').addEventListener('click',download);
    for(const id of ['engineAnySolv','engineAnySolvModel','engineSolvent','engineUMADevice','engineAnySolvDevice'])$(id).addEventListener('change',modelControls);
    for(const id of ['engineChoice','engineURL','engineToken'])$(id).addEventListener('input',()=>{connection=null;connectionDetails();$('engineRun').disabled=true;$('engineConnected').textContent='未接続';MV.AFIRUI?.sync();});
    $('engineProfile').addEventListener('click',()=>{if(result){showProfile(result.result,result);$('engineDialog').close();MV.EnergyProfile.reveal();}});
    $('dsafirRelaxCount').addEventListener('input',syncDSRelaxation);
    for(const id of ['dsafirRelaxPotential','dsafirRelaxMode','dsafirRelaxEndpoints'])$(id).addEventListener('change',syncDSRelaxation);
    $('engineEndpointMode').addEventListener('change',syncEndpointMode);
    $('dsafirRelaxPrepare').addEventListener('click',()=>{
      try{prepareDSRelaxation(result?.result,$('dsafirRelaxMode').value);}
      catch(error){message(error.message);$('dsafirRelaxHelp').textContent=error.message;}
    });
    $('engineXYZ').addEventListener('click',()=>{if(result)exportXYZ(result.result,result);});
    MV.LLMLIPUI?.init();MV.ModelFUI?.init();MV.ResearchUI?.init();MV.JobHistoryUI?.init();MV.DiagnosticsUI?.init();MV.StructureAnalysisUI?.init();MV.OptimizationUI?.init();MV.WorkflowUI?.init();
    $('engineDialog').addEventListener('cancel',e=>{if(job){e.preventDefault();cancel();}});settings();
  }
  MV.EngineUI={syncEndpoints,modeLabel:mode=>modeText[mode],init,open,showSettings,apply,showResult,showProfile,resultSource,getResult:()=>result,modelInput,modelSummary,validateSolvationResult,syncModelBusy:()=>{const afirBusy=!!MV.AFIRUI?.isBusy?.(),queued=connection?.info.jobQueue||connection?.info.queue;$('engineModelSettings').disabled=(!!job||afirBusy)&&!queued;if(!job){$('engineRun').textContent=afirBusy&&queued?'現在の設定をキューへ追加':'計算を実行';$('engineRun').disabled=!connection||(afirBusy&&!queued);}},prepareMethod,prepareBatch,endpoint,pollJob,frames,validateResult,validateEngineInput,request,prepareNEB,prepareSingle,settings,input,restoreInput,restoreJob,watchSaved,prepareSegment,enqueueCurrent,baseFrame,isBusy:()=>!!job||!!MV.WorkflowUI?.isBusy(),getConnection:()=>connection?{...connection}:null};
})(window);
