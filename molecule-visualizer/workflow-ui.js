/* Explicitly started local workflows. The browser advances only validated jobs. */
(function(global){
 'use strict';const M=global.MoleculeVisualizer,$=id=>document.getElementById(id);
 const recipes={minimum:{name:'MIN → 振動解析',steps:['optimize','vibrations']},reaction:{name:'CI-NEB → TS → 振動解析 → IRC',steps:['cineb','ts','vibrations','irc']},string:{name:'LUP系 → TS → 振動解析 → IRC',steps:['lup','ts','vibrations','irc']},conformers:{name:'配座生成 → 一括MIN → 重複除去',steps:['generate','batch','deduplicate']}};
 let active=null,results=[],record=null;
 const clone=x=>JSON.parse(JSON.stringify(x));
 function message(text){$('workflowMessage').textContent=text;}
 function button(text,fn){const b=document.createElement('button');b.className='mv-btn';b.type='button';b.textContent=text;b.onclick=fn;return b;}
 function choose(){const type=$('workflowRecipe').value,recipe=recipes[type];$('workflowSteps').textContent=recipe.name;M.EngineUI.prepareSingle(type==='conformers'?'optimize':recipe.steps[0]);$('workflowConformers').hidden=type!=='conformers';}
 function fingerprint(s){return JSON.stringify([s.atoms,s.bonds,s.metadata]);}
 function stageConditions(){return {tsMethod:$('engineTSMethod').value,trustRadius:Number($('engineTrust').value),vibrations:{delta:Number($('engineVibrationDelta').value),nfree:Number($('engineVibrationNfree').value),imaginaryThreshold:Number($('engineVibrationThreshold').value)},irc:{direction:'both',stepSize:Number($('ircStepSize').value),relaxEndpoints:true}};}
 function stageInput(base,mode,images,conditions){
  const keys=['symbols','atomIds','cell','charge','multiplicity','maxSteps','fmax','maxMove','umaDevice','solvation'];const data={};for(const key of keys)if(base[key]!=null)data[key]=clone(base[key]);data.mode=mode;data.images=clone(images);
  if(mode==='optimize')for(const key of ['optimizer','stagedOptimization','fixedAtoms','fixedComponents','rigidGroups','groupConstraints','internalConstraints','cellOptimization'])if(base[key]!=null)data[key]=clone(base[key]);
  if(mode==='ts'){data.optimizer=conditions.tsMethod;data.trustRadius=conditions.trustRadius;}
  if(mode==='vibrations')data.vibrations=clone(conditions.vibrations);
  if(mode==='irc')data.irc=clone(conditions.irc);
  if(['cineb','lup'].includes(mode))for(const key of ['spring','climbAfter','optimizer','lup','adaptiveNEB','pathSplit','nodeIds'])if(base[key]!=null)data[key]=clone(base[key]);
  return data;
 }
 function frames(data,base){return data.images.map(p=>{const s=M.Model.createState(M.Periodic.snapshot(base));s.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=p[i];});s.metadata.cell=data.cell||null;return M.Periodic.snapshot(s);});}
 async function job(data,context,label){if(active.cancelled)throw Error('計算手順を中止しました。');const c=active.connection,j={...context,data,frames:frames(data,context.original),connection:c,scope:data.images.length>1?'all':'current'};
  const created=await M.EngineUI.request(c,'/api/jobs',data);if(!/^[a-f0-9]{32}$/.test(created.id))throw Error('不正な計算IDです。');active.jobId=created.id;j.id=created.id;record.jobs.push({id:created.id,label,data:clone(data)});
  if(active.cancelled)await M.EngineUI.request(c,`/api/jobs/${created.id}/cancel`,{});
  for(;;){const state=await M.EngineUI.pollJob(j,false);message(`${label} · ${state.status} · ステップ ${state.progress?.step??0}`);
   if(['completed','cancelled','error','interrupted'].includes(state.status)){
    if(state.result){M.EngineUI.validateResult(state.result,j);j.result=state.result;results.push(j);record.jobs.at(-1).result=state.result;renderResults();}
    active.jobId=null;if(active.cancelled||state.status!=='completed')throw Error(state.error||'計算手順を中止しました。');if(!state.result)throw Error('結果が返されませんでした。');
    return j;
   }await new Promise(resolve=>setTimeout(resolve,600));
  }
 }
 function generate(state,options){return new Promise((resolve,reject)=>{const worker=new Worker('./generation-worker.js?v=performance-41');active.worker=worker;const timeout=setTimeout(()=>{worker.terminate();reject(Error('配座生成が時間上限を超えました。'));},120000);
  const finish=()=>{clearTimeout(timeout);worker.terminate();if(active){active.worker=null;active.rejectGeneration=null;}};
  active.rejectGeneration=error=>{finish();reject(error);};
  worker.onmessage=e=>{if(e.data.progress!=null){message('配座生成 '+Math.round(e.data.progress*100)+'%');return;}finish();if(e.data.error)reject(Error(e.data.error));else resolve(e.data.result);};worker.onerror=e=>{finish();reject(Error(e.message||'配座生成に失敗しました。'));};worker.postMessage({kind:'random',state:M.Periodic.snapshot(state),options});
 });}
 function requireConvergence(j){if(!j.result.converged)throw Error('未収束のため後続計算を停止しました。完了済みの結果は下の一覧と計算履歴から確認できます。');}
 async function run(){if(active||M.EngineUI.isBusy()||M.AFIRUI?.isBusy())return;let recipe;
  try{
   const connection=M.EngineUI.getConnection();if(!connection)throw Error('先にローカル計算エンジンに接続してください。');recipe=clone(recipes[$('workflowRecipe').value]);
   const context=M.EngineUI.input(),base=clone(context.data),kind=$('workflowRecipe').value;
   const conditions=stageConditions();
   if(base.mode!==(kind==='conformers'?'optimize':recipe.steps[0]))throw Error('手順を選び直して、最初の計算モードと入力構造を確認してください。');
   if(kind!=='conformers'&&context.original.atoms.some(a=>a.mol?.props?.MASS||a.xyzExtras?.mass||a.xyzExtras?.masses))throw Error('振動解析を含む手順は個別原子質量に未対応です。');
   if(kind!=='conformers'&&(!connection.info.vibrations||recipe.steps.some(mode=>!connection.info.modes.includes(mode))))throw Error('この手順に必要な計算モードへbridge.pyを更新してください。');
   if(kind!=='conformers'&&(![2,4].includes(conditions.vibrations.nfree)||!Number.isFinite(conditions.vibrations.delta)||conditions.vibrations.delta<.0001||conditions.vibrations.delta>.1||!Number.isFinite(conditions.vibrations.imaginaryThreshold)||conditions.vibrations.imaginaryThreshold<0||conditions.vibrations.imaginaryThreshold>1000))throw Error('振動解析の差分条件・閾値を確認してください。');
   if(['reaction','string'].includes(kind)&&(!Number.isFinite(conditions.trustRadius)||conditions.trustRadius<.001||conditions.trustRadius>.2||!Number.isFinite(conditions.irc.stepSize)||conditions.irc.stepSize<.005||conditions.irc.stepSize>.5))throw Error('TSの信頼半径・IRCの刻みを確認してください。');
   if(kind!=='conformers'&&base.symbols.length>200)throw Error('振動解析を含む手順は200原子までです。');
   if(kind==='conformers'&&base.cell?.pbc.some(Boolean))throw Error('配座探索の計算手順は非周期分子用です。');
   if(kind!=='conformers'&&base.cell?.pbc.some(Boolean))throw Error('振動・TS・IRCを含む計算手順は非周期分子用です。');
   if(kind!=='conformers'&&(base.fixedAtoms?.length||base.fixedComponents?.length||base.rigidGroups?.length||base.groupConstraints||base.internalConstraints?.length))throw Error('振動・TS・IRCを含む手順では拘束を解除してください。');
   if(['reaction','string'].includes(kind)&&!connection.info.sellaVersion)throw Error('TS・IRCにはSellaが必要です。');
   active={connection,cancelled:false,jobId:null};results=[];record={schema:'molecule-workflow/1',recipe,conditions,started:new Date().toISOString(),jobs:[],status:'running'};
   $('workflowRun').disabled=true;$('workflowCancel').disabled=false;$('workflowSaveResults').disabled=true;
   if(kind==='conformers'){
    const count=Number($('workflowCount').value),seed=Number($('workflowSeed').value),threshold=Number($('workflowRmsd').value);
    if(!Number.isInteger(count)||count<1||count>20||!Number.isInteger(seed)||seed<0||seed>4294967295||!Number.isFinite(threshold)||threshold<0||threshold>10)throw Error('配座数・乱数シード・RMSD閾値を確認してください。');
    record.generation={count,seed,mode:'torsion',rings:true,ringAngle:30};const generated=await generate(context.original,record.generation);record.generationMessage=generated.message;
    const structures=generated.state.metadata.trajectory||[M.Periodic.snapshot(generated.state)],completed=[];
    for(const [i,frame] of structures.entries()){const d=stageInput(base,'optimize',[frame.atoms.map(a=>[a.x,a.y,a.z])],conditions);const j=await job(d,context,`配座 ${i+1}/${structures.length} MIN`);requireConvergence(j);completed.push(j);}
    if(active.cancelled)throw Error('計算手順を中止しました。');
    const cluster=M.StructureAnalysis.deduplicate(completed.map(j=>j.result.images[0]),{symbols:base.symbols,energies:completed.map(j=>j.result.energies[0]),conditionKeys:completed.map(()=>JSON.stringify({...base,images:null})),threshold});record.clusters=cluster;renderResults();message(`完了: ${structures.length}配座 → ${cluster.representatives.length}代表構造。${generated.message}`);
   }else{
    let images=base.images,last=null;
    for(const [index,mode] of recipe.steps.entries()){
     const d=stageInput(base,mode,images,conditions),j=await job(d,context,`${index+1}/${recipe.steps.length} ${mode}`);last=j;
     if(mode==='vibrations'){
      const v=j.result.vibrations,expected=recipe.steps.includes('ts')?1:0;
      if(v?.status!=='completed'||v.significantImaginaryCount!==expected)throw Error(`振動解析が条件（有意な虚振動${expected}本）を満たさないため停止しました。モードを確認してください。`);
     }else requireConvergence(j);
     if(['cineb','lup'].includes(mode)){let highest=1;for(let i=2;i<j.result.images.length-1;i++)if(j.result.energies[i]>j.result.energies[highest])highest=i;images=[j.result.images[highest]];}else images=[j.result.images[0]];
    }
    if(last)M.EngineUI.showResult(last.result,last);message('計算手順が完了しました。各結果を確認して構造へ適用できます。');
   }
   record.status='completed';
  }catch(e){if(record){record.status=active?.cancelled?'cancelled':'stopped';record.error=e.message;}message(e.message);}
  finally{active=null;$('workflowRun').disabled=false;$('workflowCancel').disabled=true;$('workflowSaveResults').disabled=!record;M.OptimizationUI.sync();}
 }
 function renderResults(){const out=$('workflowResults');out.replaceChildren();results.forEach((j,i)=>out.append(button(`${i+1}: ${j.data.mode} · ${j.result.converged?'収束':j.result.reason}`,()=>{M.EngineUI.showResult(j.result,j);M.EngineUI.showSettings();})));
  if(record?.clusters){out.append(document.createElement('hr'));for(const i of record.clusters.representatives)out.append(button(`代表配座 ${i+1}`,()=>{const j=results[i];M.EngineUI.showResult(j.result,j);M.EngineUI.showSettings();}));}
 }
 async function cancel(){if(!active)return;active.cancelled=true;if(active.worker){active.worker.terminate();active.rejectGeneration?.(Error('配座生成を中止しました。'));}if(active.jobId)try{await M.EngineUI.request(active.connection,`/api/jobs/${active.jobId}/cancel`,{});}catch(e){message(e.message);}message('中止処理中です。');}
 function init(){const section=document.createElement('details');section.className='mv-help';section.id='workflowPanel';section.innerHTML='<summary>計算手順をまとめて実行</summary><label>手順<select id="workflowRecipe"></select></label><p id="workflowSteps" class="mv-small"></p><div id="workflowConformers" hidden class="mv-grid"><label>配座数<input id="workflowCount" type="number" value="5" min="1" max="20"></label><label>乱数シード<input id="workflowSeed" type="number" value="1" min="0"></label><label>重複判定RMSD (Å)<input id="workflowRmsd" type="number" value="0.1" step="0.01"></label></div><div class="mv-row"><input id="workflowName" maxlength="80" placeholder="保存する手順名" aria-label="保存する手順名"><button id="workflowSave" class="mv-btn">手順を保存</button><select id="workflowSaved" aria-label="保存済み手順"></select><button id="workflowLoad" class="mv-btn">復元</button></div><p class="mv-small">各段階は現在の電荷・多重度・エンジンと、下の収束条件で計算します。未収束・計算失敗・振動条件の不一致で停止します。自動実行中はページを開いておいてください。ページを閉じた場合も投入済みジョブは履歴に残り、後続ジョブは自動投入されません。</p><div class="mv-row"><button class="mv-btn primary" id="workflowRun">手順全体を開始</button><button class="mv-btn" id="workflowCancel" disabled>手順を中止</button><button class="mv-btn" id="workflowSaveResults" disabled>手順・結果JSONを保存</button></div><p id="workflowMessage" role="status"></p><div id="workflowResults" class="mv-row"></div>';
  $('engineDialog').querySelector('h2').after(section);for(const [id,r] of Object.entries(recipes)){const o=document.createElement('option');o.value=id;o.textContent=r.name;$('workflowRecipe').append(o);}$('workflowSteps').textContent=recipes.minimum.name;
  $('workflowRecipe').onchange=choose;$('workflowRun').onclick=run;$('workflowCancel').onclick=cancel;
  function refresh(){const select=$('workflowSaved');select.replaceChildren();for(const name of Object.keys(M.App.getState().metadata.workflowRecipes||{})){const o=document.createElement('option');o.value=name;o.textContent=name;select.append(o);}}
  $('workflowSaved').addEventListener('pointerdown',refresh);
  $('workflowSave').onclick=()=>{try{if(active)throw Error('計算手順の終了後に保存してください。');const name=$('workflowName').value.trim();if(!name)throw Error('手順名を入力してください。');const values={recipe:$('workflowRecipe').value,data:M.EngineUI.input().data,conditions:stageConditions(),count:$('workflowCount').value,seed:$('workflowSeed').value,rmsd:$('workflowRmsd').value};M.App.change('save workflow recipe',s=>{s.metadata.workflowRecipes={...s.metadata.workflowRecipes,[name]:values};});refresh();message('手順と条件をプロジェクトへ保存しました。');}catch(e){message(e.message);}};
  $('workflowLoad').onclick=()=>{try{if(active)throw Error('計算終了後に復元してください。');const saved=M.App.getState().metadata.workflowRecipes?.[$('workflowSaved').value];if(!saved)throw Error('保存した手順を選択してください。');$('workflowRecipe').value=saved.recipe;choose();M.EngineUI.restoreInput(saved.data);if(saved.conditions){$('engineTSMethod').value=saved.conditions.tsMethod;$('engineTrust').value=saved.conditions.trustRadius;for(const [key,id] of Object.entries({delta:'engineVibrationDelta',nfree:'engineVibrationNfree',imaginaryThreshold:'engineVibrationThreshold'}))$(id).value=saved.conditions.vibrations[key];$('ircStepSize').value=saved.conditions.irc.stepSize;}$('workflowCount').value=saved.count;$('workflowSeed').value=saved.seed;$('workflowRmsd').value=saved.rmsd;message('保存した条件を復元しました。入力構造と拘束を確認してください。');}catch(e){message(e.message);}};
  $('workflowSaveResults').onclick=()=>{if(!record)return;const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='molecule-workflow.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};refresh();
 }
 M.WorkflowUI={init,isBusy:()=>!!active,run,cancel};
})(window);
