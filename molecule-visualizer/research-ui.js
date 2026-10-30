/* Research controls: all calculations remain in the authenticated local bridge. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  let lastMode=null;
  const types={distance:['距離',2,'Å'],angle:['角度',3,'度'],dihedral:['二面角',4,'度']};
  function el(tag,attrs={},text){const e=document.createElement(tag);for(const [k,v] of Object.entries(attrs))if(k==='class')e.className=v;else e.setAttribute(k,v);if(text!=null)e.textContent=text;return e;}
  function coordinateRow(container,scan=false,value={}){
    const row=el('div',{class:'mv-grid research-coordinate'}),type=el('select',{'aria-label':scan?'スキャン座標の種類':'拘束の種類','data-field':'type'});
    for(const [key,[label]] of Object.entries(types))type.append(el('option',{value:key},label));type.value=value.type||'distance';
    const label=(title,control)=>{const l=el('label',{},title);l.append(control);row.append(l);};
    if(!scan){const enabled=el('input',{type:'checkbox','data-field':'enabled','aria-label':'この拘束を有効にする'});enabled.checked=value.enabled!==false;label('有効',enabled);}
    label('座標',type);const atoms=el('input',{type:'text','data-field':'atoms',placeholder:'1, 2','aria-label':scan?'スキャンの原子番号':'拘束の原子番号'});atoms.value=(value.atoms||[]).map(i=>i+1).join(', ');label('原子番号（順序を保持）',atoms);
    for(const key of scan?['start','stop','points']:['value']){const input=el('input',{type:'number','data-field':key,step:key==='points'?'1':'0.1','aria-label':({start:'開始値',stop:'終了値',points:'点数',value:'拘束値'})[key]});input.value=value[key]??({start:1,stop:2,points:11,value:1})[key];if(key==='points'){input.min='2';input.max='100';}label(({start:'開始値',stop:'終了値',points:'点数',value:'拘束値'})[key],input);}
    const remove=el('button',{type:'button',class:'mv-btn'},'削除');remove.addEventListener('click',()=>{row.remove();$('scanCoordinateAdd').disabled=$('scanCoordinateRows').children.length>=2;});row.append(remove);
    const unit=el('span',{class:'mv-small'});row.append(unit);const sync=()=>{unit.textContent='単位: '+types[type.value][2];atoms.placeholder=Array.from({length:types[type.value][1]},(_,i)=>i+1).join(', ');};type.addEventListener('change',sync);sync();container.append(row);$('scanCoordinateAdd').disabled=$('scanCoordinateRows').children.length>=2;
  }
  function coordinates(container,count,scan){return [...container.children].filter(row=>scan||row.querySelector('[data-field="enabled"]')?.checked!==false).map(row=>{const get=k=>row.querySelector(`[data-field="${k}"]`).value,type=get('type'),raw=get('atoms').trim().split(/[\s,、]+/).filter(Boolean);if(raw.length!==types[type][1]||raw.some(n=>!/^\d+$/.test(n)||+n<1||+n>count)||new Set(raw.map(Number)).size!==raw.length)throw Error(`${types[type][0]}の原子番号を${types[type][1]}個、1〜${count}から順番に指定してください。`);const out={type,atoms:raw.map(n=>+n-1)};for(const key of scan?['start','stop','points']:['value']){const rawValue=get(key);if(!rawValue.trim())throw Error('拘束・スキャンの値を入力してください。');out[key]=Number(rawValue);if(!Number.isFinite(out[key]))throw Error('拘束・スキャンには有限の数値が必要です。');}if(scan&&(!Number.isInteger(out.points)||out.points<2||out.points>100||out.start===out.stop))throw Error('スキャンの点数は2〜100の整数、開始値と終了値は異なる値にしてください。');const values=scan?[out.start,out.stop]:[out.value];if(values.some(v=>type==='distance'?v<.1||v>100:type==='angle'?v<1||v>179:Math.abs(v)>360))throw Error('距離は0.1〜100 Å、角度は1〜179度、二面角は−360〜360度です。');return out;});}
  function constraintsInput(state,mode){if(!$('internalConstraintsEnabled').checked)return [];if(!['optimize','afir','scan'].includes(mode))throw Error('内部座標の拘束はMIN・AFIR-MIN・スキャン専用です。拘束をオフにしてください。');const rows=coordinates($('internalConstraintRows'),state.atoms.length,false);if(!rows.length&& !$('internalConstraintRows').children.length)throw Error('内部座標の拘束を追加してください。');return rows;}
  function numeric(id,lo,hi,integer=false){const value=Number($(id).value);if(!$(id).value.trim()||!Number.isFinite(value)||value<lo||value>hi||(integer&&!Number.isInteger(value)))throw Error(`${$(id).closest('label').firstChild.textContent}: ${lo}〜${hi}${integer?'の整数':''}を指定してください。`);return value;}
  function input(data,state,info,options={}){
    const constraints=constraintsInput(state,data.mode);if(constraints.length){if(!info.internalConstraints)throw Error('接続中のサーバーは内部座標の拘束に対応していません。');data.internalConstraints=constraints;}
    if(data.mode==='irc'){if(data.symbols.length>200)throw Error('IRCは最大200原子です。');if(!info.modes.includes('irc')||!info.sellaVersion)throw Error('IRCにはSellaを導入した対応サーバーが必要です。');data.irc={direction:$('ircDirection').value,stepSize:numeric('ircStepSize',.005,.5),relaxEndpoints:$('ircRelaxEndpoints').checked};}
    if(data.mode==='scan'){if(!info.modes.includes('scan'))throw Error('接続中のサーバーは緩和スキャンに対応していません。');const rows=coordinates($('scanCoordinateRows'),state.atoms.length,true);if(rows.length<1||rows.length>2||rows.reduce((p,r)=>p*r.points,1)>400)throw Error('1〜2本の座標を指定し、合計400点以内にしてください。');data.scan={coordinates:rows,stopOnFailure:$('scanStopOnFailure').checked};}
    if(data.mode==='lup'){
      if(!info.modes.includes('lup'))throw Error('接続中のサーバーはLUP系（CI-String）に対応していません。');
      const optimizer=$('lupOptimizer').value;if(!['fire','lbfgs'].includes(optimizer)||info.pathOptimizers?.lup&&!info.pathOptimizers.lup.includes(optimizer))throw Error('接続中のサーバーで利用できる経路アルゴリズムを選択してください。');
      data.optimizer=optimizer;data.lup={redistributeEvery:numeric('lupRedistributeEvery',1,100,true),redistributionTolerance:numeric('lupRedistributionTolerance',.00001,.1)};
    }
    if(['cineb','lup'].includes(data.mode)){
      if($('adaptiveEnabled').checked){if(!info.adaptiveNEB)throw Error('接続中のサーバーは自動ノード追加に対応していません。');data.adaptiveNEB={enabled:true,maxImages:numeric('adaptiveMaxImages',data.images.length,100,true),interval:numeric('adaptiveInterval',1,10000,true),maxSpacing:numeric('adaptiveMaxSpacing',.01,20),energyGap:numeric('adaptiveEnergyGap',.0001,100)};}
      if($('pathSplitEnabled').checked&&info.pathSplit){const width=numeric('pathSplitSmooth',1,21,true);if(!(width%2))throw Error('平滑化の幅は奇数にしてください。');data.pathSplit={enabled:true,prominence:numeric('pathSplitProminence',0,100),minSeparation:numeric('pathSplitSeparation',2,99,true),smoothingWindow:width};}
      if(state.metadata.trajectory?.length===data.images.length){const ids=state.metadata.trajectory.map(f=>f.metadata?.pathNodeId);if(ids.every(id=>typeof id==='string'&&id)&&new Set(ids).size===ids.length)data.nodeIds=ids;}
    }
    if(!options.batch&&$('thermoEnabled').checked&&['optimize','ts','vibrations'].includes(data.mode)){
      if(!info.thermochemistry)throw Error('接続中のサーバーは熱化学量の計算に対応していません。');
      data.thermochemistry={temperature:numeric('thermoTemperature',1,5000),pressure:numeric('thermoPressure',.001,1e9),symmetryNumber:numeric('thermoSymmetry',1,10000,true),state:$('thermoState').value,standardState:$('thermoStandardState').value,lowFrequency:$('thermoLowFrequency').value,frequencyCutoff:numeric('thermoCutoff',1,1000)};
    }
  }
  function settings(mode){if(mode!==lastMode&&['ts','optimize'].includes(mode))$('thermoState').value=mode==='ts'?'ts':'minimum';lastMode=mode;$('researchConstraints').hidden=!['optimize','batch','scan'].includes(mode)&&!$('internalConstraintsEnabled').checked;$('engineLUPSettings').hidden=mode!=='lup';$('engineIRCSettings').hidden=mode!=='irc';$('engineScanSettings').hidden=mode!=='scan';$('engineAdaptiveSettings').hidden=!['cineb','lup'].includes(mode);$('engineThermoSettings').hidden=!['optimize','ts','vibrations'].includes(mode);}
  function restore(data){
    $('internalConstraintsEnabled').checked=!!data.internalConstraints?.length;$('internalConstraintRows').replaceChildren();for(const c of data.internalConstraints||[])coordinateRow($('internalConstraintRows'),false,c);
    if(data.mode==='lup')$('lupOptimizer').value=data.optimizer||'lbfgs';if(data.lup){$('lupRedistributeEvery').value=data.lup.redistributeEvery;$('lupRedistributionTolerance').value=data.lup.redistributionTolerance;}
    if(data.irc){$('ircDirection').value=data.irc.direction;$('ircStepSize').value=data.irc.stepSize;$('ircRelaxEndpoints').checked=data.irc.relaxEndpoints;}
    if(data.scan){$('scanCoordinateRows').replaceChildren();for(const c of data.scan.coordinates)coordinateRow($('scanCoordinateRows'),true,c);$('scanStopOnFailure').checked=data.scan.stopOnFailure;}
    $('adaptiveEnabled').checked=!!data.adaptiveNEB?.enabled;for(const [key,id] of Object.entries({maxImages:'adaptiveMaxImages',interval:'adaptiveInterval',maxSpacing:'adaptiveMaxSpacing',energyGap:'adaptiveEnergyGap'}))if(data.adaptiveNEB?.[key]!=null)$(id).value=data.adaptiveNEB[key];
    $('pathSplitEnabled').checked=!!data.pathSplit?.enabled;for(const [key,id] of Object.entries({prominence:'pathSplitProminence',minSeparation:'pathSplitSeparation',smoothingWindow:'pathSplitSmooth'}))if(data.pathSplit?.[key]!=null)$(id).value=data.pathSplit[key];
    const t=data.thermochemistry;$('thermoEnabled').checked=!!t;if(t)for(const [key,id] of Object.entries({temperature:'thermoTemperature',pressure:'thermoPressure',symmetryNumber:'thermoSymmetry',state:'thermoState',standardState:'thermoStandardState',lowFrequency:'thermoLowFrequency',frequencyCutoff:'thermoCutoff'}))$(id).value=t[key];settings(data.mode);
  }
  function downloadCSV(name,rows){const text=rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n'),a=el('a',{href:URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'})),download:name});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function table(head,rows){const t=el('table'),thead=el('thead'),tr=el('tr');for(const x of head)tr.append(el('th',{},x));thead.append(tr);t.append(thead);const b=el('tbody');for(const row of rows){const tr=el('tr');for(const x of row)tr.append(el('td',{},x));b.append(tr);}t.append(b);const wrap=el('div',{class:'mv-table-scroll'});wrap.append(t);return wrap;}
  function showResult(r,j){
    const out=$('researchResult');out.replaceChildren();
    if(r.mode==='lup'){
      const d=r.diagnostics||{},settings=r.lup||j.data.lup;out.append(el('p',{class:'mv-small'},`LUP系（CI-String） · ${(r.optimizer||j.data.optimizer||'lbfgs').toUpperCase()} · 再分布残差 ${Number.isFinite(d.redistributionResidual)?d.redistributionResidual.toPrecision(5)+' Å':'未取得'}${settings?' / 閾値 '+settings.redistributionTolerance+' Å':''}${Number.isFinite(d.redistributionMove)?' · 再分布による最大変位 '+d.redistributionMove.toPrecision(5)+' Å':''}。CIの最高点はTS候補です。TS最適化・振動解析で別途確認できます。`));
    }
    if(r.mode==='irc'){out.append(el('h3',{},'IRCの到達状態'));const rows=Object.entries(r.branches||{}).map(([name,b])=>[name==='forward'?'正方向':'逆方向',b.steps,b.converged?'IRC収束':'IRC未収束',b.endpointConverged?'端点の力は収束':j.data.irc?.relaxEndpoints?'端点の力は未収束':'端点MIN未実施']);out.append(table(['方向','ステップ','IRC','端点'],rows));out.append(el('p',{class:'mv-small'},`経路中のTS入力: 構造${(r.tsIndex??0)+1}。端点構造を確認して反応物・生成物との接続を判断してください。`));}
    if(r.mode==='scan'&&r.scan){out.append(el('h3',{},'スキャン結果'));const rows=(r.scan.nodes||[]).map((n,i)=>[i+1,n.direction==='reverse'?'復路':'往路',JSON.stringify(n.targets),JSON.stringify(n.actual),n.converged?'収束':'未収束',n.steps,r.energies[i]]);const heads=['点','方向','指定座標','実際の座標','状態','ステップ','E (eV)'];out.append(table(heads,rows));const b=el('button',{class:'mv-btn'},'スキャン表をCSV保存');b.onclick=()=>downloadCSV('relaxed-scan.csv',[heads,...rows]);out.append(b);}
    if(r.thermochemistry){const t=r.thermochemistry;out.append(el('h3',{},'熱化学量'));if(t.status!=='completed')out.append(el('p',{},t.error||t.note||'熱化学量は未確定です。'));else{out.append(el('p',{class:'mv-small'},`${t.temperature} K · ${t.pressure} Pa · ${t.standardState==='1M'?'1 mol/L':'理想気体'} · ${t.state==='ts'?'TS':'極小構造'}`));const rows=[['電子・溶媒補正エネルギー',t.electronicEnergyEV,'eV'],['ZPE',t.zpeEV,'eV'],['H',t.enthalpyEV,'eV'],['S',t.entropyEVPerK,'eV/K'],['G',t.gibbsEV,'eV'],['熱補正',t.thermalCorrectionEV,'eV'],['標準状態補正',t.standardStateCorrectionEV,'eV']];out.append(table(['量','値','単位'],rows.map(r=>[r[0],Number.isFinite(r[1])?r[1].toPrecision(10):'—',r[2]])));const b=el('button',{class:'mv-btn'},'熱化学量をCSV保存');b.onclick=()=>downloadCSV('thermochemistry.csv',[['量','値','単位'],...rows]);out.append(b);for(const note of t.notes||[])out.append(el('p',{class:'mv-small'},note));}}
    if(r.adaptiveStatus?.enabled){const a=r.adaptiveStatus;out.append(el('p',{class:'mv-small'},`自動ノード追加: ${r.images.length}ノード · 未解消の間隔 ${a.unresolvedIntervals??0}`+(a.nodeLimitReached?' · ノード上限に到達':'')+(a.blockedIntervals?.length?` · 追加できない区間 ${a.blockedIntervals.length}`:'')+'。力の収束と経路の分解能は別に確認してください。'));}
    if(r.pathSegments?.segments?.length){out.append(el('h3',{},'経路の分割候補'));for(const segment of r.pathSegments.segments){const row=el('div',{class:'mv-row'});row.append(el('span',{},`構造${segment.start+1}〜${segment.end+1}${segment.needsEndpointOptimization?' · 端点のMINが必要':' · 端点の物理力は閾値以下'}`));const b=el('button',{class:'mv-btn'},r.mode==='lup'?'この区間をLUP系入力へ':'この区間をCI-NEB入力へ');b.onclick=()=>{try{MV.EngineUI.prepareSegment(segment);}catch(e){$('engineMessage').textContent=e.message;}};row.append(b);out.append(row);}out.append(el('p',{class:'mv-small'},'分割によって新たに端点となる谷は、必要に応じてMINで緩和してください。区間ごとの経路計算は設定を確認して実行します。'));}
  }
  function init(){
    $('internalConstraintAdd').onclick=()=>coordinateRow($('internalConstraintRows'));
    $('scanCoordinateAdd').onclick=()=>{if($('scanCoordinateRows').children.length<2)coordinateRow($('scanCoordinateRows'),true);};coordinateRow($('scanCoordinateRows'),true);
    $('thermoEnabled').addEventListener('change',()=>{if($('thermoEnabled').checked)$('engineVibrationCheck').checked=true;});
    $('btnIRC').onclick=()=>MV.EngineUI.prepareSingle('irc');$('btnScan').onclick=()=>MV.EngineUI.prepareSingle('scan');
    $('engineMode').addEventListener('change',()=>{if(['ts','optimize'].includes($('engineMode').value))$('thermoState').value=$('engineMode').value==='ts'?'ts':'minimum';});
  }
  MV.ResearchUI={init,input,settings,restore,showResult,constraintsInput,coordinateRow};
})(window);
