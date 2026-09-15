/* Workspace features: periodic cells, trajectory editing and the 2D/3D bridge. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer, P=MV.Periodic, IO=MV.IO, M=MV.Model;
  const $=id=>document.getElementById(id), app=()=>MV.App, state=()=>app().getState();
  let ready=false, timer=null, axis=null, worker=null, jobId=0, pending=null, ketcherPromise=null;
  function message(text,error=false){app().setStatus(text,error);if($('chemMessage'))$('chemMessage').textContent=text;}
  function bind(id,fn){$(id).addEventListener('click',async()=>{try{await fn();}catch(e){message(e.message,true);}});}
  function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function readNumbers(id,n){const values=$(id).value.trim().split(/[\s,]+/).map(Number);if(values.length!==n||values.some(x=>!Number.isFinite(x)))throw Error(`${n}個の数値を入力してください。`);return values;}
  function sync(){
    if(!ready)return;
    const s=state(),c=s.metadata.cell,frames=s.metadata.trajectory||[];
    $('cellStatus').textContent=c?`周期境界 ${c.pbc.map((x,i)=>x?'abc'[i]:'—').join('')} · ${Math.abs(determinant(c.vectors)).toFixed(3)} Å³`:'非周期構造';
    $('frameRange').max=Math.max(0,frames.length-1);$('frameRange').value=s.metadata.frameIndex||0;$('frameLabel').textContent=`${(s.metadata.frameIndex||0)+1} / ${frames.length||1}`;
    ['framePrev','frameNext','framePlay','frameRange','allFrames'].forEach(id=>$(id).disabled=frames.length<2);
    const chosen=[...s.selectedAtomIds].map(id=>s.atoms.find(a=>a.id===id));
    $('pbcMeasure').textContent=c&&chosen.length===2?`最小像距離 ${P.minimumImage(P.xyz(chosen[1]).map((x,i)=>x-P.xyz(chosen[0])[i]),c).distance.toFixed(5)} Å`:'周期系：2原子を選択すると最小像距離を表示';
    $('fractionalInfo').textContent=c&&chosen.length===1?'分率座標 '+P.fractional(P.xyz(chosen[0]),c).map(x=>x.toFixed(6)).join('  '):'';
  }
  function determinant(v){return v[0][0]*(v[1][1]*v[2][2]-v[1][2]*v[2][1])-v[0][1]*(v[1][0]*v[2][2]-v[1][2]*v[2][0])+v[0][2]*(v[1][0]*v[2][1]-v[1][1]*v[2][0]);}
  function stop(){clearInterval(timer);timer=null;$('framePlay').textContent='▶ 再生';}
  function frame(index){
    const s=state(),frames=s.metadata.trajectory;if(!frames||index<0||index>=frames.length)return;
    // A frame change is navigation. Its current edits are saved in the document.
    frames[s.metadata.frameIndex||0]=P.snapshot(s);
    const next=M.createState(frames[index]);next.metadata.trajectory=frames;next.metadata.frameIndex=index;next.viewSettings={...s.viewSettings};app().setState(next,true);
  }
  function allXYZ(){const s=state(),frames=s.metadata.trajectory;if(!frames)return IO.stateToXYZText(s);return frames.map((f,i)=>IO.stateToXYZText(i===(s.metadata.frameIndex||0)?s:M.createState(f))).join('');}
  function transform(fn){if(!state().selectedAtomIds.size)throw Error('原子を選択してください。');app().change('transform',s=>{const atoms=s.atoms.filter(a=>s.selectedAtomIds.has(a.id));fn(atoms);MV.Bonding.refreshInferredBonds(s);});}
  function rotateSelection(){const [degrees]=readNumbers('rotationAngle',1),axis=$('rotationAxis').value,angle=degrees*Math.PI/180;transform(atoms=>{const center=[0,1,2].map(i=>atoms.reduce((sum,a)=>sum+P.xyz(a)[i],0)/atoms.length),j=axis==='x'?1:axis==='y'?2:0,k=(j+1)%3;atoms.forEach(a=>{const v=P.xyz(a).map((x,i)=>x-center[i]),b=v[j];v[j]=b*Math.cos(angle)-v[k]*Math.sin(angle);v[k]=b*Math.sin(angle)+v[k]*Math.cos(angle);[a.x,a.y,a.z]=v.map((x,i)=>x+center[i]);});});}
  function cancelChem(){if(worker)worker.terminate();worker=null;if(pending){clearTimeout(pending.timeout);pending.reject(Error('3D生成を中止しました。'));pending=null;} $('chemCancel').disabled=true;}
  function convert(data,input,output,generate=false){
    if(pending)return Promise.reject(Error('変換中です。完了するか中止してください。'));
    return new Promise((resolve,reject)=>{
      const id=++jobId;worker=new Worker('./chem-worker.js?v=3');
      const finish=(err,result)=>{if(!pending||pending.id!==id)return;clearTimeout(pending.timeout);pending=null;worker.terminate();worker=null;$('chemCancel').disabled=true;err?reject(Error(err)):resolve(result);};
      pending={id,reject,timeout:setTimeout(()=>finish('変換が120秒を超えました。小さい分子でお試しください。'),120000)};
      worker.onmessage=e=>finish(e.data.error,e.data.result);worker.onerror=e=>finish(e.message||'化学エンジンを起動できません。');$('chemCancel').disabled=false;worker.postMessage({data,input,output,generate});
    });
  }
  async function ketcher(){
    if(!ketcherPromise)ketcherPromise=new Promise((resolve,reject)=>{const iframe=$('ketcherFrame');iframe.src='./vendor/ketcher/index.html';const start=Date.now(),poll=setInterval(()=>{const editor=iframe.contentWindow?.ketcher;if(editor){clearInterval(poll);resolve(editor);}else if(Date.now()-start>90000){clearInterval(poll);ketcherPromise=null;reject(Error('Ketcherを読み込めませんでした。再度開くかページを再読み込みしてください。'));}},200);});
    return ketcherPromise;
  }
  async function openChem(){ $('chemDialog').showModal();message('Ketcherを準備しています…');await ketcher();message('描画、SMILESの入力、ファイルの読み込みができます。'); }
  async function make3D(){
    const editor=await ketcher(),mol=await editor.getMolfile('v2000');
    message('3D座標を生成しています（UFF・水素追加）。中止できます。');
    const result=await convert(mol,'mol','mol',true);
    // Keep strict import: unsupported stereochemical records are never silently discarded.
    const next=IO.parseMolToState(result);next.metadata.title='Ketcher → 3D';next.metadata.sourceFormat='ketcher';
    app().change('Ketcher 3D',()=>next,true);$('chemDialog').close();message('UFFで初期3D構造を生成しました。計算投入前に配座・電荷・立体化学を確認してください。');
  }
  function init(){
    ready=true;
    bind('btnCell',()=>{const c=state().metadata.cell||P.cell([[10,0,0],[0,10,0],[0,0,10]]);$('cellVectors').value=c.vectors.map(r=>r.join(' ')).join('\n');['pbcA','pbcB','pbcC'].forEach((id,i)=>$(id).checked=c.pbc[i]);$('cellDialog').showModal();});
    bind('cellApply',()=>{const n=readNumbers('cellVectors',9),c=P.cell([n.slice(0,3),n.slice(3,6),n.slice(6)],['pbcA','pbcB','pbcC'].map(id=>$(id).checked));app().change('cell',s=>{if($('keepFractional').checked&&s.metadata.cell)s.atoms.forEach(a=>{[a.x,a.y,a.z]=P.cartesian(P.fractional(P.xyz(a),s.metadata.cell),c);});s.metadata.cell=c;MV.Bonding.refreshInferredBonds(s);},true);$('cellDialog').close();});
    bind('cellRemove',()=>{app().change('remove cell',s=>{s.metadata.cell=null;MV.Bonding.refreshInferredBonds(s);},true);$('cellDialog').close();});
    bind('cellWrap',()=>app().change('wrap',s=>{P.wrap(s);MV.Bonding.refreshInferredBonds(s);}));
    bind('cellSuper',()=>{app().change('supercell',s=>P.supercell(s,readNumbers('repeatCell',3)),true);$('cellDialog').close();});
    bind('savePOSCAR',()=>download(P.toPOSCAR(state()),'POSCAR'));
    bind('allFrames',()=>download(allXYZ(),'trajectory.xyz'));
    bind('framePrev',()=>{stop();frame((state().metadata.frameIndex||0)-1);});bind('frameNext',()=>{stop();frame((state().metadata.frameIndex||0)+1);});
    $('frameRange').addEventListener('input',()=>{stop();frame(Number($('frameRange').value));});
    bind('framePlay',()=>{if(timer)return stop();$('framePlay').textContent='Ⅱ 停止';timer=setInterval(()=>{const frames=state().metadata.trajectory;if(!frames)return stop();frame(((state().metadata.frameIndex||0)+1)%frames.length);},500);});
    bind('rotateSelection',rotateSelection);
    bind('btnFullScreen',async()=>{const el=document.querySelector('.mv-app');if(document.fullscreenElement)await document.exitFullscreen();else await el.requestFullscreen();});
    bind('btnDataDock',()=>{$('dataText').value=IO.stateToXYZText(state());$('dataDialog').showModal();});
    bind('dataApply',()=>{app().loadText($('dataText').value);$('dataDialog').close();});
    bind('btnKetcher',openChem);
    bind('chemReadSmiles',async()=>{await(await ketcher()).setMolecule($('smilesText').value.trim());message('SMILESを描画しました。');});
    bind('chemSmiles',async()=>{$('smilesText').value=await(await ketcher()).getSmiles();message('描画中の構造をSMILESに変換しました。');});
    bind('chemSaveSmiles',async()=>download(await(await ketcher()).getSmiles()+'\n','structure.smi'));
    bind('chemSaveMol',async()=>download(await(await ketcher()).getMolfile('v3000'),'drawing.mol'));
    bind('chemFrom3D',async()=>{if(state().metadata.cell)throw Error('周期構造をSMILESへ直接変換できません。分子を非周期構造として切り出してください。');await(await ketcher()).setMolecule(IO.stateToMolText(state()));message('3D構造の結合情報を取り込みました。XYZ由来の結合次数・価数を描画画面で確認してください。');});
    bind('chemTo3D',make3D);bind('chemCancel',cancelChem);
    $('chemDialog').addEventListener('close',cancelChem);
    bind('sampleCrystal',()=>app().loadText('2\nNaCl primitive Lattice="0 2.82 2.82 2.82 0 2.82 2.82 2.82 0" pbc="T T T"\nNa 0 0 0\nCl 2.82 2.82 2.82\n'));
    // Axis constraints work on the canvas; text fields retain normal browser shortcuts.
    const renderer=app().renderer(),original=renderer.screenDeltaToWorld;
    renderer.screenDeltaToWorld=function(dx,dy,z){if(axis){const value=(dx-dy)/(this.currentScale||80);return {x:axis==='x'?value:0,y:axis==='y'?value:0,z:axis==='z'?value:0};}return original.call(this,dx,dy,z);};
    renderer.canvas.addEventListener('dblclick',e=>{const p=renderer.eventPoint(e),atom=renderer.pickAtom(p.x,p.y);if(atom){state().selectedAtomIds=new Set([atom.id]);$('btnSelectConnected').click();}});
    renderer.canvas.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;try{const key=e.key.toLowerCase();if(['x','y','z'].includes(key)){axis=axis===key?null:key;message(axis?`${axis.toUpperCase()}軸に移動を拘束（同じキーで解除）`:'移動拘束を解除');e.preventDefault();}else if(key==='escape'){axis=null;}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown'].includes(e.key)){e.preventDefault();const step=e.shiftKey?.1:.01;transform(atoms=>atoms.forEach(a=>{if(e.key==='ArrowLeft')a.x-=step;if(e.key==='ArrowRight')a.x+=step;if(e.key==='ArrowUp')a.y+=step;if(e.key==='ArrowDown')a.y-=step;if(e.key==='PageUp')a.z+=step;if(e.key==='PageDown')a.z-=step;}));}}catch(err){message(err.message,true);}});
    sync();
  }
  MV.Studio={init,sync,convert,allXYZ,frame};
})(window);
