/* Geometry inspection is a preview; only explicit apply changes the workspace. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),positions=f=>f.atoms.map(a=>[a.x,a.y,a.z]);
  let latest=null,source=null,analysis=null,alignment=null,preview=null,initialized=false,worker=null;
  function message(text){$('analysisMessage').textContent=text;}
  function keyFromMetadata(frame){const m=frame.metadata||{},c=m.externalCalculation;return c?.comparisonConditionKey||'unknown:'+JSON.stringify({charge:m.totalCharge??null,multiplicity:m.multiplicity??null});}
  function setSource(result,context={}){
    if(!result?.images?.length||!result.symbols?.length)return;
    const history=['optimize','ts','irc'].includes(result.mode)&&result.trajectory?.images?.length?result.trajectory:result;
    let base=context.frames?.[0]||context.original||MV.App.getState();
    if(JSON.stringify(base.atoms?.map(a=>a.element))!==JSON.stringify(result.symbols))base=MV.Model.createState({atoms:result.symbols.map((element,i)=>({id:result.atomIds?.[i]||`analysis-${i+1}`,element})),metadata:{}});
    const data={...(context.data||{})};delete data.images;delete data.atomIds;delete data.livePreview;
    const conditionKey=JSON.stringify({settings:data,provenance:result.provenance,engine:result.engine,method:result.method,charge:result.charge,multiplicity:result.multiplicity});
    latest={title:`${result.mode}の構造列`,frames:history.images.map((p,i)=>{const s=MV.Model.createState(MV.Periodic.snapshot(base));s.atoms.forEach((a,k)=>{[a.x,a.y,a.z]=p[k];});s.metadata.cell=history.cells?.[i]||result.cell||null;s.metadata.totalCharge=result.charge;s.metadata.multiplicity=result.multiplicity;s.metadata.externalCalculation={...(s.metadata.externalCalculation||{}),energyEV:history.energies?.[i],comparisonConditionKey:conditionKey};MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);}),energies:history.energies?.slice(),conditionKeys:history.images.map(()=>conditionKey)};
    if(initialized)$('analysisLatest').disabled=false;
  }
  function getSource(){
    const kind=$('analysisSource').value;
    if(kind==='latest'){if(!latest)throw Error('計算結果がまだありません。');return latest;}
    if(kind==='batch'){const s=MV.BatchUI?.analysisSource();if(!s)throw Error('一括最適化の結果がありません。');return s;}
    const state=MV.App.getState(),frames=MV.EngineUI.frames(state,'all');
    return {title:'入力の構造フレーム',frames,energies:frames.map(f=>f.metadata?.externalCalculation?.energyEV??f.metadata?.afirCalculation?.physicalEnergyEV??null),conditionKeys:frames.map(keyFromMetadata),energyComparable:frames.map(f=>!!f.metadata?.externalCalculation?.comparisonConditionKey)};
  }
  function options(a,b){return {selection:$('analysisAtoms').value,referenceSymbols:a.atoms.map(x=>x.element),mobileSymbols:b.atoms.map(x=>x.element),referenceIds:a.atoms.map(x=>x.id),mobileIds:b.atoms.map(x=>x.id)};}
  function refresh(){
    if(worker){message('重複判定が完了するまでお待ちください。');return;}
    restore();analysis=null;alignment=null;
    try{
      source=getSource();if(source.frames.length>500)throw Error('比較は最大500構造です。先に構造列を抽出してください。');
      if(source.frames.some(f=>f.metadata?.cell?.pbc?.some(Boolean)))throw Error('剛体重ね合わせは非周期分子用です。周期セルを持つ構造は比較できません。');
      for(const id of ['analysisReference','analysisMobile']){const el=$(id),old=Number(el.value)||0;el.replaceChildren(...source.frames.map((_,i)=>{const o=document.createElement('option');o.value=i;o.textContent=source.labels?.[i]||`構造 ${i+1}`;return o;}));el.value=Math.min(old,source.frames.length-1);}
      if(source.frames.length>1&&$('analysisReference').value===$('analysisMobile').value)$('analysisMobile').value=1;
      $('analysisSummary').textContent=`${source.title} · ${source.frames.length}構造 · ${source.frames[0].atoms.length}原子`;
      $('analysisRows').replaceChildren();message('共通の原子IDがある場合はID、ない場合はFile-orderで対応させます。同種原子の入れ替えは推測しません。');
      for(const id of ['analysisApplyRepresentatives','analysisSaveRepresentatives'])$(id).disabled=true;
    }catch(error){source=null;message(error.message);}
  }
  function compare(){
    if(!source)throw Error('比較する構造を読み込んでください。');
    const a=Number($('analysisReference').value),b=Number($('analysisMobile').value),ref=source.frames[a],mobile=source.frames[b];
    alignment=MV.StructureAnalysis.align(positions(ref),positions(mobile),options(ref,mobile));
    return {a,b,ref,mobile,...alignment};
  }
  function overlay(){
    try{
      const fit=compare();restore();MV.VibrationUI?.restore(false);MV.EnergyProfile?.restore(false);MV.DiagnosticsUI?.restore(false);MV.Studio.stop();
      const base=MV.Model.createState(fit.ref);base.viewSettings={...MV.App.getState().viewSettings};base.selectedAtomIds.clear();base.selectedBondIds.clear();
      const ghost=MV.Model.createState(fit.mobile);ghost.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=fit.positions[i];});
      const renderer=MV.App.renderer();renderer.previewOnly=true;renderer.analysisOverlay={base,atoms:ghost.atoms,bonds:ghost.bonds,color:'#a448a7'};preview=base;renderer.renderState(base,true);
      message(`基準 ${fit.a+1}に比較 ${fit.b+1}を重ね合わせました（紫の輪郭）。RMSD = ${fit.rmsd.toFixed(5)} Å、全原子RMSD = ${fit.allAtomRMSD.toFixed(5)} Å、最大偏差 = ${fit.maxDeviation.toFixed(5)} Å。${fit.correspondence==='stableIds'?'原子ID':'File-order'}対応。`);
    }catch(error){message(error.message);}
  }
  function restore(draw=true){
    if(!preview)return;const renderer=MV.App.renderer(),owns=renderer.state===preview;renderer.analysisOverlay=null;preview=null;
    if(owns){renderer.previewOnly=false;if(draw)renderer.renderState(MV.App.getState(),true);}
  }
  function guard(){if(MV.EngineUI.isBusy()||MV.AFIRUI?.isBusy())throw Error('計算終了後に構造を適用してください。');if(/未適用|編集中/.test($('xyzEditStatus').textContent))throw Error('座標編集欄の変更を先に適用してください。');}
  function applyAligned(){
    try{guard();const fit=compare(),state=MV.Model.createState(fit.mobile);state.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=fit.positions[i];});state.metadata.alignment={referenceFrame:fit.a,mobileFrame:fit.b,rmsd:fit.rmsd,selection:$('analysisAtoms').value};restore();MV.Studio.stop();state.viewSettings={...MV.App.getState().viewSettings};MV.App.change('aligned structure',()=>state,true);$('dataReset').click();message('重ね合わせた比較構造を入力に適用しました。「戻す」で復元できます。');}catch(error){message(error.message);}
  }
  function classify(images,options){
    if(typeof Worker==='undefined')return Promise.resolve(MV.StructureAnalysis.deduplicate(images,options));
    return new Promise((resolve,reject)=>{worker=new Worker('./structure-analysis-worker.js?v=research-38');worker.onmessage=e=>{worker.terminate();worker=null;e.data.error?reject(Error(e.data.error)):resolve(e.data.result);};worker.onerror=()=>{worker.terminate();worker=null;reject(Error('構造比較ワーカーを読み込めません。ページを再読み込みしてください。'));};worker.postMessage({images,options});});
  }
  async function cluster(){
    try{
      if(!source)throw Error('比較する構造を読み込んでください。');for(const id of ['analysisCluster','analysisSource','analysisRefresh','analysisAtoms','analysisThreshold'])$(id).disabled=true;message('重複を判定しています…');
      analysis=await classify(source.frames.map(positions),{threshold:Number($('analysisThreshold').value),selection:$('analysisAtoms').value,symbolsByFrame:source.frames.map(f=>f.atoms.map(a=>a.element)),atomIdsByFrame:source.frames.map(f=>f.atoms.map(a=>a.id)),energies:source.energies,conditionKeys:source.conditionKeys,energyComparable:source.energyComparable});
      const rows=$('analysisRows');rows.replaceChildren();
      for(const [i,c] of analysis.clusters.entries()){
        const tr=document.createElement('tr');for(const text of [i+1,c.representative+1,c.members.map(i=>i+1).join(', '),Math.max(...c.rmsds).toFixed(5),Number.isFinite(source.energies?.[c.representative])?source.energies[c.representative].toFixed(8):'—',c.energyComparable?'同一条件の最低エネルギー':'先頭構造（条件不明またはEなし）']){const td=document.createElement('td');td.textContent=text;tr.append(td);}rows.append(tr);
      }
      for(const id of ['analysisApplyRepresentatives','analysisSaveRepresentatives'])$(id).disabled=false;
      message(`${analysis.count}構造 → ${analysis.clusters.length}代表構造。各メンバーと代表のRMSDが閾値以内になるよう分類しています。極小点や反応の同一性を判定するものではありません。`);
    }catch(error){message(error.message);}finally{for(const id of ['analysisCluster','analysisSource','analysisRefresh','analysisAtoms','analysisThreshold'])$(id).disabled=false;}
  }
  function save(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function saveRepresentatives(){try{if(!analysis)throw Error('先に重複判定を実行してください。');save(analysis.representatives.map(i=>{const s=MV.Model.createState(source.frames[i]);s.metadata.title=`representative_frame=${i+1}${Number.isFinite(source.energies?.[i])?' energy_eV='+source.energies[i]:''}`;return MV.IO.stateToXYZText(s);}).join(''),'molecule-representatives.xyz','chemical/x-xyz;charset=utf-8');}catch(error){message(error.message);}}
  function applyRepresentatives(){
    try{guard();if(!analysis)throw Error('先に重複判定を実行してください。');const ids=analysis.representatives;if(ids.length>200||ids.length*source.frames[0].atoms.length>100000)throw Error('描画への反映は200フレーム・合計100000原子までです。XYZ保存を利用してください。');
      const frames=ids.map(i=>MV.Periodic.snapshot(source.frames[i])),firstIds=JSON.stringify(frames[0].atoms.map(a=>a.id));
      if(frames.some(f=>JSON.stringify(f.atoms.map(a=>a.id))!==firstIds))throw Error('フレームの原子ID・順序が一致しません。代表XYZを保存して読み込んでください。');
      restore();MV.Studio.stop();const next=MV.Model.createState(frames[0]);next.metadata.trajectory=frames;next.metadata.frameIndex=0;next.viewSettings={...MV.App.getState().viewSettings};MV.App.change('representative structures',()=>next,true);$('dataReset').click();MV.EnergyProfile.reset();message(`${frames.length}個の代表構造を元の座標のままフレームに取り込みました。「戻す」で復元できます。`);
    }catch(error){message(error.message);}
  }
  function init(){
    if(initialized)return;initialized=true;
    const toolbar=document.querySelector('.mv-result-actions'),button=document.createElement('button');button.id='analysisToggle';button.className='mv-btn';button.textContent='構造比較';button.setAttribute('aria-controls','analysisPanel');button.setAttribute('aria-expanded','false');toolbar.append(button);
    const panel=document.createElement('section');panel.id='analysisPanel';panel.className='mv-energy-profile mv-research-panel';panel.hidden=true;panel.setAttribute('aria-label','構造の重ね合わせ・重複判定');
    panel.innerHTML='<div class="mv-row"><strong>構造の重ね合わせ・重複判定</strong><button class="mv-btn" id="analysisHide">閉じる</button></div><div class="mv-row"><label>対象<select id="analysisSource"><option value="frames">入力の構造フレーム</option><option value="latest" id="analysisLatest" disabled>直近の計算結果</option><option value="batch">一括最適化の結果</option></select></label><button class="mv-btn" id="analysisRefresh">再読込</button><label>比較原子<select id="analysisAtoms"><option value="all">全原子</option><option value="heavy">重原子（Hを除く）</option></select></label></div><p class="mv-small" id="analysisSummary"></p><div class="mv-row"><label>基準<select id="analysisReference"></select></label><label>比較<select id="analysisMobile"></select></label><button class="mv-btn" id="analysisOverlay">重ね合わせて表示</button><button class="mv-btn" id="analysisRestore">プレビューを終了</button><button class="mv-btn" id="analysisApplyAligned">比較構造を整列して入力に適用</button></div><div class="mv-row"><label>RMSD閾値 (Å)<input class="mv-num" id="analysisThreshold" type="number" min="0" max="10" step="0.01" value="0.1"></label><button class="mv-btn" id="analysisCluster">重複を判定</button><button class="mv-btn" id="analysisSaveRepresentatives" disabled>代表構造をXYZ保存</button><button class="mv-btn" id="analysisApplyRepresentatives" disabled>代表構造をフレームに取り込む</button></div><div class="mv-research-scroll"><table><thead><tr><th>群</th><th>代表</th><th>元の構造番号</th><th>最大RMSD (Å)</th><th>E (eV)</th><th>代表の選択基準</th></tr></thead><tbody id="analysisRows"></tbody></table></div><p class="mv-small" id="analysisMessage" role="status"></p>';
    $('vibrationPanel').after(panel);
    function toggle(show){panel.hidden=!show;button.setAttribute('aria-expanded',String(show));if(show)refresh();else restore();}
    button.addEventListener('click',()=>toggle(panel.hidden));$('analysisHide').addEventListener('click',()=>toggle(false));$('analysisSource').addEventListener('change',refresh);$('analysisRefresh').addEventListener('click',refresh);
    $('analysisOverlay').addEventListener('click',overlay);$('analysisRestore').addEventListener('click',()=>restore());$('analysisApplyAligned').addEventListener('click',applyAligned);$('analysisCluster').addEventListener('click',cluster);$('analysisSaveRepresentatives').addEventListener('click',saveRepresentatives);$('analysisApplyRepresentatives').addEventListener('click',applyRepresentatives);
    for(const id of ['analysisAtoms','analysisThreshold'])$(id).addEventListener('change',()=>{analysis=null;$('analysisApplyRepresentatives').disabled=$('analysisSaveRepresentatives').disabled=true;});
  }
  MV.StructureAnalysisUI={init,setSource,restore,refresh};
})(window);
