/* Transient result inspection: never stores preview coordinates in the document. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),app=()=>MV.App,ns='http://www.w3.org/2000/svg';
  let data=null,index=0,active=false,bound=null,marker=null,range=null,live=null,details=null;
  function element(tag,attrs,text){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text)e.textContent=text;return e;}
  function restore(draw=true){
    if(!active)return;active=false;app().renderer().previewOnly=false;$('profilePreview').hidden=true;
    if(draw)app().renderer().renderState(app().getState(),true);
  }
  function select(i,preview=true){
    if(!data||!Number.isInteger(i)||i<0||i>=data.energies.length)return;
    index=i;$('profileRange').value=i;
    const energy=data.energies[i],bias=data.biasEnergies?.[i],relative=energy-data.energies[0];
    $('profileValue').textContent=(data.kind==='afir'?'ステップ '+i:'構造 '+(i+1))+' / '+(data.kind==='afir'?data.energies.length-1:data.energies.length)+' · E = '+energy.toFixed(6)+' eV · ΔE = '+relative.toFixed(6)+' eV'+(bias==null?'':' · 人工項 = '+bias.toFixed(6)+' eV · 合計 = '+(energy+bias).toFixed(6)+' eV');
    const x=40+500*i/Math.max(1,data.energies.length-1);
    marker?.setAttribute('x1',x);marker?.setAttribute('x2',x);
    if(!preview)return;
    MV.Studio?.stop();
    if(bound&&app().getState().metadata.trajectory===bound){MV.Studio.frame(i);return;}
    const positions=data.positions(i);
    if(!positions){restore();$('profileValue').textContent+=' · 途中表示では最新構造のみ取得します。全構造は計算終了後に選択できます。';return;}
    const state=MV.Model.createState(data.base(i));
    if(positions.length!==state.atoms.length||positions.some(v=>!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)||Math.abs(x)>10000)))return;
    state.atoms.forEach((a,k)=>{[a.x,a.y,a.z]=positions[k];});
    state.viewSettings={...app().getState().viewSettings};state.selectedAtomIds.clear();state.selectedBondIds.clear();
    active=true;app().renderer().previewOnly=true;app().renderer().renderState(state,true);
    $('profilePreview').hidden=false;$('profilePreview').textContent='計算結果のプレビュー · '+(data.kind==='afir'?'ステップ '+i:'構造 '+(i+1))+'（入力座標は保持）';
  }
  // Preserve extrema in each bucket; limit SVG size even for 10,001 frames.
  function sample(values){
    if(values.length<=400)return values.map((_,i)=>i);
    const ids=new Set([0,values.length-1]),width=Math.ceil(values.length/200);
    for(let a=0;a<values.length;a+=width){let lo=a,hi=a;for(let i=a+1;i<Math.min(a+width,values.length);i++){if(values[i]<values[lo])lo=i;if(values[i]>values[hi])hi=i;}ids.add(lo);ids.add(hi);}
    return [...ids].sort((a,b)=>a-b);
  }
  function set(next,follow=false){
    restore();data=next;bound=null;details=next.details||details;
    const series=[next.energies];if(next.biasEnergies)series.push(next.energies.map((e,i)=>e+next.biasEnergies[i]));
    if(!series[0]?.length||series.some(a=>a.length!==series[0].length||a.some(e=>!Number.isFinite(e))))throw Error('エネルギープロファイルが不正です。');
    const relative=series.map(a=>a.map(e=>e-a[0]));let lo=0,hi=0;for(const values of relative)for(const v of values){lo=Math.min(lo,v);hi=Math.max(hi,v);}
    const span=Math.max(hi-lo,1e-8),svg=$('energyProfile');svg.replaceChildren();
    svg.append(element('text',{x:12,y:16,'font-size':12},'ΔE (eV) · 各系列の始点基準'));
    svg.append(element('text',{x:12,y:34,'font-size':11},lo.toFixed(4)+' 〜 '+hi.toFixed(4)));
    relative.forEach((values,k)=>{
      const ids=sample(values),points=ids.map(i=>[40+500*i/Math.max(1,values.length-1),144-(values[i]-lo)*100/span]);
      svg.append(element('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:k?'#b45420':'#087e85','stroke-width':2}));
      // Every small-series point is focusable. The range always covers every frame.
      if(values.length<=100)points.forEach(([x,y],p)=>{
        const i=ids[p],dot=element('circle',{cx:x,cy:y,r:4,fill:k?'#b45420':'#087e85',tabindex:k?-1:0,role:'button','aria-label':(next.kind==='afir'?'ステップ '+i:'構造 '+(i+1))+': ΔE '+values[i].toFixed(6)+' eV'});
        const choose=()=>{pauseFollow();select(i);};dot.addEventListener('focus',choose);dot.addEventListener('click',choose);dot.addEventListener('pointerenter',choose);
        dot.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();choose();}});svg.append(dot);
      });
    });
    marker=element('line',{y1:36,y2:150,stroke:'#55646d','stroke-dasharray':'3 3'});svg.append(marker);
    svg.append(element('text',{x:380,y:175,'font-size':12},next.kind==='afir'?'最適化ステップ →':'経路の構造番号 →'));
    $('profileTitle').textContent=next.title;$('profileLegend').textContent=next.biasEnergies?'緑：物理エネルギー　茶：物理エネルギー＋人工項。横軸は探索ステップで、反応座標やTS検証結果ではありません。':'緑：物理エネルギー。横軸は構造番号です（単一構造の計算では1点）。';
    range=$('profileRange');range.max=next.energies.length-1;range.disabled=next.energies.length<2;
    $('profilePanel').hidden=false;select(follow?(next.focusIndex??next.energies.length-1):Math.min(index,next.energies.length-1),follow);
  }
  function pauseFollow(){$('profileFollow').checked=false;}
  function begin(cancel,showDetails){
    restore();live=cancel;details=showDetails;$('profilePanel').hidden=false;$('profileTitle').textContent='計算中 · 最初の評価を待っています…';
    $('energyProfile').replaceChildren();$('profileValue').textContent='';$('profileLegend').textContent='';data=null;bound=null;
    $('profileLiveControls').hidden=false;$('profileFollow').checked=true;$('profileRange').disabled=true;
  }
  function finish(){live=null;$('profileLiveControls').hidden=true;}
  function sync(){if(bound&&app().getState().metadata.trajectory===bound)select(app().getState().metadata.frameIndex||0,false);}
  function reveal(){$('profilePanel').hidden=false;$('viewer').scrollIntoView({block:'start',behavior:'smooth'});}
  function init(){
    $('profileRange').addEventListener('input',()=>{pauseFollow();select(Number($('profileRange').value));});
    let lastHover=0;
    $('energyProfile').addEventListener('pointermove',e=>{
      if(!data||Date.now()-lastHover<50)return;lastHover=Date.now();
      const r=$('energyProfile').getBoundingClientRect(),x=(e.clientX-r.left)*560/r.width;
      pauseFollow();select(Math.max(0,Math.min(data.energies.length-1,Math.round((x-40)/500*(data.energies.length-1)))));
    });
    $('profileRestore').addEventListener('click',()=>{pauseFollow();restore();});
    $('profileHide').addEventListener('click',()=>{pauseFollow();restore();$('profilePanel').hidden=true;});
    $('profileFollow').addEventListener('change',()=>{if(!$('profileFollow').checked)restore();});
    $('profileCancel').addEventListener('click',()=>live?.());
    $('profileDetails').addEventListener('click',()=>details?.());
    const canvas=app().renderer().canvas;
    for(const type of ['keydown','dblclick'])canvas.addEventListener(type,e=>{if(active){e.preventDefault();e.stopImmediatePropagation();}},true);
  }
  MV.EnergyProfile={init,set,select,restore,sync,begin,finish,reveal,sample,following:()=>$('profileFollow').checked,
    onStateChange(){restore(false);pauseFollow();},bindTrajectory(frames){bound=frames;sync();}};
})(window);
