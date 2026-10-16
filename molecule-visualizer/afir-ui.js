/* Fragment editing never sends coordinates. Calculations require an explicit run. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id),app=()=>MV.App;
  let ready=false,visible=false,lastConfig='',lastAtoms='',lastLists='',result=null,job=null,pairInputs=[];
  const settingsFields=[['afirCharge','charge'],['afirMultiplicity','multiplicity'],['afirSteps','maxSteps'],['afirFmax','fmax'],['afirMove','maxMove']];
  const config=()=>{
    const c=app().getState().metadata.afir||MV.AFIR.defaults();
    if(c.schema!=='molecule-afir/1'||!Array.isArray(c.fragments)||!Array.isArray(c.pairs)||c.fragments.some(f=>!f||typeof f.label!=='string'||!Array.isArray(f.atomIds))||c.pairs.some(p=>!p))throw Error('保存されたAFIR設定の形式が不正です。AFIR設定を初期化して指定し直してください。');
    return c;
  };
  const message=text=>{$('afirStatus').textContent=text;};
  const fingerprint=s=>JSON.stringify([s.atoms,s.bonds,s.metadata]);
  const dirty=()=>/未適用|編集中/.test($('xyzEditStatus').textContent);
  function button(text,handler){const b=document.createElement('button');b.className='mv-btn';b.textContent=text;b.type='button';b.addEventListener('click',()=>safe(handler));return b;}
  function safe(f){try{return f();}catch(e){message(e.message);}}
  function edit(f){if(job)throw Error('計算中はAFIR設定を変更できません。');if(dirty())throw Error('編集中の座標を適用するか、編集を取り消してください。');app().change('AFIR settings',s=>{s.metadata.afir=JSON.parse(JSON.stringify(s.metadata.afir||MV.AFIR.defaults()));f(s.metadata.afir,s);});}
  function selected(){const s=app().getState(),ids=s.atoms.filter(a=>s.selectedAtomIds.has(a.id)).map(a=>a.id);if(!ids.length)throw Error('描画エリアで原子を選択してください。');return ids;}
  function selectGroup(f){const s=app().getState();s.selectedAtomIds=new Set(f.atomIds.filter(id=>s.atoms.some(a=>a.id===id)));s.selectedBondIds.clear();app().setState(s,true);}
  function addFragment(){const ids=selected(),label=$('afirName').value.trim();if(!label||label.length>40)throw Error('原子団の名前を1〜40文字で入力してください。');edit(c=>{if(c.fragments.length>=64)throw Error('フラグメント数の上限は64です。');let n=1;while(c.fragments.some(f=>f.id===`f${n}`))n++;c.fragments.push({id:`f${n}`,label,atomIds:ids});});$('afirName').value=`原子団${config().fragments.length+1}`;message(`${label}を登録しました。次の原子団を選択してください。`);$('btnClearSel').click();}
  function addPair(){
    try{
      const p={a:$('afirA').value,b:$('afirB').value,mode:$('afirMode').value,gamma:readNumber('afirGamma')};
      if(p.a&&p.a===p.b)throw Error('原子団AとBが同じです。原子団Bで別の原子団を選んでください。');
      edit((c,s)=>{c.pairs.push(p);MV.AFIR.validate(s.atoms,c,s.metadata.cell);});
      $('afirPairStatus').textContent='ペアを追加しました。下の一覧に表示されています。';
      message('人工力を適用するペアを追加しました。');
    }catch(e){$('afirPairStatus').textContent=`追加できません: ${e.message}`;message(e.message);}
  }
  function readNumber(id){const raw=String($(id).value).trim();if(raw==='')throw Error('数値を入力してください。');return Number(raw);}
  function saveSettings(){
    // Read the visible values at the action boundary, including unblurred inputs.
    const c=config(),next=JSON.parse(JSON.stringify(c));for(const [id,key] of settingsFields)next[key]=readNumber(id);
    pairInputs.forEach((input,i)=>{if(!String(input.value).trim())throw Error('ペアのγを入力してください。');next.pairs[i].gamma=Number(input.value);});
    MV.AFIR.validate(app().getState().atoms,next,app().getState().metadata.cell);
    if(JSON.stringify(next)!==JSON.stringify(c))edit(v=>Object.assign(v,next));
  }
  function fillSelect(id,groups,previous){const el=$(id);el.replaceChildren();for(const f of groups){const o=document.createElement('option');o.value=f.id;o.textContent=f.label;el.append(o);}el.value=groups.some(f=>f.id===previous)?previous:groups[0]?.id||'';}
  function redrawLists(c,s){
    const list=$('afirFragments');list.replaceChildren();
    c.fragments.forEach((f,i)=>{const row=document.createElement('div');row.className='mv-afir-item';row.style.borderLeftColor=MV.AFIR.palette[i%MV.AFIR.palette.length];
      const name=button(f.label,()=>selectGroup(f));name.title='この原子団を描画上で選択';const nums=document.createElement('span');nums.className='mv-afir-atoms';nums.textContent=f.atomIds.map(id=>{const n=s.atoms.findIndex(a=>a.id===id);return n<0?'削除済み':`${n+1}${s.atoms[n].element}`;}).join(', ');
      const replace=button('選択で置換',()=>{const ids=selected();edit(v=>{v.fragments.find(g=>g.id===f.id).atomIds=ids;});});
      replace.title='現在選択している原子でこの原子団を置き換える';
      const remove=button('削除',()=>edit(v=>{v.fragments=v.fragments.filter(g=>g.id!==f.id);v.pairs=v.pairs.filter(p=>p.a!==f.id&&p.b!==f.id);}));
      row.append(name,nums,replace,remove);list.append(row);
    });
    const a=$('afirA').value,b=$('afirB').value;fillSelect('afirA',c.fragments,a);
    // A native select already has f1 selected after the first fragment is added.
    // Preserve a distinct choice, but choose another group when B still equals A.
    const other=c.fragments.find(f=>f.id!==$('afirA').value);
    fillSelect('afirB',c.fragments,b!==$('afirA').value&&c.fragments.some(f=>f.id===b)?b:other?.id);
    pairHint();
    const pairs=$('afirPairs');pairs.replaceChildren();pairInputs=[];c.pairs.forEach((p,i)=>{
      const row=document.createElement('div');row.className='mv-afir-item';const label=document.createElement('span');label.className='mv-afir-pair-label';label.textContent=`${c.fragments.find(f=>f.id===p.a)?.label||'?'} ${p.mode==='attract'?'→←':'←→'} ${c.fragments.find(f=>f.id===p.b)?.label||'?'}`;
      const strength=document.createElement('label');strength.textContent='γ (kJ/mol) ';const input=document.createElement('input');input.type='number';input.min='0';input.max='1000';input.step='1';input.value=p.gamma;input.setAttribute('aria-label',`ペア${i+1}のγ (kJ/mol)`);input.addEventListener('change',()=>safe(()=>edit(v=>{if(!String(input.value).trim())throw Error('γを入力してください。');MV.AFIR.alphaFromGamma(Number(input.value));v.pairs[i].gamma=Number(input.value);})));strength.append(input);
      pairInputs.push(input);row.append(label,strength,button('削除',()=>edit(v=>{v.pairs.splice(i,1);})));pairs.append(row);
    });
  }
  function pairHint(){$('afirPairStatus').textContent=config().fragments.length<2?'原子団を2つ以上登録してください。':'A・Bに異なる原子団を選び、「ペアを追加」を押してください。同じ原子を両方に含めることはできません。';}
  function sync(){
    try{syncInternal();}catch(e){message(e.message);for(const id of ['afirRun','afirCheck','afirExport','afirAddPair','afirAddFragment'])$(id).disabled=true;}
  }
  function syncInternal(){
    if(!ready)return;const s=app().getState(),c=config();$('afirSelection').textContent=`選択中: ${s.selectedAtomIds.size}原子`;
    $('afirAddFragment').disabled=!!job||!s.selectedAtomIds.size;
    const serialized=JSON.stringify(c),atoms=JSON.stringify(s.atoms.map(a=>[a.id,a.element]));
    if(serialized!==lastConfig||atoms!==lastAtoms){
      // Updating gamma must not replace the focused input or interrupt held spinner arrows.
      const lists=JSON.stringify([c.fragments,c.pairs.map(({gamma,...pair})=>pair),atoms]);
      if(lists!==lastLists){redrawLists(c,s);lastLists=lists;}
      else pairInputs.forEach((input,i)=>{input.value=c.pairs[i].gamma;});
      for(const [id,key] of settingsFields)$(id).value=c[key];lastConfig=serialized;lastAtoms=atoms;
    }
    let valid=false;try{const preview=MV.AFIR.evaluate(s.atoms,c,s.metadata.cell);valid=true;$('afirPreview').textContent=preview.pairs.map((p,i)=>`ペア${i+1}: 加重距離 ${p.distanceA.toFixed(3)} Å · α ${p.alphaEV_A.toFixed(4)} eV/Å`).join('\n');}catch(e){$('afirPreview').textContent=e.message;}
    $('afirExport').disabled=!valid||!!job;$('afirCheck').disabled=!valid||!!job;$('afirAddPair').disabled=c.fragments.length<2||!!job;
    $('afirRun').disabled=!valid||!!job||!MV.AFIRRunner?.available();$('afirCancel').disabled=!job;
    const connection=MV.EngineUI?.getConnection?.();$('afirConnectionStatus').textContent=connection?`${connection.info.engine} / ${connection.info.method}`+(MV.AFIRRunner?.available()?' · AFIR対応':' · AFIRにはサービスの更新が必要です'):'未接続（設定・人工項の確認・入力保存は利用できます）';
    $('afirLive').disabled=!!job;$('afirSettings').disabled=!!job;$('afirFragmentSettings').disabled=!!job;
    if(result)$('afirApply').disabled=!!job||!!result.applied||fingerprint(s)!==result.fingerprint||dirty();
  }
  function toggle(value){visible=value??!visible;$('afirPanel').hidden=!visible;document.querySelector('.mv-inspector').classList.toggle('mv-afir-active',visible);$('btnAFIR').setAttribute('aria-pressed',String(visible));
    if(visible){$('toolSelect').click();$('multiSelect').checked=true;app().getState().viewSettings.afirOverlay=true;sync();}
    else app().getState().viewSettings.afirOverlay=false;
    MV.EnergyProfile?.restore();app().renderer().renderState(app().getState(),true);
  }
  function download(payload,name,type='application/json'){const text=typeof payload==='string'?payload:JSON.stringify(payload,null,2),url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportFiles(){if(dirty())throw Error('編集中の座標を先に適用してください。');saveSettings();const out=MV.AFIR.exportInput(app().getState(),config());download(out,'afir-input.json');message('原子ID・XYZ・フラグメント・ペア・Python用設定をJSONに保存しました。');}
  function check(){saveSettings();const s=app().getState(),b=MV.AFIR.evaluate(s.atoms,config(),s.metadata.cell);message(`人工項のみ評価: ${b.energyEV.toFixed(6)} eV。物理ポテンシャルのエネルギーではありません。座標は変更していません。`);}
  async function run(){
    if(job)return;let j;
    try{if(dirty())throw Error('編集中の座標を先に適用してください。');saveSettings();const s=app().getState();MV.AFIR.validate(s.atoms,config(),s.metadata.cell);
      j={original:MV.Model.cloneState(s),fingerprint:fingerprint(s),config:JSON.parse(JSON.stringify(config())),cancelled:false,livePreview:$('afirLive').checked,previewCursor:0,liveEnergies:[],liveBiases:[]};
      if(j.livePreview&&!MV.EngineUI.getConnection()?.info.livePreview)throw Error('ライブ表示を使うにはbridge.pyを更新・再接続してください。');
      MV.EnergyProfile.reset();job=j;result=null;$('afirResult').hidden=true;sync();
      if(j.livePreview)MV.EnergyProfile.begin(()=>$('afirCancel').click(),()=>toggle(true));
      const r=await MV.AFIRRunner.run(j,(text,p)=>{
        message(text);if(!p||!j.livePreview)return;
        try{
          if(p.mode!=='afir'||p.from!==j.previewCursor||!Number.isInteger(p.next)||p.next<=p.from||p.next>j.config.maxSteps+1||p.energies?.length!==p.next-p.from||p.biasEnergies?.length!==p.energies.length||[...p.energies,...p.biasEnergies].some(e=>!Number.isFinite(e))||!Array.isArray(p.positions)||p.positions.length!==j.original.atoms.length||p.positions.some(v=>!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)||Math.abs(x)>10000)))throw Error('進捗データの形式が不正です。');
          j.liveEnergies.push(...p.energies);j.liveBiases.push(...p.biasEnergies);j.previewCursor=p.next;
          const base=MV.Periodic.snapshot(j.original);
          MV.EnergyProfile.set({title:'AFIR · 計算中（評価済みの途中結果）',kind:'afir',energies:j.liveEnergies,biasEnergies:j.liveBiases,base:()=>base,positions:i=>i===p.next-1?p.positions:null},MV.EnergyProfile.following());
        }catch(e){j.livePreview=false;MV.EnergyProfile.restore();message(e.message+' ライブ表示を停止しました。計算は継続しています。');}
      });if(r){MV.AFIRRunner.validateResult(r,j);result={...j,result:r};showResult(r);}else {MV.EnergyProfile.restore();message('計算を中止しました。入力構造は保持しています。');}
    }catch(e){MV.EnergyProfile.restore();message(e.message);}finally{job=null;MV.EnergyProfile.finish();sync();}
  }
  function showResult(r){
    const reason={converged:'人工力下で収束',step_limit:'未収束（ステップ上限）',cancelled:'中止（途中までの構造列）',failed:'計算失敗（途中までの構造列）'}[r.reason]||'未検証';
    $('afirResult').hidden=false;$('afirResultSummary').textContent=`${r.engine} / ${r.method} · ${reason} · ${r.steps}ステップ · 最大有効力 ${r.effectiveFmax.toPrecision(4)} eV/Å`;
    showProfile(r,result,!!job?.livePreview&&MV.EnergyProfile.following());
    message(r.error?`計算失敗: ${r.error}。保存済みの途中経過を確認できます。`:'探索を終了しました。人工力下の構造列を保存・再生できます。');
  }
  function showProfile(r,j,follow=false){
    const base=MV.Periodic.snapshot(j.original);
    MV.EnergyProfile.set({title:'AFIR探索 · エネルギープロファイル',kind:'afir',details:()=>toggle(true),energies:r.energies,biasEnergies:r.biasEnergies,positions:i=>r.images[i],base:()=>base,exportXYZ:()=>exportXYZ(r,j)},follow);
    if(j.trajectory===app().getState().metadata.trajectory&&j.trajectory)MV.EnergyProfile.bindTrajectory(j.trajectory);
  }
  function exportXYZ(r,j){const base=MV.Periodic.snapshot(j.original);MV.TrajectoryUI.open({title:'AFIR探索',name:j.original.metadata.title,kind:'afir',symbols:r.symbols,atomIds:r.atomIds,cell:r.cell,images:r.images,energies:r.energies,biasEnergies:r.biasEnergies,charge:r.charge,multiplicity:r.multiplicity,engine:r.engine,method:r.method,base:()=>base});}
  function apply(){
    if(!result||dirty()||fingerprint(app().getState())!==result.fingerprint)throw Error('計算開始後に構造・設定が変わったため適用できません。結果JSONは保存できます。');
    const j=result,r=j.result;MV.AFIRRunner.validateResult(r,j);
    const base=MV.Periodic.snapshot(j.original);const frames=r.images.map((positions,i)=>{const s=MV.Model.createState(base);s.atoms.forEach((a,k)=>{[a.x,a.y,a.z]=positions[k];});s.metadata.afirCalculation={engine:r.engine,method:r.method,physicalEnergyEV:r.energies[i],biasEnergyEV:r.biasEnergies[i],step:i,validation:'biased-trajectory-not-ts',atomIds:r.atomIds};return MV.Periodic.snapshot(s);});
    const next=MV.Model.createState(frames[0]);MV.Bonding.refreshInferredBonds(next);next.metadata.trajectory=frames;next.metadata.frameIndex=0;next.viewSettings={...j.original.viewSettings,afirOverlay:visible};j.applied=true;j.trajectory=frames;app().change('AFIR trajectory',()=>next,true);$('dataReset').click();$('afirApply').disabled=true;showProfile(r,j);MV.Studio.play();message(frames.length>1?'構造列を適用し、FRAMESで再生しています。「戻す」で入力へ戻ります。推定結合は表示中の座標から更新します。手動指定の結合は保持します。':'評価済みの構造が1点のためアニメーションはありません。「戻す」で入力へ戻ります。');
  }
  function init(){
    ready=true;app().getState().viewSettings.afirOverlay=false;$('btnAFIR').addEventListener('click',()=>toggle());$('afirClose').addEventListener('click',()=>toggle(false));
    $('afirConnect').addEventListener('click',()=>$('btnExternalEngine').click());
    $('afirReset').addEventListener('click',()=>safe(()=>{if(job)throw Error('計算を中止してから初期化してください。');app().change('reset AFIR settings',s=>{s.metadata.afir=MV.AFIR.defaults();});message('AFIR設定を初期化しました。「戻す」で復元できます。');}));
    for(const [id,f] of [['afirAddFragment',addFragment],['afirAddPair',addPair],['afirExport',exportFiles],['afirCheck',check],['afirApply',apply]])$(id).addEventListener('click',()=>safe(f));
    for(const id of ['afirA','afirB','afirMode','afirGamma'])$(id).addEventListener('change',()=>safe(pairHint));
    $('afirGamma').addEventListener('input',()=>safe(()=>{$('afirAlpha').textContent=`α = ${MV.AFIR.alphaFromGamma(readNumber('afirGamma')).toFixed(4)} eV/Å`;}));
    for(const [id,key] of [['afirCharge','charge'],['afirMultiplicity','multiplicity'],['afirSteps','maxSteps'],['afirFmax','fmax'],['afirMove','maxMove']])$(id).addEventListener('change',()=>safe(()=>edit(c=>{c[key]=readNumber(id);})));
    $('afirRun').addEventListener('click',run);$('afirCancel').addEventListener('click',()=>{if(job){job.cancelled=true;MV.AFIRRunner?.cancel(job).catch(e=>message(e.message));}});
    $('afirProfile').addEventListener('click',()=>{if(result){showProfile(result.result,result);MV.EnergyProfile.reveal();}});
    $('afirDownload').addEventListener('click',()=>{if(result)download({schema:'molecule-afir-result/1',input:MV.AFIR.exportInput(result.original,result.config),result:result.result},'afir-result.json');});
    $('afirXYZ').addEventListener('click',()=>{if(result)exportXYZ(result.result,result);});
    sync();
  }
  MV.AFIRUI={init,sync,toggle,download,isBusy:()=>!!job};
})(window);
