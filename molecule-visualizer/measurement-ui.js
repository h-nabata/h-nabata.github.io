(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,Q=MV.Measurements,$=id=>document.getElementById(id),app=()=>MV.App;
  let ready=false,lastOptions='';
  const run=fn=>()=>{try{fn();}catch(error){app().setStatus(error.message,true);$('measurementStatus').textContent=error.message;}};
  const format=r=>r.ok?r.value.toFixed(r.unit==='Å'?4:3)+' '+r.unit:'未定義';
  function sync(){
    if(!ready)return;const s=app().getState(),c=Q.config(s),d=Q.descriptor(s),n=s.selectedAtomIds.size,available=Object.entries(Q.TYPES).filter(([,v])=>v.count===n),key=available.map(([k])=>k).join();
    if(key!==lastOptions){$('measurementType').replaceChildren();for(const [value,t] of available){const option=document.createElement('option');option.value=value;option.textContent=t.name;$('measurementType').append(option);}if(!available.length){const option=document.createElement('option');option.textContent='2・3・4・6原子を選択';$('measurementType').append(option);}lastOptions=key;}
    $('measurementType').disabled=!available.length;if(d)$('measurementType').value=d.type;
    $('measurementMinimumImage').checked=Boolean(c.minimumImage);$('measurementMinimumImage').disabled=!s.metadata.cell&&!c.minimumImage;
    $('measurementConeOptions').hidden=d?.type!=='cone';$('measurementConeVdw').checked=c.coneVdw!==false;
    for(let i=0;i<3;i++){const el=$('measurementRadius'+i);el.disabled=c.coneVdw===false;if(document.activeElement!==el){const atom=d?.type==='cone'?s.atoms[d.indices[i+1]]:null;el.value=atom?(c.coneRadii?.[i]??Q.RADII[atom.element]??''):'';}}
    const r=d?Q.evaluate(s,d):null;$('measurementValue').textContent=r?format(r):'—';$('measurementValue').title=r?.note||'';
    $('pinMeasurement').disabled=!r?.ok||c.items.length>=Q.MAX_PINS;
    $('measurementOrder').textContent=d?'選択順 '+d.indices.map((i,j)=>`${String.fromCharCode(65+j)}=${i+1}:${s.atoms[i].element}`).join(' → '):'選択順にFile-orderを追跡します。';
    const help={distance:'A–Bの距離',angle:'A–B–Cの角度（頂点B）',dihedral:'A–B–C–Dの符号付き二面角（−180〜180°）',planeDistance:'ABCが作る無限平面からDまでの垂直距離（絶対値）',cone:'Aを頂点にB/C/DのvdW球を包む最小円錐の全頂角。4原子近似です。古典的Tolman値のM–P距離2.28 Åへの規格化や配位子全体の評価は行いません。',planeGap:'ABCとDEFが作る無限平面の距離。平行時は垂直距離、非平行時は交差するため0 Å。'};
    $('measurementDefinition').textContent=d?help[d.type]:'';$('measurementStatus').textContent=r&&!r.ok?r.note:r?.note||'';
    const badge=$('measureBadge');if(badge)badge.textContent=r?(r.ok?format(r):r.note):'2・3・4・6原子を順に選択してください';
    const body=$('pinnedMeasurements');body.replaceChildren();for(const item of c.items.slice(0,Q.MAX_PINS)){
      const value=Q.evaluate(s,item),row=document.createElement('tr');row.dataset.measurementId=item.id;
      const name=document.createElement('td'),button=document.createElement('button');button.className='mv-measure-select';button.textContent=`${item.id} ${Q.TYPES[item.type]?.name||'不正な計測'} [${(item.indices||[]).map(i=>i+1).join(',')}]`;button.title='この計測の原子を選択';button.addEventListener('click',run(()=>{const atoms=Q.resolve(app().getState(),item);s.selectedAtomIds=new Set(atoms.map(a=>a.id));s.selectedBondIds.clear();const c=Q.config(s,true);c.type=item.type;c.minimumImage=Boolean(item.options?.minimumImage);c.coneVdw=item.options?.coneVdw!==false;c.coneRadii=item.options?.radii?.slice()||null;app().setState(s,true);}));name.append(button);
      const number=document.createElement('td');number.className='mv-measure-number';number.textContent=format(value);number.title=value.note;
      const remove=document.createElement('td'),x=document.createElement('button');x.className='mv-measure-remove';x.textContent='解除';x.setAttribute('aria-label',item.id+'の固定表示を解除');x.addEventListener('click',run(()=>app().change('remove measurement',next=>{Q.config(next,true).items=Q.config(next).items.filter(m=>m.id!==item.id);})));remove.append(x);row.append(name,number,remove);body.append(row);
    }
    $('measurementCount').textContent=`固定 ${c.items.length}件`;$('clearMeasurements').disabled=!c.items.length;$('downloadMeasurements').disabled=!c.items.length;$('pinnedMeasurementTable').hidden=!c.items.length;
  }
  function setting(fn){const state=app().getState();fn(Q.config(state,true));app().setState(state,true);}
  function init(){
    ready=true;$('measurementType').addEventListener('change',run(()=>setting(c=>{c.type=$('measurementType').value;})));
    $('measurementMinimumImage').addEventListener('change',run(()=>setting(c=>{c.minimumImage=$('measurementMinimumImage').checked;})));
    $('measurementConeVdw').addEventListener('change',run(()=>setting(c=>{c.coneVdw=$('measurementConeVdw').checked;})));
    for(let i=0;i<3;i++)$('measurementRadius'+i).addEventListener('change',run(()=>{const radii=[0,1,2].map(j=>Number($('measurementRadius'+j).value));if(radii.some(r=>!Number.isFinite(r)||r<=0||r>10))throw Error('vdW半径は0より大きく10 Å以下にしてください。');setting(c=>{c.coneRadii=radii;});}));
    $('measurementResetRadii').addEventListener('click',run(()=>setting(c=>{c.coneRadii=null;})));
    $('pinMeasurement').addEventListener('click',run(()=>app().change('pin measurement',s=>{Q.pin(s);})));$('clearMeasurements').addEventListener('click',run(()=>app().change('clear measurements',s=>{Q.config(s,true).items=[];})));
    $('downloadMeasurements').addEventListener('click',run(()=>{const text=Q.csv(app().getState()),url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='measurements-all-frames.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);app().setStatus('固定した全計測値を、全フレーム分CSVへ保存しました。未定義の値は空欄と理由を記録しています。');}));sync();
  }
  MV.MeasurementUI={init,sync};
})(window);
