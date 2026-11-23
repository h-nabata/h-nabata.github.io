/* Shared MIN / AFIR-MIN fixed atom selection. Editing never starts a calculation. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,C=MV.Constraints,$=id=>document.getElementById(id);
  let ready=false,last='',draft=false;
  const busy=()=>MV.EngineUI?.isBusy()||MV.AFIRUI?.isBusy();
  const status=t=>{$('constraintStatus').textContent=t;};
  function safe(f){try{f();}catch(e){status(e.message);}}
  function edit(ids,enabled){
    if(busy())throw Error('計算終了後に原子固定を変更してください。');
    if(/未適用|編集中/.test($('xyzEditStatus').textContent))throw Error('編集中の座標を先に適用してください。');
    MV.App.useDisplayedStructure();
    const c={schema:'molecule-fixed-atoms/1',enabled,fixedAtomIds:ids};
    // Keep an all-fixed list editable, but never allow it to start a calculation.
    draft=false;MV.App.change('fixed atoms',s=>{
      s.metadata.constraints=c;
      if(s.metadata.trajectory){
        const indices=s.atoms.flatMap((a,i)=>ids.includes(a.id)?[i]:[]);
        s.metadata.trajectory=s.metadata.trajectory.map(frame=>{
          if(frame.atoms.length!==s.atoms.length||frame.atoms.some((a,i)=>a.element!==s.atoms[i].element))return frame;
          return {...frame,metadata:{...frame.metadata,constraints:{...c,fixedAtomIds:indices.map(i=>frame.atoms[i].id)}}};
        });
      }
    });
    status('固定対象を更新しました。計算開始時のX・Y・Z座標を保持します。');
  }
  function flush(){if(!ready||!draft)return;const s=MV.App.getDisplayedState();edit(C.parse($('constraintAtoms').value,s.atoms),$('constraintEnabled').checked);}
  function selected(){const s=MV.App.getState(),ids=s.atoms.filter(a=>s.selectedAtomIds.has(a.id)).map(a=>a.id);if(!ids.length)throw Error('描画エリアで固定する原子を選択してください。');return ids;}
  function add(ids){flush();const c=C.config(MV.App.getState());edit([...new Set([...c.fixedAtomIds,...ids])],true);}
  function applyBox(ids,addFixed){
    try{
      flush();
      if(!ids.length){MV.App.setStatus('矩形内に原子がありません。');return;}
      const c=C.config(MV.App.getState()),fixed=new Set(c.fixedAtomIds);
      for(const id of ids){if(addFixed)fixed.add(id);else fixed.delete(id);}
      const enabled=fixed.size>0&&(addFixed||c.enabled);
      if(fixed.size!==c.fixedAtomIds.length||enabled!==c.enabled)edit([...fixed],enabled);
      const message='矩形内 '+ids.length+'原子 · 現在の固定 '+(enabled?fixed.size:0)+'原子';
      status(message);MV.App.setStatus(message);
    }catch(error){status(error.message);MV.App.setStatus(error.message);}
  }
  function open(){
    if(!busy())MV.App.useDisplayedStructure();
    MV.PanelLayout?.showInspector('constraints');
    $('constraintPanel').open=true;$('constraintPanel').scrollIntoView({block:'nearest',behavior:'smooth'});
    $('constraintPanel').querySelector('summary')?.focus({preventScroll:true});
    if(!busy()){$('toolSelect').click();$('multiSelect').checked=true;}
    sync();
  }
  function sync(){
    if(!ready)return;const s=MV.App.getState();let c;
    try{c=C.config(s);}catch(e){status(e.message);c=C.defaults();}
    const signature=JSON.stringify([c,s.atoms.map(a=>[a.id,a.element])]);
    if(signature!==last){draft=false;$('constraintEnabled').checked=c.enabled;$('constraintAtoms').value=c.fixedAtomIds.map(id=>{const n=s.atoms.findIndex(a=>a.id===id);return n<0?'削除済み':n+1;}).join(', ');last=signature;}
    let summary=c.enabled?`固定 ${c.fixedAtomIds.length}原子（XYZ）`:'原子固定 オフ';
    try{C.indices(s);}catch(e){summary=e.message;}
    for(const id of ['constraintSummary','engineConstraintSummary','afirConstraintSummary'])$(id).textContent=summary;
    $('btnConstraints').textContent=c.enabled&&c.fixedAtomIds.length?`原子固定 · ${c.fixedAtomIds.length}`:'原子固定';
    $('btnConstraints').setAttribute('aria-pressed',String(c.enabled&&c.fixedAtomIds.length>0));
    $('constraintSelection').textContent=`選択中: ${s.selectedAtomIds.size}原子`;
    for(const el of $('constraintFields').querySelectorAll('input,button,select'))el.disabled=!!busy();
    $('toolFreeze').disabled=!!busy();
    $('constraintAddSelected').disabled=$('constraintRemoveSelected').disabled=!!busy()||!s.selectedAtomIds.size;
    const groups=s.metadata.afir?.fragments||[],select=$('constraintGroup'),key=JSON.stringify(groups);
    if(select.dataset.groups!==key){const prev=select.value;select.replaceChildren();for(const f of groups){const o=document.createElement('option');o.value=f.id;o.textContent=f.label;select.append(o);}if(groups.some(f=>f.id===prev))select.value=prev;select.dataset.groups=key;}
    $('constraintAddGroup').disabled=!!busy()||!groups.length;
  }
  function init(){
    ready=true;$('btnConstraints').addEventListener('click',()=>safe(open));
    for(const id of ['engineConstraints','afirConstraints'])$(id).addEventListener('click',()=>safe(()=>{$('engineDialog').close();open();}));
    $('constraintAtoms').addEventListener('input',()=>{draft=true;status('未適用の固定番号があります。適用または計算開始時に反映します。');});
    $('constraintApply').addEventListener('click',()=>safe(()=>{draft=true;flush();}));
    $('constraintEnabled').addEventListener('change',()=>safe(()=>{draft=true;flush();}));
    $('constraintAddSelected').addEventListener('click',()=>safe(()=>add(selected())));
    $('constraintRemoveSelected').addEventListener('click',()=>safe(()=>{const ids=selected();flush();const c=C.config(MV.App.getState());edit(c.fixedAtomIds.filter(id=>!ids.includes(id)),c.enabled);}));
    $('constraintAddGroup').addEventListener('click',()=>safe(()=>{const f=MV.App.getState().metadata.afir?.fragments.find(f=>f.id===$('constraintGroup').value);if(f)add(f.atomIds);}));
    $('constraintSelect').addEventListener('click',()=>safe(()=>{flush();const s=MV.App.useDisplayedStructure();s.selectedAtomIds=new Set(C.config(s).fixedAtomIds);s.selectedBondIds.clear();MV.App.setState(s,true);}));
    $('constraintClear').addEventListener('click',()=>safe(()=>edit([],false)));
    sync();
  }
  MV.ConstraintUI={init,sync,open,flush,applyBox,edit};
})(window);
