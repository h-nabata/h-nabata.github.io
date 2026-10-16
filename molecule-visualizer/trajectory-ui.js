/* Download calculation results directly, without applying them to the editor. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  let source=null,arc=null,selected=null;
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
    if(clear)clearDisplay();selected=null;$('trajectorySaveSelected').disabled=true;$('trajectoryShowSelected').disabled=true;
    try{
      if(!source)return;
      const method=$('trajectoryMethod').value;
      if(method==='distance'&&!arc)arc=MV.Trajectory.distances(source.images);
      selected=MV.Trajectory.indices(source.images,Number($('trajectoryCount').value),method,arc);
      const shown=selected.length<=24?selected.map(i=>i+1).join(', '):selected.slice(0,10).map(i=>i+1).join(', ')+' … '+selected.slice(-3).map(i=>i+1).join(', ');
      $('trajectorySelection').textContent=`${selected.length}構造を抽出 · 元の構造番号: ${shown}`+(method==='distance'&&arc.at(-1)===0?' · 全構造の座標が同じため、番号の等間隔で選択します。':'');
      $('trajectorySaveSelected').disabled=false;$('trajectoryShowSelected').disabled=false;
    }catch(error){$('trajectorySelection').textContent=error.message;}
  }
  function open(next){
    MV.Trajectory.validate(next);source=next;arc=null;
    const n=source.images.length;$('trajectorySummary').textContent=`${source.title} · ${n}構造 · ${source.symbols.length}原子`;
    $('trajectoryNotice').textContent=source.notice||'';$('trajectoryNotice').hidden=!source.notice;
    $('trajectoryCount').min=n===1?1:2;$('trajectoryCount').max=n;$('trajectoryCount').value=Math.min(10,n);
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
  function init(){
    $('trajectoryCount').addEventListener('input',()=>update());$('trajectoryMethod').addEventListener('change',()=>update());
    $('trajectoryFormat').addEventListener('change',updateFormat);
    $('trajectoryName').addEventListener('input',updateName);
    $('trajectoryShowAll').addEventListener('click',()=>show(true));$('trajectoryShowSelected').addEventListener('click',()=>show(false));
    $('trajectorySelectText').addEventListener('click',()=>{$('trajectoryText').focus();$('trajectoryText').select();});
    $('trajectorySaveAll').addEventListener('click',()=>save(true));$('trajectorySaveSelected').addEventListener('click',()=>save(false));
    $('trajectoryDialog').addEventListener('close',()=>{source=null;arc=null;selected=null;clearDisplay();});
  }
  MV.TrajectoryUI={init,open};
})(window);
