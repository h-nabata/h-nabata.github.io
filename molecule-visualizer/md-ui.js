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
  function sync(){
    const active=$('engineMode').value==='md';
    $('mdSettings').hidden=!active;
    if(!active)return;
    const state=MV.App.getState(), nvt=$('mdEnsemble').value==='nvt', explicit=$('mdVelocitySource').value==='explicit';
    const single=state.atoms.length===1, rdkit=MV.EngineUI.getConnection()?.info?.engine==='rdkit';
    $('mdTemperatureLabel').textContent=nvt?(explicit?'熱浴温度 (K)':'初期温度・熱浴温度 (K)'):'初期温度 (K)';
    $('mdTemperature').closest('label').hidden=explicit&&!nvt;
    $('mdSeed').closest('label').hidden=explicit&&!nvt;
    $('mdVelocityHelp').textContent=(explicit?'入力した速度から開始します。重心の並進運動を除く設定では、全原子の速度から重心速度を差し引きます。':'初期速度はMaxwell–Boltzmann分布から生成します。別の初期速度で比較するにはシードを変更します。')+(single?' 単原子では重心の並進運動を残します。':'');
    $('mdRemoveCOM').disabled=single;
    $('mdVelocitiesLabel').hidden=!explicit;
    $('mdFrictionLabel').hidden=!nvt;
    $('mdForceFieldSettings').hidden=!rdkit;
    const steps=Number($('mdSteps').value),dt=Number($('mdTimestep').value),stride=Number($('mdStride').value);
    $('mdPlan').textContent=steps>0&&dt>0&&stride>0?'計算時間 '+numberText(steps*dt)+' fs · 初期構造と最終構造を含め '+(1+Math.ceil(steps/stride))+' フレームを保存':'';
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
    if(!['nve','nvt'].includes(ensemble))throw Error('アンサンブルを選択してください。');
    const md={ensemble, timestepFs:tv,temperatureK:explicit&&ensemble==='nve'?0:number('mdTemperature','温度 (K)',0,10000),
      seed:explicit&&ensemble==='nve'?0:number('mdSeed','乱数シード',0,4294967295,true),
      sampleEvery:number('mdStride','軌跡の保存間隔',1,100000,true), removeCOM:frame.atoms.length>1&&$('mdRemoveCOM').checked};
    if(ensemble==='nvt')md.frictionPerPs=number('mdFriction','摩擦係数 (ps⁻¹)',.001,1000);
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
    for(const [id,v] of Object.entries({mdSteps:data.maxSteps,mdEnsemble:md.ensemble,mdTimestep:md.timestepFs,mdTemperature:md.temperatureK,
      mdSeed:md.seed,mdStride:md.sampleEvery,mdFriction:md.frictionPerPs??10, mdForceField:data.forceField?.model||'MMFF94'}))$(id).value=v;
    $('mdRemoveCOM').checked=md.removeCOM;
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
  function validate(r,data){
    const t=r.trajectory, md=data.md;
    const settingKeys=['ensemble','timestepFs','sampleEvery','temperatureK','seed','frictionPerPs','removeCOM','massesAmu','initialVelocitiesAngstromPerFs'];
    const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    if(!t||!r.md||settingKeys.some(key=>!equal(r.md[key],md[key]))||
       ['model','bonds','formalCharges'].some(key=>!equal(r.forceField?.[key],data.forceField?.[key]))||
       r.units?.time!=='fs'||r.units?.temperature!=='K'||r.units?.velocity!=='angstrom/fs'||
       !Array.isArray(r.velocitiesAngstromPerFs)||r.velocitiesAngstromPerFs.length!==r.symbols.length||
       r.velocitiesAngstromPerFs.some(row=>!Array.isArray(row)||row.length!==3||!row.every(Number.isFinite))||
       !Number.isInteger(r.steps)||r.steps<0||r.steps>data.maxSteps||r.reason==='completed'&&r.steps!==data.maxSteps)
      throw Error('MDの計算条件・ステップ数が入力と一致しません。');
    MV.Trajectory.validate({...t,kind:'md',symbols:r.symbols});
    if(!['energies','timeFs','kineticEV','totalEV','temperatureK'].every(k=>Array.isArray(t[k])&&t[k].length===t.images.length&&t[k].every(Number.isFinite))||
       !Array.isArray(t.stepNumbers)||t.stepNumbers[0]!==0||t.stepNumbers.at(-1)!==r.steps||
       t.stepNumbers.some((v,i)=>i>0&&v<=t.stepNumbers[i-1]||Math.abs(t.timeFs[i]-v*md.timestepFs)>1e-7||
         t.kineticEV[i]<0||t.temperatureK[i]<0||Math.abs(t.totalEV[i]-t.energies[i]-t.kineticEV[i])>1e-6)||
       JSON.stringify(t.images[0])!==JSON.stringify(data.images[0])||JSON.stringify(t.images.at(-1))!==JSON.stringify(r.images[0])||t.energies.at(-1)!==r.energies[0])
      throw Error('MD軌跡の時刻・構造・エネルギーが一致しません。');
  }
  function thermalValues(t,i){return {step:t.stepNumbers[i],timeFs:t.timeFs[i],temperatureK:t.temperatureK[i],
    potentialEnergyEV:t.energies[i],kineticEnergyEV:t.kineticEV[i],totalEnergyEV:t.totalEV[i]};}
  function showResult(r,data){
    const md=r.mode==='md';
    $('mdResult').hidden=!md;$('engineEnergyDetails').hidden=$('engineConvergenceHelp').hidden=md;
    $('engineApply').textContent=md?'最終構造を適用':'結果を構造へ適用';
    if(!md)return;
    const t=r.trajectory,i=t.energies.length-1,last=thermalValues(t,i);
    $('mdEnergySummary').textContent=numberText(last.timeFs)+' fs · '+t.images.length+'保存フレーム · 最終温度 '+numberText(last.temperatureK)+' K · 全エネルギーの始点との差 '+numberText(last.totalEnergyEV-t.totalEV[0])+' eV';
    $('mdApplyTrajectory').textContent=t.images.length>200?'再生するフレームを選ぶ':'軌跡を再生';
    const body=$('mdThermoRows');body.replaceChildren();
    t.energies.forEach((_,i)=>{
      const row=document.createElement('tr');
      for(const value of [t.stepNumbers[i],t.timeFs[i],t.temperatureK[i],t.energies[i],t.kineticEV[i],t.totalEV[i]]){
        const td=document.createElement('td');td.textContent=numberText(value);row.append(td);
      }
      body.append(row);
    });
  }
  function progress(p,data){
    return 'MD · '+data.md.ensemble.toUpperCase()+' · '+(p.step??0)+' / '+data.maxSteps+' ステップ'+
      (Number.isFinite(p.timeFs)?' · '+numberText(p.timeFs)+' fs':'')+(Number.isFinite(p.temperatureK)?' · '+numberText(p.temperatureK)+' K':'');
  }
  function init(){
    $('mdSettings').addEventListener('input',sync);
    $('mdTopology').addEventListener('toggle',()=>{if($('mdTopology').open)sync();});
  }
  MV.MDUI={init,sync,input,restore,restoreFrame,validate,progress,thermalValues,showResult};
})(window);
