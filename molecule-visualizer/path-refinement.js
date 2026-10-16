/* Cartesian insertion keeps every existing node, atom ID and endpoint. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  const fingerprint=s=>JSON.stringify([s.atoms,s.bonds,s.metadata]);
  function refine(frames,from,to,each){
    if(!Array.isArray(frames)||frames.length<3||frames.length>100)throw Error('3〜100ノードの経路が必要です。');
    if(!Number.isInteger(from)||!Number.isInteger(to)||!Number.isInteger(each)||from<0||to>=frames.length||from>=to||each<1||frames.length+(to-from)*each>100)throw Error('区間と追加数を確認してください（始点 < 終点、合計100ノードまで）。');
    const symbols=frames[0].atoms.map(a=>a.element),cell=JSON.stringify(frames[0].metadata.cell||null);
    for(const frame of frames){
      if(JSON.stringify(frame.atoms.map(a=>a.element))!==JSON.stringify(symbols)||JSON.stringify(frame.metadata.cell||null)!==cell)throw Error('全ノードの原子順序・セルを一致させてください。');
      if(frame.atoms.some(a=>![a.x,a.y,a.z].every(Number.isFinite)))throw Error('不正な座標です。');
    }
    const out=[];
    frames.forEach((frame,i)=>{
      out.push(MV.Periodic.snapshot(MV.Model.createState(frame)));
      if(i<from||i>=to)return;
      const next=frames[i+1];
      for(let k=1;k<=each;k++){
        const t=k/(each+1),s=MV.Model.createState(frame);
        s.atoms.forEach((a,j)=>{for(const axis of ['x','y','z'])a[axis]+=(next.atoms[j][axis]-a[axis])*t;});
        delete s.metadata.externalCalculation;delete s.metadata.afirCalculation;
        s.metadata.pathInsertion={between:[i+1,i+2],fraction:t};
        for(let a=0;a<s.atoms.length;a++)for(let b=a+1;b<s.atoms.length;b++){
          let delta=['x','y','z'].map(axis=>s.atoms[a][axis]-s.atoms[b][axis]);
          const distance=s.metadata.cell?.pbc.some(Boolean)?MV.Periodic.minimumImage(delta,s.metadata.cell).distance:Math.hypot(...delta);
          if(distance<.1)throw Error('補間した構造に0.1 Å未満の原子衝突があります。区間または元の経路を調整してください。');
        }
        MV.Bonding.refreshInferredBonds(s);out.push(MV.Periodic.snapshot(s));
      }
    });return out;
  }
  let source=null,guard=null,nebMode='neb';
  function count(){
    const from=Number($('refineFrom').value),to=Number($('refineTo').value),each=Number($('refineEach').value),n=source?.length||0;
    const valid=[from,to,each].every(Number.isInteger)&&from>=1&&to<=n&&from<to&&each>=1&&n+(to-from)*each<=100;
    $('refineMessage').textContent=valid?`${n} → ${n+(to-from)*each}ノード（${(to-from)*each}ノード追加）`:'区間と追加数を確認してください。合計100ノードまでです。';
    $('refineApply').disabled=$('refineNEB').disabled=!valid;
  }
  function open(frames=null,mode='neb'){
    if(MV.EngineUI.isBusy()||MV.AFIRUI?.isBusy?.())throw Error('実行中の計算を一時停止または終了してください。');
    if(/未適用|編集中/.test($('xyzEditStatus').textContent))throw Error('座標欄の未適用の編集を先に解決してください。');
    source=frames||MV.EngineUI.frames(MV.App.getState(),'all');
    if(source.length<3)throw Error('先に3ノード以上の経路を読み込むか、NEB結果を取得してください。');
    guard=fingerprint(MV.App.getState());nebMode=mode==='cineb'?'cineb':'neb';
    $('refineSummary').textContent=`対象：${source.length}ノード · ${source[0].atoms.length}原子`;
    $('refineFrom').value=1;$('refineTo').value=source.length;$('refineEach').value=1;
    $('refineFrom').max=source.length-1;$('refineTo').max=source.length;count();$('refineDialog').showModal();
  }
  function apply(toNEB){
    try{
      if(MV.EngineUI.isBusy()||MV.AFIRUI?.isBusy?.())throw Error('計算中は経路を置き換えられません。');
      if(guard!==fingerprint(MV.App.getState())||/未適用|編集中/.test($('xyzEditStatus').textContent))throw Error('入力構造が変更されています。ノード追加を開き直してください。');
      const out=refine(source,Number($('refineFrom').value)-1,Number($('refineTo').value)-1,Number($('refineEach').value));
      const next=MV.Model.createState(out[0]);next.metadata.trajectory=out;next.metadata.frameIndex=0;next.viewSettings={...MV.App.getState().viewSettings};
      MV.Studio.stop();MV.EnergyProfile.reset();MV.App.change('insert path nodes',()=>next,true);$('dataReset').click();$('refineDialog').close();
      if(toNEB)MV.EngineUI.prepareNEB(nebMode);
      MV.App.setStatus(`${out.length}ノードへ補間しました。既存ノードと端点は保持しています。「戻す」で元の経路に戻せます。`);
    }catch(e){$('refineMessage').textContent=e.message;}
  }
  function init(){
    $('btnRefinePath').addEventListener('click',()=>{try{open();}catch(e){MV.App.setStatus(e.message,true);}});
    for(const id of ['refineFrom','refineTo','refineEach'])$(id).addEventListener('input',count);
    $('refineApply').addEventListener('click',()=>apply(false));$('refineNEB').addEventListener('click',()=>apply(true));
  }
  MV.PathRefinement={refine,open,init};
})(window);
