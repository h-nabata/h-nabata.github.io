/* Navigation and presentation only. EngineUI owns the editable inputs, jobs and results. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  const keys=['setup','connection','results'];
  const suffix=key=>key[0].toUpperCase()+key.slice(1);
  const tab=key=>$('engineTab'+suffix(key)),panel=key=>$('enginePane'+suffix(key));
  let ready=false,current='setup',editingJob=false,trackedLabel='';
  function setText(id,value){
    const el=$(id);
    if(el.textContent!==value)el.textContent=value;
  }
  function sync(){
    if(!ready)return;
    const connection=MV.EngineUI.getConnection(),mode=$('engineMode').value;
    const setup=current==='setup',results=current==='results';
    $('enginePanelConnect').hidden=!setup||!!connection;
    $('enginePanelReturn').hidden=setup;
    $('engineRun').hidden=!setup||!connection;
    $('engineNumericOptions').hidden=['evaluate','vibrations'].includes(mode);
    const info=connection?.info,engine=info?'接続中 · '+[info.engine,info.method].filter(Boolean).join(' / '):'未接続';
    setText('enginePanelConnection',engine);
    $('enginePanelConnection').dataset.connected=String(!!info);
    const selection=$('engineMode').selectedOptions[0];
    let description=MV.EngineUI.modeLabel(mode)||selection?.textContent||'';
    if(!$('enginePathSymmetry').hidden&&$('engineMirror').checked)description+=' · 鏡映拘束';
    if(results){
      const result=MV.EngineUI.getResult()?.result;
      description=MV.EngineUI.isBusy()&&trackedLabel?trackedLabel:result?MV.EngineUI.modeLabel(result.mode)+(result.pathSymmetry?' · 鏡映拘束':''):$('batchResult').hidden?'':'一括最適化';
    }
    setText('enginePanelMethod',results?description:'設定中 · '+description);
    const empty=$('engineResult').hidden&&$('batchResult').hidden;
    $('engineResultsEmpty').hidden=!empty;
    setText('engineResultsEmpty',MV.EngineUI.isBusy()?'実行中です。計算が終了すると結果を表示します。':'計算結果はここに表示されます。保存した計算は「履歴・キュー」から開けます。');
    if(!setup||!$('engineDialog').open)return;
    const s=MV.App.getState(),count=s.metadata.trajectory?.length||1;
    let summary=s.atoms.length+' 原子';
    if(mode==='dsafir')summary+=' · '+count+' 構造から両端を選択';
    else if(mode==='batch')summary='一括入力の構造数は「入力を確認」で確認できます。';
    else if($('engineScope').value==='all')summary+=' · 全 '+count+' 構造';
    else summary+=' · 構造 '+((s.metadata.frameIndex||0)+1)+' / '+count;
    setText('engineInputSummary',summary);
  }
  function show(key,focus=false){
    if(!ready||!keys.includes(key))return;
    current=key;
    for(const k of keys){
      const active=k===key;
      panel(k).hidden=!active;tab(k).setAttribute('aria-selected',String(active));tab(k).tabIndex=active?0:-1;
    }
    if(key==='results')tab('results').removeAttribute('data-new-result');
    sync();
    if(focus)tab(key).focus({preventScroll:true});
  }
  function completed(){
    if(!ready)return;
    // A completed job must not close a draft the user is editing for the queue.
    if(editingJob&&$('engineDialog').open&&current==='setup'){
      tab('results').dataset.newResult='true';sync();return;
    }
    const focused=$('engineDialog').open&&panel(current).contains(document.activeElement);
    show('results',focused);
  }
  function init(){
    if(ready)return;
    ready=true;
    for(const [i,key] of keys.entries()){
      tab(key).addEventListener('click',()=>show(key));
      tab(key).addEventListener('keydown',e=>{
        const direction={ArrowRight:1,ArrowLeft:-1}[e.key];
        if(!direction&&e.key!=='Home'&&e.key!=='End')return;
        e.preventDefault();
        const next=e.key==='Home'?0:e.key==='End'?keys.length-1:(i+direction+keys.length)%keys.length;
        show(keys[next],true);
      });
    }
    $('enginePanelConnect').addEventListener('click',()=>show('connection',true));
    $('enginePanelReturn').addEventListener('click',()=>show('setup',true));
    $('enginePaneSetup').addEventListener('input',()=>{
      if(MV.EngineUI.isBusy())editingJob=true;
      sync();
    });
    show('setup');
  }
  MV.CalculationPanel={init,show,sync,completed,beginJob:(mode,pathSymmetry)=>{editingJob=false;trackedLabel=mode==='batch'?'一括最適化':MV.EngineUI.modeLabel(mode)+(pathSymmetry?' · 鏡映拘束':'');}};
})(window);
