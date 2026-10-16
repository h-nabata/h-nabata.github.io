/* Download calculation results directly, without applying them to the editor. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  let source=null,arc=null,selected=null;
  function update(){
    selected=null;$('trajectorySaveSelected').disabled=true;
    try{
      if(!source)return;
      const method=$('trajectoryMethod').value;
      if(method==='distance'&&!arc)arc=MV.Trajectory.distances(source.images);
      selected=MV.Trajectory.indices(source.images,Number($('trajectoryCount').value),method,arc);
      const shown=selected.length<=24?selected.map(i=>i+1).join(', '):selected.slice(0,10).map(i=>i+1).join(', ')+' … '+selected.slice(-3).map(i=>i+1).join(', ');
      $('trajectorySelection').textContent=`${selected.length}構造を抽出 · 元の構造番号: ${shown}`+(method==='distance'&&arc.at(-1)===0?' · 全構造の座標が同じため、番号の等間隔で選択します。':'');
      $('trajectorySaveSelected').disabled=false;
    }catch(error){$('trajectorySelection').textContent=error.message;}
  }
  function open(next){
    MV.Trajectory.validate(next);source=next;arc=null;
    const n=source.images.length;$('trajectorySummary').textContent=`${source.title} · ${n}構造 · ${source.symbols.length}原子`;
    $('trajectoryNotice').textContent=source.notice||'';$('trajectoryNotice').hidden=!source.notice;
    $('trajectoryCount').min=n===1?1:2;$('trajectoryCount').max=n;$('trajectoryCount').value=Math.min(10,n);
    $('trajectoryMethod').value='index';$('trajectoryMessage').textContent='';update();$('trajectoryDialog').showModal();
  }
  function save(all){
    try{
      if(!source)return;if(!all)update();if(!all&&!selected)return;
      const ids=all?source.images.map((_,i)=>i):selected,method=all?'all':$('trajectoryMethod').value;
      const text=MV.Trajectory.xyz(source,ids,method),url=URL.createObjectURL(new Blob([text],{type:'chemical/x-xyz;charset=utf-8'})),a=document.createElement('a');
      a.href=url;a.download=`molecule-${source.kind}-${method}-${ids.length}.xyz`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      $('trajectoryMessage').textContent=`${ids.length}構造のXYZを保存しました。入力座標は変更していません。`;
    }catch(error){$('trajectoryMessage').textContent=error.message;}
  }
  function init(){
    $('trajectoryCount').addEventListener('input',update);$('trajectoryMethod').addEventListener('change',update);
    $('trajectorySaveAll').addEventListener('click',()=>save(true));$('trajectorySaveSelected').addEventListener('click',()=>save(false));
    $('trajectoryDialog').addEventListener('close',()=>{source=null;arc=null;selected=null;});
  }
  MV.TrajectoryUI={init,open};
})(window);
