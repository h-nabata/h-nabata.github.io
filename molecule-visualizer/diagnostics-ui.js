/* Scalar diagnostics preserve unavailable values; force arrows carry physical units. */
(function(root,factory){const core=factory();if(typeof module==='object'&&module.exports){module.exports=core;return;}const MV=root.MoleculeVisualizer;MV.Diagnostics=core;if(!root.document)return;
  const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
  let rows=[],result=null,context={},preview=null,initialized=false,jobKey=null;
  const colors=['#087e85','#b45420','#6a46a3','#2766a1','#b83a62','#477334','#597384','#8a621c'];
  const names={physical:'物理力',effective:'有効力',uma:'UMA',solvation:'溶媒補正',artificial:'AFIR人工力',spring:'ばね',perpendicular:'接線に直交する物理力',tangentRemoval:'接線成分の除去',climbingCorrection:'CIの補正',constraintCorrection:'拘束の補正'};
  function element(tag,attributes,text){const e=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes))e.setAttribute(key,String(value));if(text!=null)e.textContent=text;return e;}
  function lineChart(id,series,unit,label,threshold){
    const svg=$(id);svg.replaceChildren();$(id+'Legend').replaceChildren();const valid=series.filter(s=>s.values.some(Number.isFinite));
    if(!valid.length){svg.append(element('text',{x:12,y:30,'font-size':12},'この指標はまだ取得されていません。'));return;}
    const count=Math.max(...valid.map(s=>s.values.length)),values=valid.flatMap(s=>s.values.filter(Number.isFinite));if(Number.isFinite(threshold))values.push(threshold);
    let lo=Infinity,hi=-Infinity;for(const v of values){lo=Math.min(lo,v);hi=Math.max(hi,v);}if(lo===hi){lo-=Math.max(1e-8,Math.abs(lo)*.05);hi+=Math.max(1e-8,Math.abs(hi)*.05);}const x=i=>54+480*i/Math.max(1,count-1),y=value=>153-105*(value-lo)/(hi-lo);
    svg.append(element('text',{x:8,y:16,'font-size':12},unit),element('text',{x:8,y:34,'font-size':11},`${lo.toPrecision(4)} 〜 ${hi.toPrecision(4)}`),element('text',{x:350,y:180,'font-size':11},label));
    svg.append(element('line',{x1:54,y1:153,x2:534,y2:153,stroke:'#bcc8ce'}));
    valid.forEach((s,k)=>{
      let segment=[];const flush=()=>{if(segment.length){svg.append(element('polyline',{points:segment.map(i=>`${x(i)},${y(s.values[i])}`).join(' '),fill:'none',stroke:s.color||colors[k%colors.length],'stroke-width':2}));if(segment.length===1)svg.append(element('circle',{cx:x(segment[0]),cy:y(s.values[segment[0]]),r:3,fill:s.color||colors[k%colors.length]}));segment=[];}};
      const indices=MV.EnergyProfile?.sample(s.values.map(v=>Number.isFinite(v)?v:0))||s.values.map((_,i)=>i);
      for(const i of indices){if(Number.isFinite(s.values[i]))segment.push(i);else flush();}flush();
    });
    if(Number.isFinite(threshold))svg.append(element('line',{x1:54,y1:y(threshold),x2:534,y2:y(threshold),stroke:'#a42a36','stroke-dasharray':'5 4'}));
    const legend=$(id+'Legend');legend.replaceChildren(...valid.map((s,k)=>{const span=document.createElement('span');span.textContent=s.name;span.style.color=s.color||colors[k%colors.length];return span;}));
  }
  function render(){
    if(!initialized||$('diagnosticsPanel').hidden)return;
    const latest=rows.at(-1),forceSeries=[['fmax','最大有効力'],['rmsForce','RMS有効力'],['physicalFmax','最大物理力']].map(([key,name])=>({name,values:rows.map(p=>p[key])}));
    const keys=new Set(rows.flatMap(p=>Object.keys(p.components||{})));for(const key of keys)if(!['physical','effective'].includes(key))forceSeries.push({name:(names[key]||key)+'の最大値',values:rows.map(p=>p.components?.[key])});
    lineChart('diagnosticsForces',forceSeries,'力 (eV/Å)','記録された計算ステップ →',context.data?.fmax);
    const energyRows=$('diagnosticsEnergyAxis').value==='structures'&&result?core.energyRows(result):rows;
    const energySeries=[['energy','物理'],['uma','UMA'],['solvation','溶媒補正'],['bias','AFIR人工項'],['total','物理＋人工項']].map(([key,name])=>{const baseline=energyRows.find(r=>Number.isFinite(r[key]))?.[key];return {name,values:energyRows.map(r=>Number.isFinite(r[key])?r[key]-baseline:null)};});
    lineChart('diagnosticsEnergy',energySeries,'各成分の始点との差 ΔE (eV)',$('diagnosticsEnergyAxis').value==='structures'?'結果の構造番号 →':'記録された計算ステップ →');
    const value=v=>Number.isFinite(v)?v.toPrecision(5):'—';
    $('diagnosticsSummary').textContent=latest?`記録 ${rows.length}件 · ステップ ${latest.step} · 最大有効力 ${value(latest.fmax)} eV/Å · RMS有効力 ${value(latest.rmsForce)} eV/Å · ΔE ${value(latest.energyChangeEV)} eV · 最大原子変位 ${value(latest.maxDisplacement)} Å`+(Number.isFinite(latest.redistributionResidual)?` · 再分布残差 ${value(latest.redistributionResidual)} Å`:'')+(Number.isFinite(latest.redistributionMove)?` · 再分布変位 ${value(latest.redistributionMove)} Å`:'')+(Number.isFinite(latest.cacheHits)?` · 評価の再利用 ${latest.cacheHits}件`:''):'計算の評価を待っています。';
    $('diagnosticsNote').textContent='取得できた成分だけを表示します。経路計算のステップ別エネルギーは、そのステップで物理エネルギーが最大のノードです。力の最大値同士は加算できません。赤い破線は最大有効力の収束閾値です。';
  }
  function reset(meta={}){restore();rows=[];result=null;context=meta;jobKey=meta.id||meta.jobId||null;if(initialized){$('diagnosticsVectors').hidden=true;$('diagnosticsEnergyAxis').value='steps';$('diagnosticsToggle').disabled=false;render();}}
  function update(progress,meta={}){
    const key=meta.id||meta.jobId||null;if(key&&jobKey&&key!==jobKey)reset(meta);if(key)jobKey=key;context=meta;
    const p=core.normalize(progress,meta.data?.mode);if(!p)return;
    const existing=rows.findIndex(r=>r.key===p.key);if(existing<0)rows.push(p);else rows[existing]={...rows[existing],...Object.fromEntries(Object.entries(p).filter(([,v])=>v!==null)),components:{...rows[existing].components,...p.components}};
    if(rows.length>20002)rows=rows.slice(-20002);if(initialized)$('diagnosticsToggle').disabled=false;render();
  }
  function load(r,c={}){
    restore();result=r;context=c;rows=core.fromResult(r);if(!initialized)return;
    $('diagnosticsToggle').disabled=false;$('diagnosticsEnergyAxis').value=r.images?.length>1?'structures':'steps';
    const available=Object.keys(r.forceComponents||{}).filter(k=>Array.isArray(r.forceComponents[k])&&r.forceComponents[k].length);
    $('diagnosticsVectors').hidden=!available.length;$('diagnosticsComponent').replaceChildren(...available.map(k=>{const option=document.createElement('option');option.value=k;option.textContent=names[k]||k;return option;}));
    const indices=r.forceComponentImageIndices||Array.from({length:r.images?.length||0},(_,i)=>i);$('diagnosticsImage').replaceChildren(...indices.map(i=>{const option=document.createElement('option');option.value=i;option.textContent=`構造 ${i+1}`;return option;}));render();
  }
  function restore(draw=true){
    const renderer=MV.App.renderer();if(!preview)return;const owns=renderer.state===preview;renderer.forceVectors=null;preview=null;if(owns){renderer.previewOnly=false;if(draw)renderer.renderState(MV.App.getState(),true);}
  }
  function vectors(){
    try{
      if(!result)return;const index=Number($('diagnosticsImage').value),key=$('diagnosticsComponent').value,slot=result.forceComponentImageIndices?result.forceComponentImageIndices.indexOf(index):index;
      const force=result.forceComponents?.[key]?.[slot],p=result.images?.[index];if(!p||!force||force.length!==p.length||force.some(v=>!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x))))throw Error('この構造の力ベクトルを取得できません。');
      restore(false);MV.StructureAnalysisUI?.restore(false);MV.VibrationUI?.restore(false);MV.EnergyProfile?.restore(false);MV.Studio.stop();
      let base=context.frames?.[Math.min(index,(context.frames?.length||1)-1)]||context.original||MV.App.getState();
      if(JSON.stringify(base.atoms?.map(a=>a.element))!==JSON.stringify(result.symbols))base=MV.Model.createState({atoms:result.symbols.map((element,i)=>({id:result.atomIds?.[i]||`force-${i+1}`,element}))});
      base=MV.Model.createState(MV.Periodic.snapshot(base));base.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=p[i];});base.viewSettings={...MV.App.getState().viewSettings};base.selectedAtomIds.clear();base.selectedBondIds.clear();MV.Bonding.refreshInferredBonds(base);
      const scale=Number($('diagnosticsVectorScale').value),renderer=MV.App.renderer();renderer.forceVectors={base,vectors:force,scale,color:'#b45420'};renderer.previewOnly=true;preview=base;renderer.renderState(base,true);
      $('diagnosticsVectorValue').textContent=`1 eV/Å → ${scale.toFixed(1)} Å`;$('diagnosticsVectorMessage').textContent=`構造 ${index+1} · ${names[key]||key} · 最大 ${Math.max(...force.map(v=>Math.hypot(...v))).toPrecision(5)} eV/Å。矢印は力の向き（−勾配）です。`;
    }catch(error){$('diagnosticsVectorMessage').textContent=error.message;}
  }
  function init(){
    if(initialized)return;initialized=true;
    const button=document.createElement('button');button.id='diagnosticsToggle';button.className='mv-btn';button.textContent='収束・成分';button.disabled=true;button.setAttribute('aria-controls','diagnosticsPanel');button.setAttribute('aria-expanded','false');document.querySelector('.mv-result-actions').append(button);
    const panel=document.createElement('section');panel.id='diagnosticsPanel';panel.className='mv-energy-profile mv-research-panel';panel.hidden=true;panel.setAttribute('aria-label','収束・エネルギー・力の診断');
    panel.innerHTML='<div class="mv-row"><strong>収束・エネルギー・力の成分</strong><button class="mv-btn" id="diagnosticsHide">閉じる</button></div><p class="mv-small" id="diagnosticsSummary"></p><svg id="diagnosticsForces" viewBox="0 0 560 190" role="img" aria-label="力の収束履歴"></svg><div class="mv-research-legend" id="diagnosticsForcesLegend"></div><div class="mv-row"><label>エネルギーの横軸<select id="diagnosticsEnergyAxis"><option value="steps">計算ステップ</option><option value="structures">結果の構造列</option></select></label></div><svg id="diagnosticsEnergy" viewBox="0 0 560 190" role="img" aria-label="エネルギー成分の変化"></svg><div class="mv-research-legend" id="diagnosticsEnergyLegend"></div><p class="mv-small" id="diagnosticsNote"></p><fieldset id="diagnosticsVectors" hidden><legend>力ベクトル</legend><div class="mv-row"><label>成分<select id="diagnosticsComponent"></select></label><label>構造<select id="diagnosticsImage"></select></label><button class="mv-btn" id="diagnosticsShowVectors">矢印を表示</button><button class="mv-btn" id="diagnosticsRestore">プレビューを終了</button></div><div class="mv-row"><label for="diagnosticsVectorScale">表示倍率</label><input id="diagnosticsVectorScale" type="range" min="0.1" max="10" step="0.1" value="1"><output id="diagnosticsVectorValue">1 eV/Å → 1.0 Å</output></div><p class="mv-small" id="diagnosticsVectorMessage" role="status"></p></fieldset>';
    $('vibrationPanel').after(panel);
    function toggle(show){panel.hidden=!show;button.setAttribute('aria-expanded',String(show));if(show)render();else restore();}
    button.addEventListener('click',()=>toggle(panel.hidden));$('diagnosticsHide').addEventListener('click',()=>toggle(false));$('diagnosticsEnergyAxis').addEventListener('change',render);$('diagnosticsShowVectors').addEventListener('click',vectors);$('diagnosticsRestore').addEventListener('click',()=>restore());
    $('diagnosticsVectorScale').addEventListener('input',()=>{if(preview)vectors();else $('diagnosticsVectorValue').textContent=`1 eV/Å → ${Number($('diagnosticsVectorScale').value).toFixed(1)} Å`;});
    for(const id of ['diagnosticsComponent','diagnosticsImage'])$(id).addEventListener('change',()=>{if(preview)vectors();});
  }
  MV.DiagnosticsUI={init,update,load,reset,restore};
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const finite=value=>Number.isFinite(value)?value:null;
  function normalize(p,mode){
    if(!p||!Number.isFinite(p.step)&&!Number.isFinite(p.fmax)&&!Number.isFinite(p.energyEV))return null;
    const d=p.diagnostics||{},energies=p.energies,band=['cineb','neb','perpendicular','lup'].includes(mode),index=band&&energies?.length?energies.indexOf(Math.max(...energies)):0;
    const energy=finite(p.energyEV)??finite(energies?.[index]),component=(p.energyComponents||{}),value=k=>finite(Array.isArray(component[k])?component[k][index]:component[k]);
    const bias=finite(p.biasEnergyEV),step=finite(p.step)??0;
    const rawComponents=p.componentFmax||d.componentFmax||{},components=Object.fromEntries(Object.entries(rawComponents).filter(([,v])=>Number.isFinite(v)));
    for(const [key,alias] of [['artificial','artificialMax'],['spring','springMax'],['perpendicular','perpendicularMax'],['climbingCorrection','climbingMax']])if(components[key]===undefined&&Number.isFinite(d[alias]))components[key]=d[alias];
    return {key:`${p.phase||''}:${p.direction||''}:${p.node??''}:${step}`,step,phase:p.phase||'',direction:p.direction||'',fmax:finite(p.fmax)??finite(d.effectiveFmax)??finite(d.effectiveMax),rmsForce:finite(p.rmsForce)??finite(d.rmsForce)??finite(d.effectiveRMS),physicalFmax:finite(p.physicalFmax)??finite(d.physicalFmax)??finite(d.physicalMax),energy,uma:value('uma'),solvation:value('solvation'),bias,total:energy!==null&&bias!==null?energy+bias:null,components,energyChangeEV:finite(p.energyChangeEV)??finite(d.energyChangeEV),maxDisplacement:finite(p.maxDisplacement)??finite(d.maxDisplacement),redistributionResidual:finite(p.redistributionResidual)??finite(d.redistributionResidual),redistributionMove:finite(p.redistributionMove)??finite(d.redistributionMove),cacheHits:finite(p.cacheHits)??finite(d.cacheHits)};
  }
  function energyRows(r){return (r.energies||[]).map((energy,i)=>({energy:finite(energy),uma:finite(r.energyComponents?.uma?.[i]),solvation:finite(r.energyComponents?.solvation?.[i]),bias:finite(r.biasEnergies?.[i]),total:finite(r.biasedEnergies?.[i])}));}
  function fromResult(r){
    if(r.history?.length)return r.history.map(p=>normalize(p,r.mode)).filter(Boolean);
    if(r.mode==='afir')return (r.energies||[]).map((energy,i)=>normalize({step:i,energyEV:energy,biasEnergyEV:r.biasEnergies?.[i],fmax:r.imageFmax?.[i],physicalFmax:r.physicalFmax?.[i],energyComponents:{uma:r.energyComponents?.uma?.[i],solvation:r.energyComponents?.solvation?.[i]}},r.mode));
    return [normalize({step:r.steps||0,fmax:r.effectiveFmax,energies:r.energies,diagnostics:r.diagnostics,energyComponents:r.energyComponents},r.mode)].filter(Boolean);
  }
  return {normalize,energyRows,fromResult};
});
