/* Batch inputs and final results stay in this tab; no connection secrets saved. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  const statusText={waiting:'待機',running:'計算中',converged:'収束',step_limit:'未収束・上限',failed:'失敗',cancelled:'中止',not_run:'未実行',unknown:'状態不明'};
  let batch=null,loading=false;
  const message=t=>{$('engineMessage').textContent=t;};
  function prepare(){
    if(loading)throw Error('ファイルの読み込み完了を待ってください。');
    const frames=$('batchSource').value==='frames'?MV.Batch.normalize(MV.EngineUI.frames(MV.App.getState(),'all')):MV.Batch.parse($('batchText').value,Number($('batchAtomCount').value));
    $('batchInputSummary').textContent=`${frames.length}構造 · 各${frames[0].atoms.length}原子`;
    return frames;
  }
  function begin(plan){
    batch={plan,entries:plan.frames.map(frame=>({frame,status:'waiting'}))};$('batchResult').hidden=false;render();return batch.entries;
  }
  function resultFrame(entry,index){
    const r=entry.result,s=MV.Model.createState(MV.Periodic.snapshot(entry.frame));
    s.atoms.forEach((a,k)=>{[a.x,a.y,a.z]=r.images[0][k];});
    delete s.metadata.afirCalculation;delete s.metadata.trajectoryExtraction;
    s.metadata.totalCharge=batch.plan.data.charge;s.metadata.multiplicity=batch.plan.data.multiplicity;
    s.metadata.externalCalculation={engine:r.engine,method:r.method,mode:'optimize',energyEV:r.energies[0],converged:r.converged,reason:r.reason,steps:r.steps,effectiveFmax:r.effectiveFmax,charge:batch.plan.data.charge,multiplicity:batch.plan.data.multiplicity,batchInput:index+1};
    MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);
  }
  function available(){return batch?.entries.map((e,i)=>({entry:e,index:i})).filter(({entry:e})=>MV.Batch.completed(e))||[];}
  function openResults(){MV.EngineUI.open();$('batchResult').scrollIntoView({block:'start'});}
  function profile(selected){
    const rows=available();if(!rows.length)return;
    MV.EnergyProfile.set({title:'一括最適化 · 最終エネルギー比較',kind:'batch',referenceEnergy:MV.Batch.minimum(batch.entries),labels:rows.map(x=>`入力 ${x.index+1}`),energies:rows.map(x=>x.entry.result.energies[0]),positions:i=>rows[i].entry.result.images[0],base:i=>resultFrame(rows[i].entry,rows[i].index),details:openResults,exportXYZ:()=>downloadXYZ()});
    if(selected!==undefined){$('engineDialog').close();MV.EnergyProfile.reveal();MV.EnergyProfile.select(Math.max(0,rows.findIndex(x=>x.index===selected)));}
  }
  function view(entry,index){
    if(MV.Batch.completed(entry)){profile(index);return;}
    MV.EnergyProfile.set({title:`一括最適化 · 入力 ${index+1} · ${statusText[entry.status]}`,kind:'batch',energies:entry.result.energies,positions:()=>entry.result.images[0],base:()=>resultFrame(entry,index),details:openResults});
    $('engineDialog').close();MV.EnergyProfile.reveal();MV.EnergyProfile.select(0);
  }
  function render(){
    if(!batch)return;
    const es=batch.entries,min=MV.Batch.minimum(es),body=$('batchRows'),dialog=$('engineDialog'),scroller=body.closest('.mv-table-scroll'),top=dialog.scrollTop,tableTop=scroller.scrollTop;
    body.replaceChildren();
    const rows=es.map((entry,index)=>({entry,index}));
    if($('batchSort').value==='energy')rows.sort((a,b)=>(MV.Batch.completed(a.entry)?a.entry.result.energies[0]:Infinity)-(MV.Batch.completed(b.entry)?b.entry.result.energies[0]:Infinity)||a.index-b.index);
    for(const {entry:e,index} of rows){
      const tr=document.createElement('tr'),r=e.result,delta=MV.Batch.completed(e)?r.energies[0]-min:null;
      for(const value of [index+1,e.frame.metadata.title,statusText[e.status],r?.energies[0].toFixed(8)??'—',delta==null?'—':(delta*96.4853321233).toFixed(3),r?.steps??'—',r?.effectiveFmax.toPrecision(4)??'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}
      const td=document.createElement('td');
      if(r){const button=document.createElement('button');button.className='mv-btn';button.textContent='構造を見る';button.disabled=MV.EngineUI.isBusy();button.addEventListener('click',()=>view(e,index));td.append(button);}
      if(e.error){const span=document.createElement('span');span.className='mv-small';span.textContent=e.error;td.append(span);}
      tr.append(td);body.append(tr);
    }
    const count=available().length;
    const engine=es.find(e=>e.result)?.result,conditions=batch.plan.data;
    $('batchSummary').textContent=(engine?`${engine.engine} / ${engine.method} · `:'')+`電荷 ${conditions.charge} · 多重度 ${conditions.multiplicity} · ${conditions.optimizer||'FIRE'} · ${es.length}構造 · 収束 ${es.filter(e=>e.status==='converged').length} · 未収束 ${es.filter(e=>e.status==='step_limit').length} · 失敗 ${es.filter(e=>['failed','unknown'].includes(e.status)).length} · 待機/未実行 ${es.filter(e=>['waiting','not_run'].includes(e.status)).length}`;
    for(const id of ['batchCompare','batchXYZ','batchApply'])$(id).disabled=!count||MV.EngineUI.isBusy();
    $('batchJSON').disabled=$('batchCSV').disabled=MV.EngineUI.isBusy();
    dialog.scrollTop=top;scroller.scrollTop=tableTop;
  }
  function finish(){if(!batch)return;batch.entries.filter(e=>e.status==='waiting').forEach(e=>{e.status='not_run';});render();if(available().length)profile();if($('engineDialog').open)$('batchResult').scrollIntoView({block:'start'});}
  function save(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function downloadXYZ(){
    const text=available().map(({entry:e,index})=>{
      const s=MV.Model.createState(resultFrame(e,index)),r=e.result;
      s.metadata.title=`input=${index+1} ${s.metadata.title.replace(/[\r\n]/g,' ')} energy_eV=${r.energies[0]} status=${e.status} charge=${batch.plan.data.charge} multiplicity=${batch.plan.data.multiplicity}`;
      return MV.IO.stateToXYZText(s);
    }).join('');save(text,'molecule-batch-optimized.xyz','chemical/x-xyz;charset=utf-8');
  }
  function apply(){
    try{
      if(MV.EngineUI.isBusy()||MV.AFIRUI.isBusy())throw Error('計算終了後に取り込んでください。');
      if(/未適用|編集中/.test($('xyzEditStatus').textContent)||JSON.stringify([MV.App.getState().atoms,MV.App.getState().bonds,MV.App.getState().metadata])!==batch.plan.fingerprint)throw Error('計算開始後に入力が変更されています。結果XYZを保存して読み込んでください。');
      const frames=available().map(({entry,index})=>resultFrame(entry,index)),s=MV.Model.createState(frames[0]);if(!frames.length)return;
      s.metadata.trajectory=frames;s.metadata.frameIndex=0;s.viewSettings={...MV.App.getState().viewSettings};
      MV.Studio.stop();MV.App.change('batch optimization results',()=>s,true);$('dataReset').click();profile();MV.EnergyProfile.bindTrajectory(frames);$('engineDialog').close();MV.EnergyProfile.reveal();MV.App.setStatus(`${frames.length}個の最適化結果をフレームとして取り込みました。「戻す」で復元できます。`);
    }catch(e){message(e.message);}
  }
  function init(){
    $('btnBatchOptimize').addEventListener('click',()=>MV.EngineUI.prepareBatch());
    $('batchSource').addEventListener('change',()=>{$('batchTextInput').hidden=$('batchSource').value!=='text';$('batchInputSummary').textContent='';});
    $('batchCheck').addEventListener('click',()=>{try{prepare();message('入力を確認しました。共通の電荷・多重度と最適化条件を確認して実行してください。');}catch(e){$('batchInputSummary').textContent='';message(e.message);}});
    for(const id of ['batchText','batchAtomCount'])$(id).addEventListener('input',()=>{$('batchInputSummary').textContent='';});
    $('batchFile').addEventListener('change',async e=>{
      const files=[...e.target.files];if(!files.length)return;loading=true;
      try{if(files.reduce((n,f)=>n+f.size,0)>10000000)throw Error('入力ファイルは合計10 MB以内にしてください。');const texts=await Promise.all(files.map(f=>f.text()));$('batchText').value=texts.join('\n--\n');$('batchInputSummary').textContent='ファイルを読み込みました。「入力を確認」で構造数を確認できます。';}catch(error){message(error.message);}finally{loading=false;e.target.value='';}
    });
    $('batchSort').addEventListener('change',render);$('batchCompare').addEventListener('click',()=>profile(available()[0]?.index));$('batchXYZ').addEventListener('click',downloadXYZ);$('batchApply').addEventListener('click',apply);
    $('batchCSV').addEventListener('click',()=>save('\uFEFF'+MV.Batch.csv(batch.entries),'molecule-batch-energies.csv','text/csv;charset=utf-8'));
    $('batchJSON').addEventListener('click',()=>save(JSON.stringify({schema:'molecule-batch-optimization/1',settings:batch.plan.data,entries:batch.entries},null,2),'molecule-batch-results.json','application/json'));
  }
  MV.BatchUI={init,prepare,begin,render,finish};
})(window);
