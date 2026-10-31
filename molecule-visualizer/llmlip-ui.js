/* Local CPU model capabilities. No weights, model paths or Python execution in the browser. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  let info=null;
  function model(data,source=info){return source?.llmlip?.models.find(m=>m.id===data?.model);}
  function validate(data,source){
    if(!source?.llmlip){if(data.llmlip)throw Error('llmlip.rsのサービスへ接続してください。');return;}
    const s=data.llmlip,m=model(s,source);
    if(!m?.available)throw Error('利用可能なllmlipモデルを選択してください。');
    if(!m.dtypes.includes(s.dtype))throw Error('このモデルは指定の精度に対応していません。');
    if(m.heads.length?!m.heads.includes(s.head):s.head!==null)throw Error('このモデルのheadを選択してください。');
    if(!Number.isInteger(s.threads)||s.threads<(source.llmlip.workers||1)||s.threads>source.llmlip.maxThreads)throw Error('CPUスレッド数をサービスの設定範囲内で指定してください。');
    if(data.symbols.some(s=>!m.species.includes(s)))throw Error('llmlipモデルの対応外元素が含まれています。');
    const omol=m.architecture==='uma-v1'&&s.head==='omol',periodic=omol?'none':m.periodic;
    if((!m.charge&&!omol&&data.charge!==0)||(!m.spin&&!omol&&data.multiplicity!==1))throw Error('このモデル/headは電荷・スピンを指定できません。電荷0・多重度1だけを受け付けます（スピン状態の識別なし）。');
    const pbc=data.cell?.pbc||[];
    if(pbc.some(Boolean)&&(periodic==='none'||periodic==='full'&&!pbc.every(Boolean)))throw Error('このllmlipモデル/headは指定した周期境界条件に対応していません。');
    if(s.dtype!=='float64'&&(['ts','irc','vibrations'].includes(data.mode)||data.vibrations))throw Error('llmlip.rs β版のTS・IRC・振動解析にはfloat64を選択してください。');
    if(data.modelF||data.cellOptimization&&data.cellOptimization.mode!=='fixed')throw Error('llmlip.rs β版ではModelF・セル最適化は未対応です。');
  }
  function input(){
    if(!info?.llmlip)return {};
    return {llmlip:{model:$('engineLLMLIPModel').value,head:$('engineLLMLIPHead').value||null,
      dtype:$('engineLLMLIPDtype').value,threads:Number($('engineLLMLIPThreads').value)}};
  }
  function options(id,items,selected){
    const e=$(id);e.replaceChildren(...items.map(item=>{const o=document.createElement('option');o.value=item.id;o.textContent=item.label||item.id;o.disabled=!!item.disabled;return o;}));
    e.value=selected??items.find(x=>!x.disabled)?.id??'';
  }
  function sync(changedModel=false){
    const s=input().llmlip,m=model(s);
    if(changedModel&&m){
      options('engineLLMLIPHead',m.heads.map(id=>({id})),m.defaultHead);
      options('engineLLMLIPDtype',m.dtypes.map(id=>({id})),m.dtypes.includes('float64')?'float64':m.dtypes[0]);
    }
    if(m){
      const omol=m.architecture==='uma-v1'&&$('engineLLMLIPHead').value==='omol';
      $('engineLLMLIPHead').disabled=!m.heads.length;
      const pbc=omol?'none':m.periodic;
      $('engineLLMLIPHelp').textContent=(m.synthetic?'検証用の人工モデルです。科学計算には使用できません。 ':'')+
        `${m.architecture} · 対応元素: ${m.species.join(', ')} · ${pbc==='none'?'非周期系のみ':pbc==='full'?'非周期系・3方向周期系':'非周期系・部分/3方向周期系'}。`+
        ((m.charge||omol)&&(m.spin||omol)?' 電荷と多重度をモデルへ渡します。':' 電荷0・多重度1の入力のみ受理します。電荷・スピン状態を識別するモデルではありません。')+
        ' セル最適化・ModelF・AnySolvは未対応。学習範囲と反応の精度はモデルごとに確認してください。';
    }
    const l=info?.llmlip,f64=!l||$('engineLLMLIPDtype').value==='float64';
    if(l)for(const option of $('engineMode').options){
      if(['ts','irc','vibrations'].includes(option.value))option.disabled=!f64||option.value!=='vibrations'&&!info.sellaVersion;
    }
    $('engineVibrationCheck').disabled=!!l&&!f64;
    MV.AFIRUI?.sync();
  }
  function connected(source){
    info=source||null;const l=info?.llmlip;
    $('engineLLMLIPFields').hidden=!l;
    $('modelFEnabled').disabled=!!l;
    if(l){$('modelFEnabled').checked=false;MV.ModelFUI?.sync();}
    for(const option of $('engineMode').options)if(['ts','irc','vibrations'].includes(option.value))option.disabled=false;
    if(l){
      options('engineLLMLIPModel',l.models.map(m=>({id:m.id,label:m.id+(m.synthetic?'（検証用人工モデル）':'')+(m.available?'':'（利用不可）'),disabled:!m.available})),l.defaultModel);
      $('engineLLMLIPThreads').min=l.workers||1;$('engineLLMLIPThreads').max=l.maxThreads;$('engineLLMLIPThreads').value=l.threads;
    }
    sync(true);
  }
  function restore(data){
    if(!data.llmlip||!info?.llmlip)return;
    $('engineLLMLIPModel').value=data.llmlip.model;sync(true);
    $('engineLLMLIPHead').value=data.llmlip.head||'';$('engineLLMLIPDtype').value=data.llmlip.dtype;$('engineLLMLIPThreads').value=data.llmlip.threads;sync();
  }
  function validateResult(result,data){
    if(!data.llmlip)return;
    const p=result?.provenance?.llmlip;
    if(result.engine!=='llmlip'||!p||['model','head','dtype','threads'].some(k=>p[k]!==data.llmlip[k])||p.device!=='cpu'||p.backend!=='direct'||!/^[a-f0-9]{64}$/.test(p.modelSHA256||''))throw Error('結果のllmlipモデル・計算条件が入力と一致しません。');
  }
  function init(){
    $('engineLLMLIPModel').addEventListener('change',()=>sync(true));
    for(const id of ['engineLLMLIPHead','engineLLMLIPDtype','engineLLMLIPThreads'])$(id).addEventListener('input',()=>sync());
  }
  MV.LLMLIPUI={init,connected,input,validate,validateResult,restore,summary:()=>{const s=input().llmlip;return s?`llmlip.rs CPU・β · ${s.model} · ${s.head||'headなし'} · ${s.dtype} · ${s.threads}スレッド`:'';}};
})(window);
