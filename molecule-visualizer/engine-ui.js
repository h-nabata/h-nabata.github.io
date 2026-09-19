/* Local-only external energy/gradient jobs. Tokens live in memory, never in projects. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),app=()=>MV.App;
  let connection=null,job=null,result=null;
  const fingerprint=s=>JSON.stringify([s.atoms,s.bonds,s.metadata]);
  const dirty=()=>/未適用|編集中/.test($('xyzEditStatus').textContent);
  const message=text=>{$('engineMessage').textContent=text;};
  const modeText={evaluate:'エネルギー・力の評価',optimize:'単一構造の最適化',perpendicular:'接線に直交する緩和',neb:'NEB',cineb:'CI-NEB'};
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
  function busy(value){$('engineSettings').disabled=value;$('engineConnection').disabled=value;$('engineRun').disabled=value||!connection;$('engineCancel').disabled=!value;$('engineClose').disabled=value;}
  function settings(){
    const mode=$('engineMode').value,path=['perpendicular','neb','cineb'].includes(mode);
    if(path)$('engineScope').value='all';if(mode==='optimize')$('engineScope').value='current';$('engineScope').disabled=path||mode==='optimize';
    $('engineRelaxSettings').hidden=mode==='evaluate';$('engineSpringLabel').hidden=!['neb','cineb'].includes(mode);$('engineClimbLabel').hidden=mode!=='cineb';
    $('engineModeHelp').textContent={evaluate:'座標は変更せず、指定した構造のエネルギーと力を計算します。',optimize:'現在の1構造を、外部エンジンの力で最適化します。セルは固定します。',perpendicular:'全原子の3N次元接線に直交する力・座標更新だけを使います。端点固定、接線方向のばね・再配置なし。',neb:'物理的な力の接線成分を除き、構造間隔を保つための接線方向のばね力を加えます。端点固定。',cineb:'初めはNEBで緩和し、指定ステップ以降、最高エネルギーの内部構造を接線方向へ登らせます。CI構造は直交緩和の例外です。端点固定。'}[mode];
  }
  function frames(state,scope){
    if(scope==='current'||!state.metadata.trajectory)return [MV.Periodic.snapshot(state)];
    const all=JSON.parse(JSON.stringify(state.metadata.trajectory));all[state.metadata.frameIndex||0]=MV.Periodic.snapshot(state);return all;
  }
  function input(){
    if(dirty())throw Error('座標編集欄の未適用データを先に適用するか、現在の構造を再表示してください。');
    const state=app().getState(),all=frames(state,$('engineScope').value),mode=$('engineMode').value;
    const symbols=all[0].atoms.map(a=>a.element),cell=all[0].metadata.cell||null;
    if(!symbols.length||symbols.length>500||all.length>20)throw Error('外部計算は1〜500原子、最大20構造です。');
    if(['perpendicular','neb','cineb'].includes(mode)&&all.length<3)throw Error('先に「反応経路」で端点を含む3〜20構造を生成するか、複数構造XYZなどを読み込んでください。');
    for(const f of all){
      if(JSON.stringify(f.atoms.map(a=>a.element))!==JSON.stringify(symbols))throw Error('全フレームの元素とFile-orderを一致させてください。');
      if(JSON.stringify(f.metadata.cell||null)!==JSON.stringify(cell))throw Error('経路全体で同じセル・周期方向が必要です。可変セル計算には対応していません。');
      if(f.atoms.some(a=>a.xyzExtras?.occupancy&&Number(a.xyzExtras.occupancy.values[0])!==1))throw Error('部分占有サイトがあります。計算前に占有を確定した構造にしてください。');
    }
    if(cell?.pbc.some(Boolean)&&!connection.info.periodic)throw Error('接続中のエンジンは周期系に対応していません。tbliteでサービスを起動してください。');
    const data={symbols,images:all.map(f=>f.atoms.map(a=>[a.x,a.y,a.z])),cell,mode,charge:Number($('engineCharge').value),multiplicity:Number($('engineMultiplicity').value),maxSteps:Number($('engineSteps').value),fmax:Number($('engineFmax').value),spring:Number($('engineSpring').value),maxMove:Number($('engineMove').value),climbAfter:Number($('engineClimb').value)};
    for(const [key,lo,hi,integer] of [['charge',-100,100,true],['multiplicity',1,101,true],['maxSteps',1,1000,true],['fmax',.00001,10,false],['spring',.001,10,false],['maxMove',.001,.2,false],['climbAfter',0,500,true]])if(!Number.isFinite(data[key])||data[key]<lo||data[key]>hi||(integer&&!Number.isInteger(data[key])))throw Error(`${key}は${lo}〜${hi}${integer?'の整数':''}にしてください。`);
    if(mode==='cineb'&&data.climbAfter>=data.maxSteps)throw Error('CI開始ステップを最大ステップ数より小さくしてください。');
    return {data,frames:all,scope:$('engineScope').value,fingerprint:fingerprint(state),original:MV.Model.cloneState(state)};
  }
  async function connect(){
    if(job)return;connection=null;$('engineRun').disabled=true;$('engineConnect').disabled=true;
    try{
      const c={url:endpoint($('engineURL').value),token:$('engineToken').value.trim()};if(!c.token)throw Error('サービス起動時に表示されるTokenを入力してください。');
      c.info=await request(c,'/api/info');if(c.info.version!=='1.0.0'||!Array.isArray(c.info.modes))throw Error('サービスのバージョンが一致しません。最新のbridge.pyを使用してください。');connection=c;
      $('engineConnected').textContent=`接続済み: ${c.info.engine} / ${c.info.method} · ${c.info.engineVersion} · ${c.info.periodic?'固定セル周期系対応':'非周期系'}`;message('接続しました。電荷と多重度を確認して計算を実行してください。');
    }catch(error){$('engineConnected').textContent='未接続';message(error.message);}finally{$('engineConnect').disabled=false;busy(false);}
  }
  function clearResult(){result=null;$('engineResult').hidden=true;$('engineApply').disabled=true;$('engineDownload').disabled=true;}
  function validateResult(r,j){
    if(!r||JSON.stringify(r.symbols)!==JSON.stringify(j.data.symbols)||JSON.stringify(r.cell)!==JSON.stringify(j.data.cell)||r.images?.length!==j.frames.length||r.energies?.length!==j.frames.length||r.units?.energy!=='eV'||r.units?.length!=='angstrom')throw Error('結果の元素・セル・構造数・単位が入力と一致しません。');
    if(!r.images.every(p=>Array.isArray(p)&&p.length===j.data.symbols.length&&p.every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000)))||!r.energies.every(Number.isFinite)||!Number.isFinite(r.effectiveFmax)||!Array.isArray(r.imageFmax)||r.imageFmax.length!==j.frames.length||!r.imageFmax.every(Number.isFinite))throw Error('計算結果に不正な座標・エネルギー・力が含まれます。');
    if(['perpendicular','neb','cineb'].includes(j.data.mode))for(const i of [0,j.frames.length-1])if(JSON.stringify(r.images[i])!==JSON.stringify(j.data.images[i]))throw Error('端点座標が変更された結果は適用できません。');
  }
  function showResult(r,j){
    validateResult(r,j);result={...j,result:r};$('engineResult').hidden=false;$('engineApply').disabled=false;$('engineDownload').disabled=false;
    const reason={converged:'収束',step_limit:'ステップ上限（未収束）',evaluated:'評価完了'}[r.reason]||r.reason;
    $('engineResultSummary').textContent=`${modeText[r.mode]} · ${reason} · ${r.steps}ステップ · ${r.evaluations}回の評価 · 最大有効力 ${r.effectiveFmax.toPrecision(4)} eV/Å`+(r.maxTangentialStep!=null?` · 接線方向の最大更新 ${r.maxTangentialStep.toExponential(2)} Å`:'');
    const body=$('engineEnergyRows');body.replaceChildren();r.energies.forEach((energy,i)=>{const tr=document.createElement('tr');const fixed=['perpendicular','neb','cineb'].includes(r.mode)&&(i===0||i===r.energies.length-1);for(const value of [i+1,energy.toFixed(8),(energy-r.energies[0]).toFixed(6),fixed?'端点固定':r.imageFmax[i].toPrecision(4),i===r.climbingImage?'CI':'']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);});
    const svg=$('enginePlot');svg.replaceChildren();const ns='http://www.w3.org/2000/svg',relative=r.energies.map(e=>e-r.energies[0]),lo=Math.min(0,...relative),hi=Math.max(...relative),span=Math.max(hi-lo,1e-8),points=relative.map((e,i)=>[30+i*500/Math.max(1,relative.length-1),145-(e-lo)*115/span]);
    const line=document.createElementNS(ns,'polyline');line.setAttribute('points',points.map(p=>p.join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#087c83');line.setAttribute('stroke-width','2');svg.append(line);
    points.forEach(([x,y],i)=>{const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r',i===r.climbingImage?5:3);circle.setAttribute('fill',i===r.climbingImage?'#bf582c':'#087c83');const title=document.createElementNS(ns,'title');title.textContent=`構造 ${i+1}: ${relative[i].toFixed(6)} eV`;circle.append(title);svg.append(circle);});
    for(const [text,x,y] of [[`ΔE (始点基準): ${lo.toFixed(4)} 〜 ${hi.toFixed(4)} eV`,15,18],['構造番号 →',450,170]]){const node=document.createElementNS(ns,'text');node.setAttribute('x',x);node.setAttribute('y',y);node.setAttribute('font-size',12);node.textContent=text;svg.append(node);}
    message('計算が完了しました。結果を確認し、「結果を構造へ適用」で反映してください。');
  }
  async function run(){
    if(job||!connection)return;
    let j;
    try{
      j={...input(),connection:{...connection},cancelRequested:false};clearResult();job=j;busy(true);message('ローカル計算を開始しています…');
      const created=await request(j.connection,'/api/jobs',j.data);if(!/^[a-f0-9]{32}$/.test(created.id))throw Error('不正な計算IDです。');j.id=created.id;
      if(j.cancelRequested)await request(j.connection,`/api/jobs/${j.id}/cancel`,{});
      while(job===j){
        const state=await request(j.connection,`/api/jobs/${j.id}`);
        if(state.status==='completed'){showResult(state.result,j);break;}
        if(state.status==='error')throw Error(state.error||'計算に失敗しました。');
        if(state.status==='cancelled'){message('計算を中止しました。構造は変更していません。');break;}
        const p=state.progress||{};message(`計算中: ステップ ${p.step??0} / ${j.data.maxSteps} · 構造 ${p.image??0}/${j.frames.length}`+(p.fmax!=null?` · 最大有効力 ${p.fmax.toPrecision(4)} eV/Å`:'')+(j.cancelRequested?' · 中止処理中':''));
        await new Promise(resolve=>setTimeout(resolve,600));
      }
    }catch(error){message(error.message+(j?.id?' 接続が途切れた場合、計算はローカル側で継続している可能性があります。サービスをCtrl+Cで停止できます。':''));}
    finally{if(job===j){job=null;busy(false);}}
  }
  async function cancel(){
    const j=job;if(!j)return;j.cancelRequested=true;$('engineCancel').disabled=true;message('計算を中止しています…');
    try{if(j.id)await request(j.connection,`/api/jobs/${j.id}/cancel`,{});}catch(error){message(error.message+' ローカル端末でCtrl+Cを押して停止してください。');$('engineCancel').disabled=false;}
  }
  function apply(){
    try{
      const j=result;if(!j)return;if(dirty()||fingerprint(app().getState())!==j.fingerprint)throw Error('計算開始後に構造または編集欄が変更されています。結果は適用できません。JSONを保存するか、再計算してください。');validateResult(j.result,j);
      const r=j.result,updated=j.frames.map((f,k)=>{
        const s=MV.Model.createState(f);s.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=r.images[k][i];});
        s.metadata.totalCharge=j.data.charge;s.metadata.multiplicity=j.data.multiplicity;
        s.metadata.externalCalculation={engine:r.engine,method:r.method,energyEV:r.energies[k],mode:r.mode,converged:r.converged,reason:r.reason,steps:r.steps,effectiveFmax:r.imageFmax[k],charge:j.data.charge,multiplicity:j.data.multiplicity};
        if(r.mode!=='evaluate')MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);
      });
      let next;
      if(j.scope==='current'&&j.original.metadata.trajectory){
        next=MV.Model.createState(updated[0]);next.metadata.trajectory=JSON.parse(JSON.stringify(j.original.metadata.trajectory));next.metadata.frameIndex=j.original.metadata.frameIndex||0;next.metadata.trajectory[next.metadata.frameIndex]=updated[0];
      }else{const index=j.scope==='all'?j.original.metadata.frameIndex||0:0;next=MV.Model.createState(updated[index]||updated[0]);if(updated.length>1){next.metadata.trajectory=updated;next.metadata.frameIndex=index;}}
      next.viewSettings={...j.original.viewSettings};app().change('external engine result',()=>next,true);$('dataReset').click();$('engineApply').disabled=true;$('engineDialog').close();app().setStatus(`${modeText[r.mode]}の結果を反映しました（${r.reason==='converged'?'収束':r.reason==='evaluated'?'評価済み':'未収束・ステップ上限'}）。「戻す」で計算前へ戻れます。`);
    }catch(error){message(error.message);}
  }
  function download(){if(!result)return;const payload={input:result.data,result:result.result},url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='molecule-engine-result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function open(){
    if(result&&result.fingerprint!==fingerprint(app().getState()))clearResult();
    if(!job&&!result){const s=app().getState();$('engineCharge').value=s.metadata.totalCharge??s.atoms.reduce((sum,a)=>sum+(Number(a.charge)||0),0);$('engineMultiplicity').value=s.metadata.multiplicity??1;$('engineScope').value=s.metadata.trajectory?'all':'current';$('engineMode').value=s.metadata.trajectory?.length>=3?'perpendicular':'evaluate';settings();}
    $('engineDialog').showModal();
  }
  function init(){
    if(location.hostname==='127.0.0.1'||location.hostname==='localhost')$('engineURL').value=location.origin;
    $('btnExternalEngine').addEventListener('click',open);$('engineConnect').addEventListener('click',connect);$('engineMode').addEventListener('change',settings);$('engineRun').addEventListener('click',run);$('engineCancel').addEventListener('click',cancel);$('engineApply').addEventListener('click',apply);$('engineDownload').addEventListener('click',download);
    for(const id of ['engineURL','engineToken'])$(id).addEventListener('input',()=>{connection=null;$('engineRun').disabled=true;$('engineConnected').textContent='未接続';});
    $('engineDialog').addEventListener('cancel',e=>{if(job){e.preventDefault();cancel();}});settings();
  }
  MV.EngineUI={init,endpoint,frames,validateResult};
})(window);
