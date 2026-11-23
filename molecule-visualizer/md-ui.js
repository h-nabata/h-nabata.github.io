/* Molecular dynamics controls, input checks and thermodynamic samples. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer, $=id=>document.getElementById(id);
  const numberText=n=>Number(n.toPrecision(7)).toString();
  function number(id, label, minimum, maximum, integer=false){
    const raw=$(id).value, value=Number(raw);
    if(!raw.trim() || !Number.isFinite(value) || value<minimum || value>maximum || (integer&&!Number.isInteger(value)))
      throw Error(label+'は'+minimum+'〜'+maximum+(integer?'の整数':'の数値')+'で入力してください。');
    return value;
  }
  function topology(frame){
    const indices=new Map(frame.atoms.map((a,i)=>[a.id,i]));
    if(frame.atoms.some(a=>Number(a.mol?.props?.RAD)>0))throw Error('この古典力場は閉殻分子用です。ラジカルの運動には対応する電子状態計算のエンジンを選択してください。');
    const bonds=[];
    for(const b of frame.bonds){
      if(b.type==='hydrogen')continue; // Display-only hydrogen bonds are not part of a force-field topology.
      if(b.type!=='covalent')throw Error('古典力場に渡せない結合種があります。構造の配位結合などを確認してください。');
      const order=b.order===4?1.5:b.order, first=indices.get(b.atom1), second=indices.get(b.atom2);
      if(first===undefined||second===undefined||![1,1.5,2,3].includes(order))throw Error('古典力場へ渡す結合次数・原子番号を確認してください。');
      bonds.push([first,second,order]);
    }
    return {model:$('mdForceField').value, bonds, formalCharges:frame.atoms.map(a=>a.charge||0)};
  }
  const bathNames={'nose-hoover-chain':'Nosé–Hoover鎖',bussi:'Bussi',langevin:'Langevin'};
  const bathHelp={
    'nose-hoover-chain':'Nosé–Hoover鎖が系と熱を交換し、決定論的に温度を制御します。',
    bussi:'運動エネルギーがカノニカル分布に従うよう、系全体の速度を確率的に調節します。',
    langevin:'各原子に摩擦力とランダムな力を加えて温度を制御します。'
  };
  let chosenThermostat=false;
  function thermostat(md){return md.thermostat||(md.ensemble==='nvt'?'langevin':null);}
  function methodLabel(md){
    if(!md?.ensemble)return '';
    return [md.ensemble.toUpperCase(),bathNames[thermostat(md)],md.ensemble==='npt'?'等方MC圧力浴':''].filter(Boolean).join(' · ');
  }
  function formMethod(){return methodLabel({ensemble:$('mdEnsemble').value,thermostat:$('mdEnsemble').value==='nve'?null:$('mdThermostat').value});}
  function availableBaths(info){
    return info ? info.molecularDynamics?.thermostats || ['langevin'] : Object.keys(bathNames);
  }
  function frozenCount(frame){
    const c=frame.metadata?.constraints;
    return c?.enabled?c.fixedAtomIds.length:0;
  }
  let unanchoredCOM=null;
  function pressureSupport(info,cell,model){
    if(!info)return '圧力を扱うには、周期系の応力を計算できるエンジンに接続してください。';
    if(!info.molecularDynamics?.pressureMeasurement)return '接続中のエンジンは圧力計算に対応していません。';
    if(info.uma&&!info.uma.stressTasks?.includes($('engineUMATask')?.value))return 'UMAで圧力を扱うには無機バルク（OMat）または分子結晶（OMC）を選択してください。';
    if(info.llmlip){
      const m=info.llmlip.models.find(m=>m.id===model?.model);
      if(!m?.available||!m.stress||m.periodic==='none'||(m.architecture==='uma-v1'&&model.head==='omol'))
        return '周期系の応力に対応したllmlipモデルとheadを選択してください。';
    }
    if(!MV.Optimization.validCell(cell)||!cell.pbc.every(Boolean))
      return 'NPTと瞬間圧力の記録には、構造に3方向周期のセルを設定してください。';
    return '';
  }
  function sync(){
    const active=$('engineMode').value==='md';
    $('mdSettings').hidden=!active;
    if(!active)return;
    const state=MV.App.getState(),info=MV.EngineUI.getConnection()?.info;
    const ensemble=$('mdEnsemble').value, heat=ensemble!=='nve', npt=ensemble==='npt';
    const frozen=frozenCount(state);
    const explicit=$('mdVelocitySource').value==='explicit',single=state.atoms.length-frozen<=1,rdkit=info?.engine==='rdkit';
    const available=availableBaths(info),picker=$('mdThermostat');
    if(!chosenThermostat)picker.value=available.includes('nose-hoover-chain')?'nose-hoover-chain':info?.molecularDynamics?.defaultThermostat||available[0]||'';
    for(const option of picker.options)option.disabled=!available.includes(option.value);
    const bath=picker.value,legacy=info&&!info.molecularDynamics?.thermostats;
    const pressureIssue=frozen?'固定原子を含むMDはNVEまたはNVTを選んでください。圧力計算には全原子を可動にします。':pressureSupport(info,state.metadata.cell,MV.LLMLIPUI?.input().llmlip);
    const nptIssue=pressureIssue||(!info?.molecularDynamics?.ensembles?.includes('npt')?'接続中のエンジンはNPTに対応していません。':'');
    for(const option of $('mdEnsemble').options)option.disabled=option.value==='npt'&&!!nptIssue;
    $('mdTemperatureLabel').textContent=heat?(explicit?'熱浴温度 (K)':'初期温度・熱浴温度 (K)'):'初期温度 (K)';
    $('mdTemperature').closest('label').hidden=explicit&&!heat;
    $('mdSeed').closest('label').hidden=explicit&&!npt&&(!heat||bath==='nose-hoover-chain');
    $('mdVelocityHelp').textContent=(explicit?'入力した速度から開始します。重心の並進運動を除く設定では、全原子の速度から重心速度を差し引きます。':'初期速度はMaxwell–Boltzmann分布から生成します。別の初期速度で比較するにはシードを変更します。')+(single?' 単原子では重心の並進運動を残します。':'');
    const com=$('mdRemoveCOM');
    if(frozen&&unanchoredCOM===null){unanchoredCOM=com.checked;com.checked=false;}
    else if(!frozen&&unanchoredCOM!==null){com.checked=unanchoredCOM;unanchoredCOM=null;}
    com.disabled=single;
    if(frozen)$('mdVelocityHelp').textContent='固定原子の速度はゼロとし、可動原子だけを積分します。初速度を指定する場合は固定原子の行を 0 0 0 と入力してください。';
    $('mdVelocitiesLabel').hidden=!explicit;
    $('mdThermostatLabel').hidden=!heat;
    $('mdFrictionLabel').hidden=!heat||bath!=='langevin';
    $('mdThermostatTimeLabel').hidden=!heat||bath==='langevin';
    $('mdPressureLabel').hidden=$('mdBarostatIntervalLabel').hidden=$('mdVolumeMoveLabel').hidden=!npt;
    $('mdRecordPressureLabel').hidden=npt||!!pressureIssue;
    $('mdCouplingSettings').hidden=!heat&&!!pressureIssue;
    $('mdCouplingSummary').textContent=npt?'熱浴・圧力浴の詳細':heat?(pressureIssue?'熱浴の詳細':'熱浴・圧力記録の詳細'):'圧力の記録';
    $('mdBathHelp').textContent=(heat?bathHelp[bath]||'':'熱浴を使わずに、一定体積で運動を積分します。')+(npt?' 等方モンテカルロ圧力浴がセルの形を保ったまま体積を変えます。':'');
    const notes=[];
    if(heat&&legacy)notes.push('このbridgeで選べる熱浴はLangevinです。ほかの熱浴を使うにはbridge.pyを更新してください。');
    else if(heat&&!available.includes('nose-hoover-chain'))notes.push('Nosé–Hoover鎖を使うには、bridgeの環境にASE 3.25以降が必要です。');
    if(nptIssue)notes.push(nptIssue);
    $('mdEnsembleHelp').textContent=notes.join(' ');
    $('mdCellExample').hidden=!npt&&(!info?.molecularDynamics?.ensembles?.includes('npt')||!pressureIssue);
    $('mdForceFieldSettings').hidden=!rdkit;
    const steps=Number($('mdSteps').value),dt=Number($('mdTimestep').value),stride=Number($('mdStride').value);
    $('mdPlan').textContent=steps>0&&dt>0&&stride>0?'計算時間 '+numberText(steps*dt)+' fs · 初期構造と最終構造を含め '+(1+Math.ceil(steps/stride))+' フレームを保存':'';
    if(npt&&steps>0&&Number($('mdBarostatInterval').value)>=1){
      const attempts=Math.floor(steps/Number($('mdBarostatInterval').value));
      $('mdPlan').textContent+=' · セル変更を'+attempts+'回試行'+(attempts?'':'（試行間隔が計算より長いため体積は一定）');
    }
    if(rdkit){
      try{
        const f=topology(state), auto=state.bonds.filter(b=>b.source==='inferred'&&b.type==='covalent').length;
        const charges=f.formalCharges.flatMap((q,i)=>q?[(i+1)+': '+(q>0?'+':'')+q]:[]);
        $('mdTopologySummary').textContent=f.bonds.length+'結合（距離から推定 '+auto+'本） · 形式電荷 '+(charges.join('、')||'全原子0')+'。推定した結合次数は単結合です。必要に応じて描画画面で編集するか、結合を含むMOL / SDFを開いてください。';
        $('mdTopologyBonds').textContent=f.bonds.map(([i,j,k])=>(i+1)+'–'+(j+1)+' ('+k+')').join('、');
      }catch(e){$('mdTopologySummary').textContent=e.message;$('mdTopologyBonds').textContent='';}
    }
  }
  function input(data, frame, info){
    if(!info.modes?.includes('md'))throw Error('MDに対応するbridge.py 1.21.0以降へ更新して再接続してください。');
    const cap=info.molecularDynamics||{};
    data.maxSteps=number('mdSteps','積分ステップ数',1,cap.maxSteps||100000,true);
    const tv=number('mdTimestep','時間刻み (fs)',.001,10);
    const explicit=$('mdVelocitySource').value==='explicit',ensemble=$('mdEnsemble').value;
    if(!(cap.ensembles||['nve','nvt']).includes(ensemble))throw Error('接続中のbridgeが対応するアンサンブルを選択してください。');
    const bath=$('mdThermostat').value,npt=ensemble==='npt';
    const md={ensemble,timestepFs:tv,temperatureK:explicit&&ensemble==='nve'?0:number('mdTemperature','温度 (K)',0,10000),
      seed:explicit&&!npt&&(ensemble==='nve'||bath==='nose-hoover-chain')?0:number('mdSeed','乱数シード',0,4294967295,true),
      sampleEvery:number('mdStride','軌跡の保存間隔',1,100000,true),removeCOM:frame.atoms.length-frozenCount(frame)>1&&$('mdRemoveCOM').checked};
    if(ensemble!=='nve'){
      if(!availableBaths(info).includes(bath))throw Error('選択した熱浴を接続中のbridgeで実行できません。対応する熱浴を選択してください。');
      if((npt||bath!=='langevin')&&md.temperatureK<=0)throw Error('この計算では0 Kより高い熱浴温度を指定してください。');
      if(cap.thermostats)md.thermostat=bath; // The 1.21 bridge accepts only frictionPerPs.
      if(bath==='langevin')md.frictionPerPs=number('mdFriction','摩擦係数 (ps⁻¹)',.001,1000);
      else md.thermostatTimeFs=number('mdThermostatTime','熱浴の緩和時間 (fs)',.001,100000);
    }
    const pressureIssue=frozenCount(frame)?'固定原子を含むMDではNPTと圧力記録を利用できません。':pressureSupport(info,data.cell,data.llmlip||MV.LLMLIPUI?.input().llmlip);
    if(npt){
      if(pressureIssue)throw Error(pressureIssue);
      md.barostat='mc-isotropic';
      md.pressureBar=number('mdPressure','目標圧力 (bar)',.000001,10000000);
      md.barostatInterval=number('mdBarostatInterval','セル変更の試行間隔',1,100000,true);
      md.volumeStepPercent=number('mdVolumeMove','対数体積の最大変化幅 (%)',.001,30);
    }else if(!pressureIssue&&$('mdRecordPressure').checked)md.recordPressure=true;
    const samples=1+Math.ceil(data.maxSteps/md.sampleEvery);
    if(samples>(cap.maxFrames||1000)||samples*frame.atoms.length>(cap.maxAtomFrames||100000))
      throw Error('保存する軌跡が上限を超えます。保存間隔を広げるか、積分ステップ数を減らしてください。');
    if(explicit){
      const lines=$('mdVelocities').value.trim().split(/\r?\n/);
      if(lines.length!==frame.atoms.length)throw Error('初期速度は構造の原子数と同じ行数で入力してください。');
      md.initialVelocitiesAngstromPerFs=lines.map((line,i)=>{
        const fields=line.trim().replace(/−/g,'-').split(/\s+/);
        const values=fields.map(Number);
        if(fields.length!==3||!values.every(v=>Number.isFinite(v)&&Math.abs(v)<=10))throw Error('初期速度の'+(i+1)+'行目に−10〜10 Å/fsの3成分を入力してください。');
        return values;
      });
    }
    const masses=frame.atoms.map(a=>a.xyzExtras?.mass?.values?.[0]??a.xyzExtras?.masses?.values?.[0]??a.mol?.props?.MASS??null);
    if(masses.some(m=>m!==null))md.massesAmu=masses.map(m=>{
      if(m===null)return null;
      const n=Number(m);
      if(!Number.isFinite(n)||n<.01||n>1000)throw Error('個別に指定された原子質量は0.01〜1000 uで入力してください。');
      return n;
    });
    data.md=md;
    if(info.engine==='rdkit'){
      data.forceField=topology(frame);
      if(data.forceField.formalCharges.reduce((a,b)=>a+b,0)!==data.charge)throw Error('系全体の電荷を各原子の形式電荷の合計と合わせてください。');
      if(data.multiplicity!==1)throw Error('RDKitの古典力場にはスピン多重度1の閉殻構造を指定してください。');
    }
  }
  function restore(data){
    if(data.mode!=='md')return;
    const md=data.md;
    chosenThermostat=md.ensemble!=='nve';
    for(const [id,v] of Object.entries({mdSteps:data.maxSteps,mdEnsemble:md.ensemble,mdTimestep:md.timestepFs,mdTemperature:md.temperatureK,
      mdSeed:md.seed,mdStride:md.sampleEvery,mdFriction:md.frictionPerPs??10,
      mdThermostat:thermostat(md)||'nose-hoover-chain',mdThermostatTime:md.thermostatTimeFs??100,mdPressure:md.pressureBar??1,
      mdBarostatInterval:md.barostatInterval??25,mdVolumeMove:md.volumeStepPercent??1,mdForceField:data.forceField?.model||'MMFF94'}))$(id).value=v;
    $('mdRemoveCOM').checked=md.removeCOM;
    $('mdRecordPressure').checked=!!md.recordPressure;
    $('mdVelocitySource').value=md.initialVelocitiesAngstromPerFs?'explicit':'thermal';
    $('mdVelocities').value=(md.initialVelocitiesAngstromPerFs||[]).map(v=>v.join(' ')).join('\n');
    $('mdVelocitySettings').open=!!md.initialVelocitiesAngstromPerFs;
    sync();
  }
  function restoreFrame(frame,data){
    if(!data.md)return;
    if(data.md.massesAmu)data.md.massesAmu.forEach((m,i)=>{if(m!=null)frame.atoms[i].xyzExtras={...frame.atoms[i].xyzExtras,mass:{type:'R',values:[String(m)]}};});
    if(data.forceField){
      const f=data.forceField;
      frame.atoms.forEach((a,i)=>a.charge=f.formalCharges[i]);
      frame.bonds=f.bonds.map(([i,j,order])=>MV.Model.createBond({atom1:frame.atoms[i].id,atom2:frame.atoms[j].id,order:order===1.5?4:order,type:'covalent',source:'manual'}));
    }
  }
  function validatePressure(r,data){
    const t=r.trajectory,npt=data.md.ensemble==='npt';
    const sameCell=(a,b)=>a&&b&&JSON.stringify(a.vectors)===JSON.stringify(b.vectors)&&JSON.stringify(a.pbc)===JSON.stringify(b.pbc);
    if(!npt&&!data.md.recordPressure){
      if(t.cells?.some(c=>!sameCell(c,data.cell)))throw Error('固定セルMDの軌跡でセルが変化しています。');
      return;
    }
    if(r.units.volume!=='angstrom^3'||r.units.pressure!=='bar'||!Array.isArray(t.cells)||
       !['volumeA3','pressureBar'].every(key=>Array.isArray(t[key])&&t[key].length===t.images.length&&t[key].every(Number.isFinite))||
       !sameCell(t.cells[0],data.cell)||!sameCell(t.cells.at(-1),r.cell)||r.cells?.length!==1||!sameCell(r.cell,r.cells[0])||
       r.volumeA3!==t.volumeA3.at(-1)||r.pressureBar!==t.pressureBar.at(-1))
      throw Error('MD軌跡のセル・体積・圧力と最終結果が一致しません。');
    for(const [i,c] of t.cells.entries()){
      MV.Optimization.checkCell(c,data);
      const v=MV.Optimization.cellVolume(c);
      if(!c.pbc.every(Boolean)||t.volumeA3[i]<=0||
         Math.abs(v-t.volumeA3[i])>1e-8*Math.max(1,v)||(!npt&&!sameCell(c,data.cell)))
        throw Error('MD軌跡のセルと体積が一致しません。');
    }
  }
  function validate(r,data){
    const t=r.trajectory, md=data.md;
    const settingKeys=['ensemble','timestepFs','sampleEvery','temperatureK','seed','barostat','pressureBar','barostatInterval','volumeStepPercent','thermostatTimeFs','frictionPerPs','removeCOM','massesAmu','initialVelocitiesAngstromPerFs'];
    const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    if(!t||!r.md||thermostat(md)!==thermostat(r.md)||!!md.recordPressure!==!!r.md.recordPressure||settingKeys.some(key=>!equal(r.md[key],md[key]))||
       ['model','bonds','formalCharges'].some(key=>!equal(r.forceField?.[key],data.forceField?.[key]))||
       r.units?.time!=='fs'||r.units?.temperature!=='K'||r.units?.velocity!=='angstrom/fs'||
       !Array.isArray(r.velocitiesAngstromPerFs)||r.velocitiesAngstromPerFs.length!==r.symbols.length||
       r.velocitiesAngstromPerFs.some(row=>!Array.isArray(row)||row.length!==3||!row.every(Number.isFinite))||
       !Number.isInteger(r.steps)||r.steps<0||r.steps>data.maxSteps||r.reason==='completed'&&r.steps!==data.maxSteps)
      throw Error('MDの計算条件・ステップ数が入力と一致しません。');
    MV.Trajectory.validate({...t,kind:'md',symbols:r.symbols});
    validatePressure(r,data);
    if(!['energies','timeFs','kineticEV','totalEV','temperatureK'].every(k=>Array.isArray(t[k])&&t[k].length===t.images.length&&t[k].every(Number.isFinite))||
       !Array.isArray(t.stepNumbers)||t.stepNumbers[0]!==0||t.stepNumbers.at(-1)!==r.steps||
       t.stepNumbers.some((v,i)=>i>0&&v<=t.stepNumbers[i-1]||Math.abs(t.timeFs[i]-v*md.timestepFs)>1e-7||
         t.kineticEV[i]<0||t.temperatureK[i]<0||Math.abs(t.totalEV[i]-t.energies[i]-t.kineticEV[i])>1e-6)||
       JSON.stringify(t.images[0])!==JSON.stringify(data.images[0])||JSON.stringify(t.images.at(-1))!==JSON.stringify(r.images[0])||t.energies.at(-1)!==r.energies[0])
      throw Error('MD軌跡の時刻・構造・エネルギーが一致しません。');
  }
  function thermalValues(t,i){
    const values={step:t.stepNumbers[i],timeFs:t.timeFs[i],temperatureK:t.temperatureK[i],
      potentialEnergyEV:t.energies[i],kineticEnergyEV:t.kineticEV[i],totalEnergyEV:t.totalEV[i]};
    if(t.pressureBar){values.pressureBar=t.pressureBar[i];values.volumeA3=t.volumeA3[i];}
    return values;
  }
  function showResult(r,data){
    const md=r.mode==='md';
    $('mdResult').hidden=!md;$('engineEnergyDetails').hidden=$('engineConvergenceHelp').hidden=md;
    $('engineApply').textContent=md?'最終構造を適用':'結果を構造へ適用';
    if(!md)return;
    const t=r.trajectory,i=t.energies.length-1,last=thermalValues(t,i), settings=data.md;
    const summary=[numberText(last.timeFs)+' fs',t.images.length+'保存フレーム','最終温度 '+numberText(last.temperatureK)+' K'];
    if(settings.ensemble==='nve')summary.push('全エネルギーの始点との差 '+numberText(last.totalEnergyEV-t.totalEV[0])+' eV');
    else summary.push('目標温度 '+numberText(settings.temperatureK)+' K');
    if(t.pressureBar){
      summary.push('最終体積 '+numberText(last.volumeA3)+' Å³','最終瞬間圧力 '+numberText(last.pressureBar)+' bar');
      if(t.timeFs.length>1){
        const duration=last.timeFs-t.timeFs[0];
        let mean=0;
        for(let i=1;i<t.timeFs.length;i++){
          const weight=(t.timeFs[i]-t.timeFs[i-1])/duration;
          mean+=weight*(0.5*t.pressureBar[i-1]+0.5*t.pressureBar[i]);
        }
        summary.push('保存区間の平均圧力（台形積分） '+numberText(mean)+' bar');
      }
    }
    if(settings.ensemble==='npt'){
      summary.push('目標圧力 '+numberText(settings.pressureBar)+' bar');
      if(Number.isInteger(r.volumeAttempts))summary.push('セル変更 '+r.volumeAccepted+' / '+r.volumeAttempts+'回採択');
    }
    $('mdEnergySummary').textContent=summary.join(' · ');
    $('mdThermoSummary').textContent=t.pressureBar?'時刻ごとのエネルギー・温度・体積・圧力':'時刻ごとのエネルギーと温度';
    $('mdVolumeHeading').hidden=$('mdPressureHeading').hidden=!t.pressureBar;
    $('mdApplyTrajectory').textContent=t.images.length>200?'再生するフレームを選ぶ':'軌跡を再生';
    const body=$('mdThermoRows');body.replaceChildren();
    t.energies.forEach((_,i)=>{
      const row=document.createElement('tr');
      const values=[t.stepNumbers[i],t.timeFs[i],t.temperatureK[i],t.energies[i],t.kineticEV[i],t.totalEV[i]];
      if(t.pressureBar)values.push(t.volumeA3[i],t.pressureBar[i]);
      for(const value of values){
        const td=document.createElement('td');td.textContent=numberText(value);row.append(td);
      }
      body.append(row);
    });
  }
  function progress(p,data){
    const parts=['MD',methodLabel(data.md),(p.step??0)+' / '+data.maxSteps+' ステップ'];
    for(const [key,unit] of [['timeFs','fs'],['temperatureK','K'],['volumeA3','Å³'],['pressureBar','bar']]){
      if(Number.isFinite(p[key]))parts.push(numberText(p[key])+' '+unit);
    }
    return parts.join(' · ');
  }
  function restorePreset(p){
    chosenThermostat=p.mdEnsemble!=='nve';
    $('mdThermostat').value=p.mdThermostat||'langevin';
    $('mdRecordPressure').checked=!!p.mdRecordPressure;
  }
  function init(){
    $('mdThermostat').addEventListener('input',()=>{chosenThermostat=true;});
    $('mdSettings').addEventListener('input',sync);
    $('mdTopology').addEventListener('toggle',()=>{if($('mdTopology').open)sync();});
  }
  MV.MDUI={init,sync,input,restore,restorePreset,restoreFrame,validate,progress,thermalValues,showResult,methodLabel,formMethod};
})(window);
