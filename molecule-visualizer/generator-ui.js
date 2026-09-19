(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),app=()=>MV.App;
  let job=null;const fingerprint=s=>JSON.stringify([s.atoms,s.bonds,s.metadata]);
  function message(text){$('generationMessage').textContent=text;}
  function settings(){const path=$('generationKind').value==='path';$('pathControls').hidden=!path;$('randomControls').hidden=path;$('generationCount').min=path?2:1;}
  function finish(j){if(job!==j)return;j.worker?.terminate();clearTimeout(j.timeout);job=null;$('generationRun').disabled=false;$('generationCancel').disabled=true;}
  function cancel(){if(!job)return;finish(job);message('生成を中止しました。構造は変更していません。');}
  function current(){const s=app().getState();return s.metadata.cell?MV.IO.stateToXYZText(s):MV.IO.stateToMolV3000Text(s);}
  function open(kind){$('generationKind').value=kind;$('generationCount').value=kind==='path'?9:5;settings();if(kind==='path'&&!$('pathStart').value.trim())$('pathStart').value=current();message('');$('generationDialog').showModal();}
  const formKey=()=>JSON.stringify(['generationKind','generationCount','generationSeed','randomMode','pathMethod','pathStart','pathEnd'].map(id=>$(id).value).concat($('pathMinimumImage').checked));
  function run(){
    if(job)return;
    try{
      if(/未適用|編集中/.test($('xyzEditStatus').textContent))throw Error('座標編集欄の未適用データを先に適用するか、「現在の構造を再表示」を押してください。');
      const kind=$('generationKind').value,options={count:Number($('generationCount').value),seed:Number($('generationSeed').value),mode:$('randomMode').value,method:$('pathMethod').value,minimumImage:$('pathMinimumImage').checked};
      if(!Number.isInteger(options.count)||options.count<(kind==='path'?2:1)||options.count>20)throw Error('生成数はランダム1〜20、経路2〜20（端点を含む）にしてください。');
      if(!Number.isInteger(options.seed)||options.seed<0||options.seed>4294967295)throw Error('乱数シードは0〜4294967295の整数にしてください。');
      const state=kind==='path'?MV.Formats.parse($('pathStart').value):MV.Model.createState(MV.Periodic.snapshot(app().getState())),end=kind==='path'?MV.Formats.parse($('pathEnd').value):null;
      const j={fingerprint:fingerprint(app().getState()),formKey:formKey()};job=j;$('generationRun').disabled=true;$('generationCancel').disabled=false;message('構造列を生成しています…');
      try{
        j.worker=new Worker('./generation-worker.js?v=13');j.timeout=setTimeout(()=>{if(job===j){finish(j);message('生成が120秒を超えました。原子数・構造数を減らしてください。');}},120000);
        j.worker.onmessage=e=>{
          if(job!==j)return;
          if(e.data.error){finish(j);message(e.data.error);return;}
          if(e.data.progress!=null){message(`構造列を生成しています… ${Math.round(e.data.progress*100)}%`);return;}
          if(formKey()!==j.formKey||fingerprint(app().getState())!==j.fingerprint||/未適用|編集中/.test($('xyzEditStatus').textContent)){finish(j);message('生成中に構造・編集欄が変更されたため、結果は適用しませんでした。');return;}
          const r=e.data.result;finish(j);const next=MV.Model.createState(r.state);next.viewSettings={...app().getState().viewSettings};app().change('generated structures',()=>next,true);$('dataReset').click();$('generationDialog').close();app().setStatus(r.message+' 「戻す」で生成前へ戻れます。');$('viewer').scrollIntoView({block:'center'});
        };
        j.worker.onerror=()=>{if(job===j){finish(j);message('構造生成を実行できませんでした。');}};j.worker.postMessage({kind,state,end,options});
      }catch(error){finish(j);throw error;}
    }catch(error){message(error.message);}
  }
  function init(){
    $('btnRandomStructures').addEventListener('click',()=>open('random'));$('btnReactionPath').addEventListener('click',()=>open('path'));$('generationKind').addEventListener('change',settings);$('generationRun').addEventListener('click',run);$('generationCancel').addEventListener('click',cancel);$('generationDialog').addEventListener('close',cancel);
    for(const key of ['Start','End']){
      $('path'+key+'Current').addEventListener('click',()=>{$('path'+key).value=current();});
      $('path'+key+'File').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)throw Error('ファイルは10MB以下にしてください。');$('path'+key).value=await file.text();}catch(error){message(error.message);}finally{e.target.value='';}});
    }
  }
  MV.GeneratorUI={init,run,cancel};
})(window);
