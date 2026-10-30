(function(global){
  'use strict';
  const M=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node;};
  function sync(){
    const enabled=$('modelFEnabled').checked;
    $('modelFFields').hidden=!enabled;
    $('modelFStatus').textContent=enabled?'状態1は各計算のスピン多重度、状態2は下記の多重度。同じエンジン・手法・電荷で両状態を評価します。':'通常の単一ポテンシャル面で計算します。';
  }
  function input(primary,info){
    if(!$('modelFEnabled').checked)return {};
    const data={multiplicity:primary,modelF:{model:'amf',surface:$('modelFSurface').value,alphaKJMol:Number($('modelFAlpha').value),multiplicities:[primary,Number($('modelFMultiplicity2').value)]}};
    if(!$('modelFAlpha').value.trim()||!$('modelFMultiplicity2').value.trim())throw Error('ModelFのαと状態2の多重度を入力してください。');
    M.ModelF.validateInput(data,info);return {modelF:M.ModelF.normalize(data.modelF)};
  }
  function restore(data){const s=data.modelF;$('modelFEnabled').checked=!!s;if(s){$('modelFSurface').value=s.surface;$('modelFAlpha').value=s.alphaKJMol;$('modelFMultiplicity2').value=s.multiplicities[1];}sync();}
  function download(r,data){const url=URL.createObjectURL(new Blob([M.ModelF.csv(r,data)],{type:'text/csv;charset=utf-8'})),a=el('a',null,{href:url,download:'model-f-surfaces.csv'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function showResult(result,data,target='engineModelFResult'){
    const root=$(target);root.replaceChildren();root.hidden=!data.modelF;if(!data.modelF)return;
    M.ModelF.validateResult(result,data);
    const t=result.trajectory||result,s=data.modelF,n=t.energies.length,c=t.surfaceComponents;
    root.append(el('h4',M.ModelF.label(s)),el('p','両状態と上下両面を共通の基準で表示します。縦軸は選択面の最低値からの差（kJ/mol）、横軸は構造番号。人工力のエネルギーは含みません。',{class:'mv-small'}));
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 600 235');svg.setAttribute('role','img');svg.setAttribute('aria-label','2状態とAMF上下両面のエネルギー');svg.style.width='100%';
    const series=[['state1EV','#2563eb','状態1'],['state2EV','#d97706','状態2'],['lowerEV','#16845b','下側'],['upperEV','#a13fa6','上側']];
    let zero=Infinity,low=Infinity,high=-Infinity;for(const e of t.energies)zero=Math.min(zero,e);for(const [key] of series)for(const e of c[key]){low=Math.min(low,e);high=Math.max(high,e);}const span=Math.max(high-low,1e-6);
    const x=i=>55+530*i/Math.max(n-1,1),y=e=>190-150*(e-low)/span;
    const add=(tag,attrs,text)=>{const node=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);if(text!=null)node.textContent=text;svg.append(node);return node;};
    for(let k=0;k<=3;k++){const e=low+k*span/3,yy=y(e);add('line',{x1:55,x2:585,y1:yy,y2:yy,stroke:'#cbd5e1'});add('text',{x:50,y:yy+4,'text-anchor':'end','font-size':11,fill:'currentColor'},((e-zero)*M.ModelF.K).toFixed(1));}
    // Limit plot DOM/string size, preserving bin minima/maxima.
    for(const [key,color,name] of series){const ids=new Set([0,n-1]);const width=Math.max(1,Math.ceil(n/200));for(let i=0;i<n;i+=width){let a=i,b=i;for(let j=i+1;j<Math.min(n,i+width);j++){if(c[key][j]<c[key][a])a=j;if(c[key][j]>c[key][b])b=j;}ids.add(a);ids.add(b);}const selected=key===s.surface+'EV';add('polyline',{points:[...ids].sort((a,b)=>a-b).map(i=>`${x(i)},${y(c[key][i])}`).join(' '),fill:'none',stroke:color,'stroke-width':selected?3:1.5,...(!selected&&key.endsWith('EV')&&!key.startsWith('state')?{'stroke-dasharray':'5 3'}:{})});if(n===1)add('circle',{cx:x(0),cy:y(c[key][0]),r:3,fill:color});const k=series.findIndex(v=>v[0]===key);add('text',{x:60+130*k,y:20,fill:color,'font-size':12},name+(selected?'（追跡）':''));}
    add('text',{x:55,y:212,fill:'currentColor','font-size':11},'1');if(n>1)add('text',{x:585,y:212,fill:'currentColor','text-anchor':'end','font-size':11},String(n));root.append(svg);
    const slider=el('input',null,{type:'range',min:1,max:n,value:n,step:1,'aria-label':'ModelFの構造番号'});slider.style.width='100%';
    const detail=el('p',null,{class:'mv-small'}),table=el('table',null,{class:'mv-table'}),head=el('tr'),values=el('tr');for(const name of ['E₁ (eV)','E₂ (eV)','E− (eV)','E+ (eV)'])head.append(el('th',name));table.append(head,values);const wrap=el('div',null,{class:'mv-table-scroll'});wrap.append(table);
    const select=()=>{const i=Number(slider.value)-1;values.replaceChildren(...['state1EV','state2EV','lowerEV','upperEV'].map(k=>el('td',c[k][i].toFixed(8))));detail.textContent=`構造 ${i+1} / ${n} · Δ=E₁−E₂: ${(c.gapEV[i]*M.ModelF.K).toFixed(5)} kJ/mol · U: ${(c.couplingEV[i]*M.ModelF.K).toFixed(5)} kJ/mol`;};
    slider.addEventListener('input',select);select();const save=el('button','両状態・上下両面のCSVを保存',{class:'mv-btn',type:'button'});save.addEventListener('click',()=>download(result,data));root.append(slider,detail,wrap,save,el('p','AMFはモデル面です。αは実測・計算されたスピン軌道相互作用ではなく、状態遷移の確率や速度を与えません。',{class:'mv-small'}));
  }
  function init(){for(const id of ['modelFEnabled','modelFSurface','modelFAlpha','modelFMultiplicity2'])$(id).addEventListener('input',()=>{sync();M.AFIRUI?.sync();});sync();}
  M.ModelFUI={init,sync,input,restore,showResult};
})(window);
