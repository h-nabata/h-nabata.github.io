/* Normal-mode previews never mutate the input until explicit displacement/apply. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),app=()=>MV.App;
  let data=null,base=null,guard=null,index=0,timer=null,active=false;
  const fingerprint=s=>JSON.stringify([s.atoms,s.bonds,s.metadata]);
  function validate(v,symbols,positions){
    const n=symbols.length,m=3*n;
    if(v?.status!=='completed'||v.schema!=='molecule-vibrations/1'||JSON.stringify(v.symbols)!==JSON.stringify(symbols)||JSON.stringify(v.positions)!==JSON.stringify(positions)||v.units?.frequency!=='cm^-1'||v.units?.quantum!=='meV')throw Error('振動解析結果の構造・単位が一致しません。');
    for(const key of ['frequenciesCM','quantaMEV'])if(!Array.isArray(v[key])||v[key].length!==m||v[key].some(x=>!Number.isFinite(x)||x<0))throw Error('振動数が不正です。');
    if(!Array.isArray(v.imaginary)||v.imaginary.length!==m||v.imaginary.some(x=>typeof x!=='boolean')||!Array.isArray(v.modes)||v.modes.length!==m||v.modes.some(a=>!Array.isArray(a)||a.length!==n||a.some(p=>!Array.isArray(p)||p.length!==3||p.some(x=>!Number.isFinite(x)))))throw Error('振動モードが不正です。');
    return v;
  }
  function vectors(mode,amplitude){
    if(!Number.isFinite(amplitude)||amplitude<=0||amplitude>1)throw Error('振幅は0より大きく1 Å以下にしてください。');
    const norm=Math.max(...mode.map(p=>Math.hypot(...p)));
    return mode.map(p=>p.map(x=>norm?x*amplitude/norm:0));
  }
  function stop(){clearInterval(timer);timer=null;$('vibrationPlay').textContent='▶ モードをアニメーション';}
  function restore(draw=true){
    stop();if(!active)return;active=false;
    const r=app().renderer();r.vibrationVectors=null;r.previewOnly=false;$('vibrationMessage').textContent='プレビューを終了しました。';
    if(draw)r.renderState(app().getState(),true);
  }
  function draw(phase=0){
    const displacement=vectors(data.modes[index],Number($('vibrationAmplitude').value)),state=MV.Model.createState(base);
    state.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=data.positions[i].map((x,j)=>x+phase*displacement[i][j]);});
    MV.Bonding.refreshInferredBonds(state);state.viewSettings={...app().getState().viewSettings};state.selectedAtomIds.clear();state.selectedBondIds.clear();
    const r=app().renderer();r.vibrationVectors={vectors:displacement,color:data.imaginary[index]?'#c62828':'#176cb0'};r.previewOnly=true;active=true;r.renderState(state,true);
  }
  function select(i){
    if(!data||!Number.isInteger(i)||i<0||i>=data.modes.length)return;
    stop();MV.Studio.stop();MV.EnergyProfile.restore();index=i;
    for(const [j,row] of [...$('vibrationRows').children].entries())row.setAttribute('aria-selected',String(j===i));
    try{draw();$('vibrationMessage').textContent=`モード ${i+1}: ${data.frequenciesCM[i].toFixed(2)}${data.imaginary[i]?' i':''} cm⁻¹ · 入力構造は保持したプレビューです。符号（＋/−）は任意です。`;}
    catch(e){restore();$('vibrationMessage').textContent=e.message;}
  }
  function set(v,state,summary){
    restore();validate(v,state.atoms.map(a=>a.element),state.atoms.map(a=>[a.x,a.y,a.z]));
    data=v;base=MV.Periodic.snapshot(state);guard=fingerprint(app().getState());index=0;
    $('vibrationSummary').textContent=summary+` · ${v.modes.length}モード · ${v.settings.imaginaryThreshold} cm⁻¹超の虚振動 ${v.significantImaginaryCount}本。虚振動1本だけでは反応経路の接続は確定しません。`;
    const body=$('vibrationRows');body.replaceChildren();
    v.frequenciesCM.forEach((f,i)=>{
      const tr=document.createElement('tr');tr.tabIndex=0;tr.setAttribute('role','button');tr.setAttribute('aria-selected','false');
      if(v.imaginary[i])tr.className='mv-imaginary';
      for(const value of [i+1,f.toFixed(2)+(v.imaginary[i]?' i':''),v.quantaMEV[i].toFixed(3)+(v.imaginary[i]?' i':'')]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
      tr.addEventListener('click',()=>select(i));tr.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();select(i);}});body.append(tr);
    });$('vibrationToggle').disabled=false;
  }
  function show(){if(!data)return;$('vibrationPanel').hidden=false;$('vibrationToggle').setAttribute('aria-expanded','true');$('vibrationToggle').textContent='振動モードを隠す';select(index);$('viewer').scrollIntoView({block:'start',behavior:'smooth'});}
  function hide(){restore();$('vibrationPanel').hidden=true;$('vibrationToggle').setAttribute('aria-expanded','false');$('vibrationToggle').textContent='振動モードを表示';}
  function play(){
    if(timer){stop();draw();return;}select(index);if(!active)return;
    const start=Date.now();$('vibrationPlay').textContent='Ⅱ アニメーションを停止';
    timer=setInterval(()=>{try{draw(Math.sin((Date.now()-start)*Math.PI/1000));}catch(e){restore();$('vibrationMessage').textContent=e.message;}},50);
  }
  function displace(sign){
    try{
      if(!data)return;
      if(MV.EngineUI.isBusy()||MV.AFIRUI?.isBusy?.())throw Error('計算の完了または中止後に適用してください。');
      const current=app().getState(),same=JSON.stringify(current.atoms.map(a=>[a.id,a.element,a.x,a.y,a.z]))===JSON.stringify(base.atoms.map(a=>[a.id,a.element,a.x,a.y,a.z]));
      if(/未適用|編集中/.test($('xyzEditStatus').textContent)||(!same&&guard!==fingerprint(current)))throw Error('解析後に入力構造が変更されています。元の構造へ戻すか、再解析してください。');
      const displacement=vectors(data.modes[index],Number($('vibrationAmplitude').value)),next=MV.Model.createState(base);
      next.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=data.positions[i].map((x,j)=>x+sign*displacement[i][j]);});
      delete next.metadata.externalCalculation;delete next.metadata.afirCalculation;
      next.metadata.modeDisplacement={mode:index+1,frequencyCM:data.frequenciesCM[index],imaginary:data.imaginary[index],amplitude:Number($('vibrationAmplitude').value),sign};
      if(current.metadata.trajectory){next.metadata.trajectory=JSON.parse(JSON.stringify(current.metadata.trajectory));next.metadata.frameIndex=current.metadata.frameIndex||0;next.metadata.trajectory[next.metadata.frameIndex]=MV.Periodic.snapshot(next);}
      next.viewSettings={...current.viewSettings};MV.Bonding.refreshInferredBonds(next);restore(false);app().change('normal mode displacement',()=>next,true);$('dataReset').click();
      $('vibrationMessage').textContent='変位した構造を入力に適用しました。「現在の構造をTS最適化」で再探索できます。「戻す」で取り消せます。';
    }catch(e){$('vibrationMessage').textContent=e.message;}
  }
  function csv(){
    if(!data)return;const text='mode,frequency_cm-1,imaginary,quantum_meV\n'+data.frequenciesCM.map((f,i)=>`${i+1},${f},${data.imaginary[i]},${data.quantaMEV[i]}`).join('\n')+'\n';
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='vibrational-frequencies.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function init(){
    $('vibrationToggle').addEventListener('click',()=>$('vibrationPanel').hidden?show():hide());$('vibrationHide').addEventListener('click',hide);
    $('vibrationRestore').addEventListener('click',()=>restore());$('vibrationPlay').addEventListener('click',play);$('vibrationAmplitude').addEventListener('input',()=>{if(active)select(index);});
    $('vibrationPlus').addEventListener('click',()=>displace(1));$('vibrationMinus').addEventListener('click',()=>displace(-1));$('vibrationCSV').addEventListener('click',csv);
    const canvas=app().renderer().canvas;for(const type of ['keydown','dblclick'])canvas.addEventListener(type,e=>{if(active){e.preventDefault();e.stopImmediatePropagation();}},true);
  }
  MV.VibrationUI={init,set,show,hide,restore,validate,vectors};
})(window);
