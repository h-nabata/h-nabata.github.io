/* Download calculation results directly, without applying them to the editor. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  let source=null,arc=null,selected=null;
  function updateFormat(){
    const lup=$('trajectoryFormat').value==='lup',label=lup?'infile':'XYZ';
    $('trajectorySaveAll').textContent=`全構造を${label}保存`;
    $('trajectorySaveSelected').textContent=`抽出した構造列を${label}保存`;
    $('trajectoryFormatHelp').textContent=lup?'GRRM LUPのinfile用の座標列です。# NODE 0から連番を付け、構造間を--で区切ります。原子数行・エネルギー・周期セル・電荷・スピン・計算条件は含めません。GRRM本体の計算入力は別途用意してください。':'XYZのコメント行に元の構造番号と物理エネルギー（eV）を記載します。AFIRの人工項・合計は別々に記載します。周期セルは拡張XYZとして保存します。';
    $('trajectoryCellNotice').hidden=!(lup&&source?.cell?.pbc.some(Boolean));
    $('trajectoryMessage').textContent='';
  }
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
    $('trajectoryMethod').value='index';$('trajectoryFormat').value='xyz';updateFormat();update();$('trajectoryDialog').showModal();
  }
  function save(all){
    try{
      if(!source)return;if(!all)update();if(!all&&!selected)return;
      const ids=all?source.images.map((_,i)=>i):selected,method=all?'all':$('trajectoryMethod').value;
      const format=$('trajectoryFormat').value;if(!['xyz','lup'].includes(format))throw Error('保存形式が不正です。');
      const lup=format==='lup',text=lup?MV.Trajectory.lup(source,ids):MV.Trajectory.xyz(source,ids,method);
      const url=URL.createObjectURL(new Blob([text],{type:lup?'text/plain;charset=utf-8':'chemical/x-xyz;charset=utf-8'})),a=document.createElement('a');
      a.href=url;a.download=`molecule-${source.kind}-${method}-${ids.length}.${lup?'infile':'xyz'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      $('trajectoryMessage').textContent=`${ids.length}構造の${lup?'GRRM LUP infile':'XYZ'}を保存しました。入力座標は変更していません。`;
    }catch(error){$('trajectoryMessage').textContent=error.message;}
  }
  function init(){
    $('trajectoryCount').addEventListener('input',update);$('trajectoryMethod').addEventListener('change',update);
    $('trajectoryFormat').addEventListener('change',updateFormat);
    $('trajectorySaveAll').addEventListener('click',()=>save(true));$('trajectorySaveSelected').addEventListener('click',()=>save(false));
    $('trajectoryDialog').addEventListener('close',()=>{source=null;arc=null;selected=null;});
  }
  MV.TrajectoryUI={init,open};
})(window);
