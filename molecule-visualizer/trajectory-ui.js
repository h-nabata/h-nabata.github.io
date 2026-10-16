/* Extract/export results, or explicitly apply the selected frames to the workspace. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  let source=null,arc=null,selected=null;
  function options(){return {preservePeaks:$('trajectoryPeaks').checked,window:Number($('trajectorySmooth').value),minProminence:Number($('trajectoryProminence').value)};}
  function plot(features){
    const svg=$('trajectoryEnergyPlot');svg.replaceChildren();if(!features)return;
    const raw=source.energies,values=features.values,all=[...raw,...values];let lo=Infinity,hi=-Infinity;for(const e of all){lo=Math.min(lo,e);hi=Math.max(hi,e);}
    const x=i=>20+520*i/Math.max(1,raw.length-1),y=e=>135-110*(e-lo)/Math.max(hi-lo,1e-10);
    const add=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));svg.append(e);};
    for(const [series,color] of [[raw,'#087e85'],[values,'#9250a1']])add('polyline',{points:MV.EnergyProfile.sample(series).map(i=>`${x(i)},${y(series[i])}`).join(' '),fill:'none',stroke:color,'stroke-width':2});
    for(const k of MV.EnergyProfile.sample(selected.map(i=>raw[i]))){const i=selected[k];add('circle',{cx:x(i),cy:y(raw[i]),r:3,fill:'#263746'});}
    add('circle',{cx:x(features.highest),cy:y(raw[features.highest]),r:5,fill:'#b45420'});
  }
  function clearDisplay(){
    $('trajectoryDisplay').hidden=true;$('trajectoryText').value='';$('trajectoryDisplaySummary').textContent='';
  }
  function updateName(){$('trajectoryFilename').textContent=MV.Trajectory.lupFilename($('trajectoryName').value);}
  function updateFormat(){
    const lup=$('trajectoryFormat').value==='lup',label=lup?'infile':'XYZ';
    $('trajectorySaveAll').textContent=`全構造を${label}保存`;
    $('trajectorySaveSelected').textContent=`抽出した構造列を${label}保存`;
    $('trajectoryFormatHelp').textContent=lup?'GRRM LUPのinfile用の座標列です。# NODE 0から連番を付け、構造間を--で区切ります。原子数行・エネルギー・周期セル・電荷・スピン・計算条件は含めません。GRRM本体の計算入力は別途用意してください。':'XYZのコメント行に元の構造番号と物理エネルギー（eV）を記載します。AFIRの人工項・合計は別々に記載します。周期セルは拡張XYZとして保存します。';
    $('trajectoryCellNotice').hidden=!(lup&&source?.cell?.pbc.some(Boolean));
    $('trajectoryNameField').hidden=!lup;updateName();clearDisplay();$('trajectoryMessage').textContent='';
  }
  function update(clear=true){
    if(clear)clearDisplay();selected=null;for(const id of ['trajectorySaveSelected','trajectoryShowSelected','trajectoryApply','trajectoryNEB'])$(id).disabled=true;
    $('trajectoryEnergyPlot').replaceChildren();$('trajectoryTransferHelp').textContent='';
    try{
      if(!source)return;
      const method=$('trajectoryMethod').value;
      if(method==='distance'&&!arc)arc=MV.Trajectory.distances(source.images);
      const extraction=MV.Trajectory.extract(source,Number($('trajectoryCount').value),method,options(),arc);selected=extraction.indices;
      const shown=selected.length<=24?selected.map(i=>i+1).join(', '):selected.slice(0,10).map(i=>i+1).join(', ')+' … '+selected.slice(-3).map(i=>i+1).join(', ');
      $('trajectorySelection').textContent=`${selected.length}構造を抽出 · 元の構造番号: ${shown}`+(method==='distance'&&arc.at(-1)===0?' · 全構造の座標が同じため、番号の等間隔で選択します。':'');
      if(source.kind==='afir'){
        $('trajectorySelection').textContent+=` · 物理エネルギー最高点: ${extraction.highest+1}番（${source.energies[extraction.highest].toFixed(6)} eV）を保持 · 極大点: ${extraction.retainedPeaks}/${extraction.peaks.length}点を含む`;
        plot(extraction);
      }
      $('trajectorySaveSelected').disabled=false;$('trajectoryShowSelected').disabled=false;
      const canApply=typeof source.base==='function'&&selected.length<=200&&selected.length*source.symbols.length<=100000;
      $('trajectoryApply').disabled=!canApply;$('trajectoryNEB').disabled=!canApply||selected.length<3||selected.length>100||source.symbols.length>500;
      $('trajectoryTransferHelp').textContent='描画への反映は200フレーム・合計100000原子まで、NEB入力は3〜100ノード・500原子までです。「NEB入力に取り込む」は計算条件を開き、実行ボタンを押すまで計算を開始しません。';
    }catch(error){$('trajectorySelection').textContent=error.message;}
  }
  function open(next){
    MV.Trajectory.validate(next);source=next;arc=null;
    $('trajectoryAFIROptions').hidden=source.kind!=='afir';$('trajectoryPeaks').checked=true;$('trajectorySmooth').value=5;$('trajectoryProminence').value=.01;
    const n=source.images.length;$('trajectorySummary').textContent=`${source.title} · ${n}構造 · ${source.symbols.length}原子`;
    $('trajectoryNotice').textContent=source.notice||'';$('trajectoryNotice').hidden=!source.notice;
    $('trajectoryCount').min=source.kind==='afir'?MV.Trajectory.energyFeatures(source).minimum:n===1?1:2;$('trajectoryCount').max=n;$('trajectoryCount').value=Math.min(10,n);
    $('trajectoryName').value=Array.from(String(source.name||'molecule')).slice(0,60).join('');
    $('trajectoryMethod').value='index';$('trajectoryFormat').value='xyz';updateFormat();update();$('trajectoryDialog').showModal();
  }
  function output(all){
    if(!source)throw Error('保存する構造列がありません。');if(!all)update(false);if(!all&&!selected)throw Error('抽出するノード数を確認してください。');
    const ids=all?source.images.map((_,i)=>i):selected,method=all?'all':$('trajectoryMethod').value;
    const format=$('trajectoryFormat').value;if(!['xyz','lup'].includes(format))throw Error('保存形式が不正です。');
    const lup=format==='lup',text=lup?MV.Trajectory.lup(source,ids):MV.Trajectory.xyz(source,ids,method);
    return {text,count:ids.length,lup,name:lup?MV.Trajectory.lupFilename($('trajectoryName').value):`molecule-${source.kind}-${method}-${ids.length}.xyz`};
  }
  function show(all){
    try{
      const out=output(all);$('trajectoryText').value=out.text;$('trajectoryDisplaySummary').textContent=`${all?'全構造':'抽出した構造列'} · ${out.count}構造 · ${out.lup?'GRRM LUP infile':'XYZ'}`;
      $('trajectoryDisplay').hidden=false;$('trajectoryMessage').textContent='';$('trajectoryText').focus();
    }catch(error){clearDisplay();$('trajectoryMessage').textContent=error.message;}
  }
  function save(all){
    try{
      const out=output(all),url=URL.createObjectURL(new Blob([out.text],{type:out.lup?'text/plain;charset=utf-8':'chemical/x-xyz;charset=utf-8'})),a=document.createElement('a');
      a.href=url;a.download=out.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      $('trajectoryMessage').textContent=`${out.count}構造を${out.name}に保存しました。入力座標は変更していません。`;
    }catch(error){$('trajectoryMessage').textContent=error.message;}
  }
  function apply(toNEB=false){
    try{
      update(false);if(!source||!selected)throw Error('抽出条件を確認してください。');
      if(/未適用|編集中/.test($('xyzEditStatus').textContent))throw Error('座標編集欄の未適用データを先に適用するか、現在の構造を再表示してください。');
      if(MV.EngineUI?.isBusy()||MV.AFIRUI?.isBusy())throw Error('実行中の計算を終了してから構造列を取り込んでください。');
      if(typeof source.base!=='function')throw Error('原子情報がないため描画へ反映できません。XYZ保存を利用してください。');
      if(selected.length>200||selected.length*source.symbols.length>100000)throw Error('描画への反映は200フレーム・合計100000原子までです。ノード数を減らしてください。');
      if(toNEB&&(selected.length<3||selected.length>100||source.symbols.length>500))throw Error('NEB入力は3〜100ノード・500原子までです。');
      const original=source,ids=selected.slice(),method=$('trajectoryMethod').value,settings=options();
      const frames=ids.map(i=>{
        const s=MV.Model.createState(original.base(i));
        if(JSON.stringify(s.atoms.map(a=>a.element))!==JSON.stringify(original.symbols)||original.atomIds&&JSON.stringify(s.atoms.map(a=>a.id))!==JSON.stringify(original.atomIds))throw Error('抽出元の原子対応が一致しません。');
        s.atoms.forEach((a,k)=>{[a.x,a.y,a.z]=original.images[i][k];});
        s.metadata.cell=original.cell||null;s.metadata.totalCharge=original.charge;s.metadata.multiplicity=original.multiplicity;
        delete s.metadata.externalCalculation;delete s.metadata.afirCalculation;
        s.metadata.trajectoryExtraction={sourceKind:original.kind,sourceFrame:i,sourceCount:original.images.length,method,...(original.kind==='afir'?settings:{})};
        if(original.kind==='afir')s.metadata.afirCalculation={engine:original.engine,method:original.method,physicalEnergyEV:original.energies[i],biasEnergyEV:original.biasEnergies?.[i],step:original.stepNumbers?.[i]??i,validation:'biased-trajectory-not-ts',atomIds:s.atoms.map(a=>a.id)};
        else if(original.energies)s.metadata.externalCalculation={engine:original.engine,method:original.method,energyEV:original.energies[i],mode:original.kind,charge:original.charge,multiplicity:original.multiplicity};
        return MV.Periodic.snapshot(s);
      });
      const atomIds=JSON.stringify(frames[0].atoms.map(a=>a.id));if(frames.some(f=>JSON.stringify(f.atoms.map(a=>a.id))!==atomIds))throw Error('構造列の原子IDが一致しません。');
      MV.Studio.stop();const next=MV.Model.createState(frames[0]);MV.Bonding.refreshInferredBonds(next);next.metadata.trajectory=frames;next.metadata.frameIndex=0;next.viewSettings={...MV.App.getState().viewSettings};
      MV.App.change('extracted trajectory',()=>next,true);$('dataReset').click();$('trajectoryDialog').close();
      if(original.energies){MV.EnergyProfile.set({title:`${original.title} · 抽出した${ids.length}構造`,kind:'path',energies:ids.map(i=>original.energies[i]),biasEnergies:original.biasEnergies?ids.map(i=>original.biasEnergies[i]):null,positions:i=>original.images[ids[i]],base:i=>frames[i],exportXYZ:()=>open(original),details:()=>open(original)});MV.EnergyProfile.bindTrajectory(frames);}
      else MV.EnergyProfile.reset();
      if(toNEB)MV.EngineUI.prepareNEB();else{MV.EnergyProfile.reveal();MV.Studio.play();}
      MV.App.setStatus(`${ids.length}構造を${toNEB?'NEB入力に取り込みました。電荷・多重度と計算条件を確認して実行してください。':'描画へ反映しました。FRAMESで再生・移動できます。'}「戻す」で反映前に戻れます。`);
    }catch(error){$('trajectoryMessage').textContent=error.message;}
  }
  function init(){
    $('trajectoryCount').addEventListener('input',()=>update());$('trajectoryMethod').addEventListener('change',()=>update());
    $('trajectoryFormat').addEventListener('change',updateFormat);
    $('trajectoryName').addEventListener('input',updateName);
    $('trajectoryShowAll').addEventListener('click',()=>show(true));$('trajectoryShowSelected').addEventListener('click',()=>show(false));
    $('trajectorySelectText').addEventListener('click',()=>{$('trajectoryText').focus();$('trajectoryText').select();});
    $('trajectorySaveAll').addEventListener('click',()=>save(true));$('trajectorySaveSelected').addEventListener('click',()=>save(false));
    $('trajectoryPeaks').addEventListener('change',()=>update());
    for(const id of ['trajectorySmooth','trajectoryProminence'])$(id).addEventListener('input',()=>update());
    $('trajectoryApply').addEventListener('click',()=>apply());$('trajectoryNEB').addEventListener('click',()=>apply(true));
    $('trajectoryDialog').addEventListener('close',()=>{source=null;arc=null;selected=null;clearDisplay();});
  }
  MV.TrajectoryUI={init,open};
})(window);
