/* Camera controls, sample library and cancellable coordinate-only relaxation. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),app=()=>MV.App;
  const samples=[
    ['indene','インデン','c1ccc2c(c1)CC=C2',9,8],
    ['fluorene','フルオレン','c1ccc2c(c1)Cc1ccccc1-2',13,10],
    ['norbornene','ノルボルネン','C1=CC2CCC1C2',7,10],
    ['adamantane','アダマンタン','C1C2CC3CC1CC(C2)C3',10,16],
    ['cubane','キュバン','C12C3C4C1C5C2C3C45',8,8],
    ['anthracene','アントラセン','c1ccc2cc3ccccc3cc2c1',14,10],
    ['biphenyl','ビフェニル','c1ccccc1-c2ccccc2',12,10],
    ['caffeine','カフェイン','Cn1c(=O)c2c(ncn2C)n(C)c1=O',8,10],
    ['aspirin','アスピリン','CC(=O)Oc1ccccc1C(=O)O',9,8],
    ['crown','18-クラウン-6','C1COCCOCCOCCOCCOCCO1',12,24]
  ];
  let job=null;const cache=new Map();
  // Includes topology and chemical metadata, excludes camera and selection.
  const fingerprint=s=>JSON.stringify([s.atoms,s.bonds,s.metadata]);
  function busy(value){$('btnRelax').disabled=value;$('loadComplexSample').disabled=value;$('cancelAdvanced').disabled=!value;}
  function finish(j){if(job!==j)return;clearTimeout(j.timeout);j.worker?.terminate();job=null;busy(false);}
  function cancel(){if(!job)return;const j=job;finish(j);app().setStatus('処理を中止しました。構造は変更していません。');}
  function start(label){if(job)return null;const j={fingerprint:fingerprint(app().getState())};job=j;busy(true);app().setStatus(label);j.timeout=setTimeout(()=>{if(job===j){finish(j);app().setStatus('処理が時間制限を超えました。構造は変更していません。');}},120000);return j;}
  function unchanged(j){if(job!==j)return false;if(fingerprint(app().getState())!==j.fingerprint){finish(j);app().setStatus('処理中に構造が変更されたため、結果は適用しませんでした。');return false;}return true;}
  function relax(){
    const s=app().getState();if(!s.atoms.length||s.atoms.length>500){app().setStatus('構造緩和は1〜500原子に対応しています。');return;}
    const j=start('結合距離・角度・近接反発を調整しています…');if(!j)return;
    try{
      j.worker=new Worker('./relax-worker.js?v=12');
      j.worker.onmessage=e=>{
        if(job!==j)return;
        if(e.data.error){finish(j);app().setStatus(e.data.error);return;}
        if(!unchanged(j))return;
        const r=e.data.result;finish(j);
        if(!r.coordinates||r.coordinates.length!==s.atoms.length||r.coordinates.some(p=>p.length!==3||!p.every(Number.isFinite))){app().setStatus('緩和結果の座標が不正です。');return;}
        app().change('light relaxation',next=>{next.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=r.coordinates[i];});});
        app().setStatus(`構造を整えました（${r.steps}ステップ、幾何ひずみ ${r.initial.toFixed(2)} → ${r.final.toFixed(2)}、任意単位）。「戻す」で復元できます。`);
      };
      j.worker.onerror=()=>{if(job===j){finish(j);app().setStatus('構造緩和を実行できませんでした。');}};j.worker.postMessage(MV.Model.cloneState(s));
    }catch(e){finish(j);app().setStatus(e.message);}
  }
  function loadSample(){
    const sample=samples.find(s=>s[0]===$('complexSample').value);if(!sample)return;
    const [id,name,smiles]=sample,j=start(name+'：水素付き3D座標を生成しています…');if(!j)return;
    const apply=text=>{
      if(!unchanged(j))return;
      try{
        const next=MV.IO.parseMolToState(text);
        if(next.atoms.filter(a=>a.element==='C').length!==sample[3]||next.atoms.filter(a=>a.element==='H').length!==sample[4])throw Error('サンプルの組成を検証できませんでした。');
        next.metadata.title=name;next.metadata.sourceSmiles=smiles;cache.set(id,text);finish(j);
        app().change('complex sample',()=>next,true);app().setStatus(`${name}（${next.atoms.length}原子）を読み込みました。「戻す」で以前の構造に戻れます。`);
        $('viewer').scrollIntoView({block:'center'});
      }catch(e){finish(j);app().setStatus(e.message);}
    };
    if(cache.has(id)){apply(cache.get(id));return;}
    try{j.worker=new Worker('./chem-worker.js?v=8');j.worker.onmessage=e=>{if(job!==j)return;if(e.data.error){finish(j);app().setStatus(e.data.error);}else apply(e.data.result);};j.worker.onerror=()=>{if(job===j){finish(j);app().setStatus('サンプルを生成できませんでした。');}};j.worker.postMessage({data:smiles,input:'smi',output:'mol',generate:true});}catch(e){finish(j);app().setStatus(e.message);}
  }
  function sync(){const view=app().getState().viewSettings;$('projectionMode').value=view.projection||'orthographic';$('cameraFov').value=view.fov||45;$('cameraFov').disabled=view.projection!=='perspective';$('cameraFovValue').textContent=($('cameraFov').value)+'°';}
  function init(){
    for(const [id,name] of samples){const option=document.createElement('option');option.value=id;option.textContent=name;$('complexSample').appendChild(option);}
    $('loadComplexSample').addEventListener('click',loadSample);$('btnRelax').addEventListener('click',relax);$('cancelAdvanced').addEventListener('click',cancel);
    function camera(){const state=app().getState();state.viewSettings.projection=$('projectionMode').value;state.viewSettings.fov=Number($('cameraFov').value);app().setState(state,true);sync();}
    $('projectionMode').addEventListener('change',camera);$('cameraFov').addEventListener('input',camera);
    const render=app().renderer().renderState;app().renderer().renderState=function(...args){const r=render.apply(this,args);sync();return r;};sync();
  }
  MV.Advanced={init,samples,relax,cancel};
})(window);
