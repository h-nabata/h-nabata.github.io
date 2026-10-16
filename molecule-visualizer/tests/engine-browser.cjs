const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',[path.join(root,'local-engine/bridge.py'),'--engine','tblite','--port','8766','--allow-origin','http://127.0.0.1:8765','--site-dir',root],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let output='',stderr='',browser;
 engine.stderr.on('data',d=>stderr+=d);
 const token=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Bridge did not start: '+stderr)),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timeout);reject(Error('Bridge exited '+code+': '+stderr));});});
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:8765'});
  let downloads=0;page.on('download',()=>downloads++);
  const showText=async(button)=>{
    const before=downloads;await page.click(button);assert.equal(downloads,before,'display must not trigger a download');
    const field=page.locator('#trajectoryText'),text=await field.inputValue();assert.ok(text.length);assert.equal(await field.getAttribute('readonly'),'');
    await field.focus();await field.press('Control+a');assert.deepEqual(await field.evaluate(e=>[e.selectionStart,e.selectionEnd]),[0,text.length]);
    await field.press('Control+c');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),text);
    return text;
  };
  const spin=async(id,start,next)=>{const input=page.locator('#'+id);await input.fill(start);await input.press('ArrowUp');assert.equal(await input.inputValue(),next);await input.press('ArrowDown');assert.equal(await input.inputValue(),start);};
  const saveXYZ=async(button,expected,indices)=>{
    const displayed=await showText(button==='#trajectorySaveAll'?'#trajectoryShowAll':'#trajectoryShowSelected');
    const pending=page.waitForEvent('download');await page.click(button);const file=await pending;
    const text=fs.readFileSync(await file.path(),'utf8');assert.ok(!text.includes(token));assert.equal(text,displayed);
    const lines=text.trimEnd().split('\n'),parsed=[];let row=0;
    while(row<lines.length){const n=Number(lines[row++]),comment=lines[row++],atoms=[];for(let a=0;a<n;a++){const [symbol,...pos]=lines[row++].trim().split(/\s+/);atoms.push({symbol,pos:pos.map(Number)});}parsed.push({comment,atoms});}
    if(indices)assert.equal(parsed.length,indices.length);
    const ids=parsed.map(f=>Number(f.comment.match(/source_frame=(\d+)/)[1])-1);
    if(indices)assert.deepEqual(ids,indices);assert.ok(ids.every((id,i)=>!i||id>ids[i-1]));
    parsed.forEach((f,k)=>f.atoms.forEach((a,i)=>{assert.equal(a.symbol,expected.symbols[i]);a.pos.forEach((x,j)=>assert.ok(Math.abs(x-expected.images[ids[k]][i][j])<1e-10));}));
    return {parsed,ids};
  };
  const before=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));
  const saveLUP=async(button,expected,indices)=>{
    const displayed=await showText(button==='#trajectorySaveAll'?'#trajectoryShowAll':'#trajectoryShowSelected');
    const filename=await page.locator('#trajectoryFilename').textContent();assert.match(filename,/_infile\.log$/);
    const pending=page.waitForEvent('download');await page.click(button);const file=await pending;
    assert.equal(file.suggestedFilename(),filename);
    const text=fs.readFileSync(await file.path(),'utf8'),blocks=text.trimEnd().split('\n--\n');assert.ok(!text.includes(token));assert.equal(text,displayed);assert.equal(blocks.length,indices.length);
    blocks.forEach((block,k)=>{
      const rows=block.split('\n');assert.equal(rows.shift(),`# NODE ${k}`);assert.equal(rows.length,expected.symbols.length);
      rows.forEach((row,i)=>{const [symbol,...pos]=row.split(/\s+/);assert.equal(symbol,expected.symbols[i]);assert.equal(pos.length,3);pos.forEach((x,j)=>assert.ok(Math.abs(Number(x)-expected.images[indices[k]][i][j])<1e-10));});
    });
  };
  const previewRequests=[],jobRequests=[];page.on('request',r=>{if(r.url().includes('?preview=1'))previewRequests.push(r.url());if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))jobRequests.push(r.url());});
  assert.equal(await page.locator('#engineLive').isChecked(),false);assert.equal(await page.locator('#afirLive').isChecked(),false);
  await page.click('#btnExternalEngine');await page.fill('#engineURL','http://127.0.0.1:8766');await page.fill('#engineToken','incorrect');await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineMessage').textContent.includes('トークンが一致'));
  await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  await page.selectOption('#engineMode','neb');
  await spin('engineFmax','0.3','0.31');await spin('engineMove','0.04','0.05');await spin('engineSpring','0.1','0.2');
  await page.fill('#engineFmax','0.00001');await page.locator('#engineFmax').press('Tab');assert.equal(await page.locator('#engineFmax').inputValue(),'0.00001');
  await page.selectOption('#engineMode','evaluate');await page.selectOption('#engineScope','current');await page.click('#engineRun');await page.waitForSelector('#engineResult:not([hidden])');
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before,'review must not modify coordinates');
  assert.equal(await page.locator('#engineEnergyRows tr').count(),1);assert.match(await page.locator('#engineResultSummary').textContent(),/評価完了/);
  const download=page.waitForEvent('download');await page.click('#engineDownload');const file=await download,report=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.ok(!JSON.stringify(report).includes(token));assert.equal(report.result.units.energy,'eV');
  await page.screenshot({path:'test-artifacts/engine-energy.png'});
  await page.click('#engineApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.externalCalculation.engine),'tblite');await page.click('#btnUndo');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.externalCalculation),undefined);
  // Stale result never overwrites an edit made after the input snapshot.
  await page.click('#btnExternalEngine');await page.click('#engineRun');await page.waitForSelector('#engineResult:not([hidden])');
  await page.evaluate(()=>MoleculeVisualizer.App.change('stale edit',s=>{s.atoms[0].x+=.01;return s;}));await page.click('#engineApply');assert.match(await page.locator('#engineMessage').textContent(),/変更されています/);await page.click('#engineClose');await page.click('#btnUndo');await page.click('#dataReset');
  // AFIR: pick on canvas, add three groups / two pairs, run a real local potential.
  await page.click('#btnExternalEngine');await page.selectOption('#engineMode','optimize');
  await page.fill('#engineFmax','0');await page.click('#engineRun');assert.match(await page.locator('#engineMessage').textContent(),/fmaxは/);
  await page.fill('#engineFmax','10');
  await page.fill('#engineSteps','10001');await page.click('#engineRun');assert.match(await page.locator('#engineMessage').textContent(),/maxStepsは1〜10000/);
  for(const steps of ['1500','10000']){
    await page.fill('#engineSteps',steps);await page.click('#engineRun');await page.waitForSelector('#engineResult:not([hidden])');
    const saved=page.waitForEvent('download');await page.click('#engineDownload');const file=await saved;
    const report=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.equal(report.input.maxSteps,Number(steps));assert.equal(report.input.mode,'optimize');assert.equal(report.result.converged,true);
  }
  // A real optimization retains every evaluated geometry even with live display off.
  await page.fill('#engineSteps','3');await page.fill('#engineFmax','0.00001');await page.click('#engineRun');await page.waitForSelector('#engineResult:not([hidden])');
  const optDownload=page.waitForEvent('download');await page.click('#engineDownload');const optFile=await optDownload,opt=JSON.parse(fs.readFileSync(await optFile.path(),'utf8'));
  assert.equal(opt.result.trajectory.images.length,4);assert.deepEqual(opt.result.trajectory.images[0],opt.input.images[0]);assert.deepEqual(opt.result.trajectory.images[3],opt.result.images[0]);
  await page.click('#engineXYZ');assert.match(await page.locator('#trajectorySummary').textContent(),/4構造/);
  const optExpected={symbols:opt.result.symbols,...opt.result.trajectory};await saveXYZ('#trajectorySaveAll',optExpected,[0,1,2,3]);
  await page.fill('#trajectoryCount','3');await saveXYZ('#trajectorySaveSelected',optExpected,[0,2,3]);
  await page.selectOption('#trajectoryMethod','distance');const picked=await saveXYZ('#trajectorySaveSelected',optExpected);assert.equal(picked.ids.length,3);assert.equal(picked.ids[0],0);assert.equal(picked.ids.at(-1),3);
  await page.fill('#trajectoryCount','5');assert.equal(await page.locator('#trajectorySaveSelected').isDisabled(),true);await page.fill('#trajectoryCount','3');
  await page.selectOption('#trajectoryFormat','lup');assert.equal(await page.locator('#trajectoryName').inputValue(),'Water');assert.equal(await page.locator('#trajectoryFilename').textContent(),'Water_infile.log');
  await page.fill('#trajectoryName','水/経路');assert.equal(await page.locator('#trajectoryFilename').textContent(),'水_経路_infile.log');await saveLUP('#trajectorySaveAll',optExpected,[0,1,2,3]);await saveLUP('#trajectorySaveSelected',optExpected,picked.ids);
  await page.selectOption('#trajectoryMethod','index');await saveLUP('#trajectorySaveSelected',optExpected,[0,2,3]);
  await page.screenshot({path:'test-artifacts/trajectory-export.png'});
  await page.click('#trajectoryClose');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  await page.click('#btnExternalEngine');await page.click('#engineProfile');assert.equal(await page.locator('#profileRange').getAttribute('max'),'3');
  await page.locator('#profileRange').focus();await page.locator('#profileRange').press('End');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().state.atoms.map(a=>[a.x,a.y,a.z])),opt.result.images[0]);
  await page.click('#profileRestore');await page.click('#profileDetails');
  assert.equal(await page.locator('#engineMode optgroup').getAttribute('label'),'単一構造の最適化（AFIR法を含む）');
  const jobsBefore=jobRequests.length;await page.selectOption('#engineMode','afir');
  assert.equal(await page.locator('#engineDialog').isVisible(),false);assert.equal(await page.locator('#afirPanel').isVisible(),true);
  assert.equal(await page.locator('#engineMode').inputValue(),'optimize');assert.equal(jobRequests.length,jobsBefore,'opening AFIR setup must not start a calculation');
  await spin('afirFmax','0.3','0.31');await spin('afirMove','0.04','0.05');await spin('afirGamma','100','101');
  for(let i=0;i<3;i++){
    const p=await page.evaluate(i=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===i+1);return {x:a.x,y:a.y};},i);
    await page.locator('canvas').click({position:p});await page.fill('#afirName','Group '+(i+1));await page.click('#afirAddFragment');
  }
  await page.selectOption('#afirA','f1');await page.selectOption('#afirB','f2');await page.fill('#afirGamma','40');await page.click('#afirAddPair');
  await page.selectOption('#afirA','f2');await page.selectOption('#afirB','f3');await page.selectOption('#afirMode','repel');await page.fill('#afirGamma','20');await page.click('#afirAddPair');
  const gamma=page.getByRole('spinbutton',{name:'ペア1のγ (kJ/mol)',exact:true});
  await gamma.press('ArrowUp');assert.equal(await gamma.inputValue(),'41');
  assert.equal(await gamma.evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('ArrowUp');assert.equal(await gamma.inputValue(),'42');
  await gamma.press('ArrowDown');await page.keyboard.press('ArrowDown');assert.equal(await gamma.inputValue(),'40');
  // Accept the new budget in a real job; a loose threshold ends this smoke test immediately.
  await page.fill('#afirSteps','10000');await page.fill('#afirFmax','10');await page.click('#afirRun');
  await page.waitForSelector('#afirResult:not([hidden])');
  const largeBudgetDownload=page.waitForEvent('download');await page.click('#afirDownload');
  const largeBudgetFile=await largeBudgetDownload,largeBudget=JSON.parse(fs.readFileSync(await largeBudgetFile.path(),'utf8'));
  assert.equal(largeBudget.input.config.maxSteps,10000);assert.equal(largeBudget.result.converged,true);
  await page.fill('#afirSteps','3');await page.fill('#afirFmax','0.00001');await page.fill('#afirMove','0.02');await page.click('#afirRun');
  await page.waitForSelector('#afirResult:not([hidden])');assert.match(await page.locator('#afirResultSummary').textContent(),/3ステップ/);
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  const afirDownload=page.waitForEvent('download');await page.click('#afirDownload');const afirFile=await afirDownload;
  const afir=JSON.parse(fs.readFileSync(await afirFile.path(),'utf8'));assert.equal(afir.input.config.maxSteps,3);assert.equal(afir.result.images.length,4);assert.equal(afir.result.validation,'biased-trajectory-not-ts');assert.ok(!JSON.stringify(afir).includes(token));
  await page.click('#afirXYZ');await saveXYZ('#trajectorySaveAll',afir.result,[0,1,2,3]);
  await page.fill('#trajectoryCount','3');await page.selectOption('#trajectoryMethod','distance');const afirPicked=await saveXYZ('#trajectorySaveSelected',afir.result);
  await page.selectOption('#trajectoryFormat','lup');assert.equal(await page.locator('#trajectoryFilename').textContent(),'Water_infile.log');await saveLUP('#trajectorySaveAll',afir.result,[0,1,2,3]);await saveLUP('#trajectorySaveSelected',afir.result,afirPicked.ids);
  assert.equal(afirPicked.ids.length,3);assert.equal(afirPicked.ids[0],0);assert.equal(afirPicked.ids.at(-1),3);
  assert.ok(afirPicked.ids.includes(afir.result.energies.indexOf(Math.max(...afir.result.energies))),'raw physical maximum must survive AFIR extraction');
  for(const f of afirPicked.parsed)assert.match(f.comment,/bias_eV=.*biased_energy_eV=/);
  await page.click('#trajectoryClose');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  assert.equal(previewRequests.length,0,'live display must make no preview requests by default');
  // Use the actual AFIR result as an extracted animation and then as a real NEB job.
  await page.click('#afirXYZ');await page.fill('#trajectoryCount','3');await page.selectOption('#trajectoryMethod','distance');
  await page.click('#trajectoryApply');assert.match(await page.locator('#framePlay').textContent(),/停止/);
  await page.locator('#frameRange').focus();await page.locator('#frameRange').press('Home');
  const extracted=await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory);
  assert.deepEqual(extracted.map(f=>f.metadata.trajectoryExtraction.sourceFrame),afirPicked.ids);
  for(let k=0;k<extracted.length;k++){
    assert.deepEqual(extracted[k].atoms.map(a=>[a.x,a.y,a.z]),afir.result.images[afirPicked.ids[k]]);
    assert.deepEqual(extracted[k].atoms.map(a=>a.id),afir.result.atomIds);
    assert.equal(extracted[k].metadata.totalCharge,afir.result.charge);assert.equal(extracted[k].metadata.multiplicity,afir.result.multiplicity);
  }
  await page.click('#frameNext');assert.equal(await page.locator('#profileRange').inputValue(),'1');
  assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().state.atoms.map(a=>[a.x,a.y,a.z])),afir.result.images[afirPicked.ids[1]]);
  await page.screenshot({path:'test-artifacts/extracted-playback.png'});
  await page.click('#btnUndo');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  await page.click('#afirXYZ');await page.fill('#trajectoryCount','3');await page.selectOption('#trajectoryMethod','distance');
  let submitted=[];const record=req=>{if(req.method()==='POST'&&req.url().endsWith('/api/jobs'))submitted.push(req.postDataJSON());};page.on('request',record);
  await page.click('#trajectoryNEB');assert.equal(await page.locator('#engineDialog').isVisible(),true);assert.equal(await page.locator('#engineMode').inputValue(),'neb');assert.equal(await page.locator('#engineScope').inputValue(),'all');
  assert.equal(await page.locator('#engineCharge').inputValue(),String(afir.result.charge));assert.equal(await page.locator('#engineMultiplicity').inputValue(),String(afir.result.multiplicity));assert.equal(submitted.length,0,'NEB import must not start calculation');
  await page.fill('#engineSteps','1');await page.fill('#engineFmax','0.00001');await page.click('#engineRun');await page.waitForSelector('#engineResult:not([hidden])');
  assert.equal(submitted.length,1);assert.equal(submitted[0].mode,'neb');assert.equal(submitted[0].maxSteps,1);assert.equal(submitted[0].fmax,.00001);assert.equal(submitted[0].afir,undefined);
  assert.deepEqual(submitted[0].images,afirPicked.ids.map(i=>afir.result.images[i]));
  const nebFilePending=page.waitForEvent('download');await page.click('#engineDownload');const nebReport=JSON.parse(fs.readFileSync(await(await nebFilePending).path(),'utf8'));assert.equal(nebReport.result.mode,'neb');assert.equal(nebReport.result.images.length,3);assert.notEqual(nebReport.result.reason,'failed');
  page.off('request',record);await page.click('#engineClose');await page.click('#btnUndo');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  await page.click('#afirProfile');
  const viewBox=await page.locator('#viewer').boundingBox(),plotBox=await page.locator('#profilePanel').boundingBox();
  assert.ok(plotBox.y+plotBox.height-viewBox.y<page.viewportSize().height-100,'structure and graph fit together in the viewport');
  await page.locator('#energyProfile circle[tabindex="0"]').nth(2).focus();
  assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().state.atoms.map(a=>[a.x,a.y,a.z])),afir.result.images[2]);
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  assert.equal(await page.locator('#profilePreview').isVisible(),true);
  // Both series start at zero; hover the upper, visible circle at that position.
  await page.locator('#energyProfile circle[tabindex="-1"]').first().hover();
  await page.locator('#energyProfile').hover({position:{x:20,y:70}});await page.locator('#profileRange').hover({position:{x:8,y:8}});
  assert.equal(await page.locator('#profileRange').inputValue(),'2','hover must not change the selected frame');
  assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().state.atoms.map(a=>[a.x,a.y,a.z])),afir.result.images[2]);
  const slider=await page.locator('#profileRange').boundingBox(),thumb=slider.x+8+(slider.width-16)*2/3;
  await page.mouse.move(thumb,slider.y+slider.height/2);await page.mouse.down({button:'left'});
  await page.mouse.move(slider.x+slider.width-8,slider.y+slider.height/2,{steps:5});await page.mouse.up({button:'left'});
  assert.equal(await page.locator('#profileRange').inputValue(),'3');
  assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().state.atoms.map(a=>[a.x,a.y,a.z])),afir.result.images[3]);
  await page.mouse.move(slider.x+8,slider.y+slider.height/2);assert.equal(await page.locator('#profileRange').inputValue(),'3','released drag must stop following the cursor');
  await page.click('#profileToggle');assert.equal(await page.locator('#profilePanel').isVisible(),false);assert.equal(await page.locator('#profileToggle').getAttribute('aria-expanded'),'false');
  assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().previewOnly),false);
  await page.click('#profileToggle');assert.equal(await page.locator('#profilePanel').isVisible(),true);assert.equal(await page.locator('#profileRange').inputValue(),'3');
  await page.locator('canvas').focus();await page.locator('canvas').press('ArrowRight');
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before,'preview keyboard must not edit input');
  await page.click('#profileRestore');
  assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().previewOnly),false);
  // Replay a completed real calculation's first two checkpoints as an in-flight
  // response, making the live UI check deterministic even on very fast CPUs.
  let delivered=false;
  await page.route(/\/api\/jobs\/[a-f0-9]{32}\?preview=1&after=\d+$/,async route=>{
    const response=await route.fetch(),body=await response.json();
    if(!delivered&&body.status==='completed'){
      delivered=true;const r=body.result;
      await route.fulfill({json:{id:body.id,status:'running',progress:{step:1},preview:{mode:'afir',from:0,next:2,energies:r.energies.slice(0,2),biasEnergies:r.biasEnergies.slice(0,2),positions:r.images[1]}}});
    }else {if(body.status==='running'&&body.preview)delivered=true;await route.fulfill({response});}
  });
  await page.check('#afirLive');await page.click('#afirRun');
  await page.waitForFunction(()=>document.getElementById('profileTitle').textContent.includes('計算中（評価済み')&&!document.getElementById('profilePreview').hidden);
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  await page.waitForSelector('#afirResult:not([hidden])');
  assert.ok(delivered);assert.ok(previewRequests.length>=2);
  await page.unroute(/\/api\/jobs\/[a-f0-9]{32}\?preview=1&after=\d+$/);
  await page.click('#afirApply');assert.match(await page.locator('#framePlay').textContent(),/停止/);
  assert.ok(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.frameIndex)>0,'apply-and-play advances immediately');
  await page.locator('#frameRange').focus();await page.locator('#frameRange').press('Home');
  await page.click('#frameNext');assert.match(await page.locator('#frameLabel').textContent(),/2 \/ 4/);
  assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().state.atoms.map(a=>[a.x,a.y,a.z])),await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory[1].atoms.map(a=>[a.x,a.y,a.z])));
  assert.equal(await page.locator('#profileRange').inputValue(),'1');
  await page.locator('#profileRange').focus();await page.locator('#profileRange').press('End');
  assert.match(await page.locator('#frameLabel').textContent(),/4 \/ 4/);
  await page.screenshot({path:'test-artifacts/afir.png',fullPage:true});await page.click('#btnUndo');await page.click('#afirClose');await page.click('#dataReset');
  // Actual fixed-cell path relaxation, final review, apply, navigation, export and Undo.
  const xyz=offset=>`3\npath Lattice="9 0 0 1 9 0 0 0 9" pbc="T T T"\nO 0 0 0\nH ${.96+offset} 0 0\nH -.24 .93 0\n`;
  await page.fill('#dataText',[0,.2,.4].map(xyz).join(''));await page.click('#dataApply');
  const source=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.trajectory));
  await page.click('#btnExternalEngine');await page.selectOption('#engineMode','perpendicular');await page.fill('#engineSteps','3');await page.fill('#engineFmax','0.00001');await page.click('#engineRun');await page.waitForSelector('#engineResult:not([hidden])');
  assert.equal(await page.locator('#engineEnergyRows tr').count(),3);assert.match(await page.locator('#engineResultSummary').textContent(),/接線方向の最大更新/);
  await page.screenshot({path:'test-artifacts/engine-path.png'});
  await page.click('#engineProfile');await page.locator('#energyProfile circle[tabindex="0"]').nth(1).focus();
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.trajectory)),source);
  assert.equal(await page.locator('#profilePreview').isVisible(),true);
  await page.click('#profileDetails');
  await page.click('#engineApply');const after=await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory);const initial=JSON.parse(source),positions=f=>f.atoms.map(a=>[a.x,a.y,a.z]);
  assert.deepEqual(positions(after[0]),positions(initial[0]));assert.deepEqual(positions(after[2]),positions(initial[2]));assert.notDeepEqual(positions(after[1]),positions(initial[1]));assert.deepEqual(after[1].metadata.cell,initial[1].metadata.cell);
  await page.evaluate(()=>MoleculeVisualizer.Studio.frame(1));assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.externalCalculation.mode),'perpendicular');assert.equal((await page.evaluate(()=>MoleculeVisualizer.Studio.allXYZ())).match(/\nO /g).length,3);
  await page.click('#btnUndo');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.trajectory)),source);
  // NEB and CI-NEB export the final path, including endpoints, rather than optimizer iterations.
  for(const mode of ['neb','cineb']){
    await page.click('#btnExternalEngine');await page.selectOption('#engineMode',mode);await page.fill('#engineSteps','3');
    if(mode==='cineb')await page.fill('#engineClimb','1');
    await page.click('#engineRun');await page.waitForSelector('#engineResult:not([hidden])');
    const pending=page.waitForEvent('download');await page.click('#engineDownload');const file=await pending,report=JSON.parse(fs.readFileSync(await file.path(),'utf8'));
    assert.equal(report.result.mode,mode);assert.equal(report.result.images.length,3);assert.notDeepEqual(report.result.images[1],report.input.images[1]);
    if(mode==='cineb'){assert.equal(report.input.climbAfter,1);assert.equal(report.result.climbingImage,1);}
    await page.click('#engineProfile');await page.click('#profileXYZ');await page.selectOption('#trajectoryFormat','lup');
    assert.equal(await page.locator('#trajectoryCellNotice').isVisible(),true);await saveLUP('#trajectorySaveAll',report.result,[0,1,2]);
    await page.fill('#trajectoryCount','2');await saveLUP('#trajectorySaveSelected',report.result,[0,2]);
    await page.selectOption('#trajectoryMethod','distance');await saveLUP('#trajectorySaveSelected',report.result,[0,2]);
    await page.selectOption('#trajectoryFormat','xyz');await saveXYZ('#trajectorySaveAll',report.result,[0,1,2]);
    await page.click('#trajectoryClose');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.trajectory)),source);
  }
  // Generic two-carbon geometry exercises visible bond formation and cleavage.
  await page.evaluate(()=>{
    const MV=MoleculeVisualizer,s=MV.IO.parseXYZToState('C 0 0 0\nC 3 0 0'),base=MV.Periodic.snapshot(s),images=[3,1.4,3].map(x=>[[0,0,0],[x,0,0]]);
    MV.App.change('bond display fixture',()=>s,true);
    MV.EnergyProfile.set({title:'Bond display check',kind:'afir',energies:[0,-1,0],base:()=>base,positions:i=>images[i]});
    const frames=images.map(pos=>{const f=MV.Model.createState(base);f.atoms.forEach((a,i)=>[a.x,a.y,a.z]=pos[i]);return MV.Periodic.snapshot(f);});
    s.metadata.trajectory=frames;MV.EnergyProfile.select(1);
  });
  assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedBonds.length),1);assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().bonds.length),0);
  await page.locator('#profileRange').focus();await page.locator('#profileRange').press('End');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedBonds.length),0);
  await page.click('#profileRestore');await page.evaluate(()=>MoleculeVisualizer.Studio.play());
  assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedBonds.length),1);await page.evaluate(()=>MoleculeVisualizer.Studio.stop());
  await page.click('#frameNext');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedBonds.length),0);
  // Local UI fallback is served without Jekyll front matter and works at mobile width.
  const local=await browser.newPage({viewport:{width:390,height:844}});await local.goto('http://127.0.0.1:8766/');await local.waitForSelector('canvas');await local.click('#btnExternalEngine');assert.equal(await local.locator('#engineURL').inputValue(),'http://127.0.0.1:8766');
  await local.fill('#engineToken',token);await local.click('#engineConnect');await local.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  const dimensions=await local.locator('#engineDialog').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.client+2,'dialog must fit mobile width');await local.screenshot({path:'test-artifacts/engine-mobile.png'});
  await local.click('#engineRun');await local.waitForSelector('#engineResult:not([hidden])');await local.click('#engineXYZ');
  await local.selectOption('#trajectoryFormat','lup');
  await local.click('#trajectoryShowAll');assert.match(await local.locator('#trajectoryText').inputValue(),/^# NODE 0\n/);
  await local.click('#trajectorySelectText');const selectedText=await local.locator('#trajectoryText').evaluate(e=>[e.selectionStart,e.selectionEnd,e.value.length]);assert.deepEqual(selectedText,[0,selectedText[2],selectedText[2]]);
  const exportDimensions=await local.locator('#trajectoryDialog').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert.ok(exportDimensions.scroll<=exportDimensions.client+2,'XYZ export dialog must fit mobile width');
  assert.equal(await local.locator('#trajectoryCount').inputValue(),'1');await local.screenshot({path:'test-artifacts/trajectory-mobile.png'});
  await local.click('#trajectoryClose');
  // A synthetic noisy profile isolates smoothing and peak selection from chemistry.
  const noisySource=()=>{
    const MV=MoleculeVisualizer,base=MV.Periodic.snapshot(MV.App.getState()),energies=[0,1,.9,2,1.9,3,2.9,2,1.9,1,0];
    MV.TrajectoryUI.open({title:'平滑化の操作確認（人工データ）',kind:'afir',symbols:base.atoms.map(a=>a.element),energies,images:energies.map((_,i)=>base.atoms.map(a=>[a.x+i*.01,a.y,a.z])),base:()=>base,charge:0,multiplicity:1});
  };
  await local.evaluate(noisySource);await local.fill('#trajectoryCount','4');await local.fill('#trajectorySmooth','3');
  assert.match(await local.locator('#trajectorySelection').textContent(),/最高点: 6番/);assert.match(await local.locator('#trajectorySelection').textContent(),/極大点: 1\/1/);
  const afirDimensions=await local.locator('#trajectoryDialog').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert.ok(afirDimensions.scroll<=afirDimensions.client+2);
  await local.screenshot({path:'test-artifacts/peak-extraction-mobile.png'});await page.evaluate(noisySource);await page.fill('#trajectoryCount','4');await page.fill('#trajectorySmooth','3');await page.screenshot({path:'test-artifacts/peak-extraction.png'});
  // Tokens do not enter autosave.
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));assert.ok(!storage.includes(token));assert.deepEqual(errors,[]);console.log('External engine browser integration passed');
 }finally{if(browser)await browser.close();engine.kill('SIGINT');await new Promise(resolve=>{if(engine.exitCode!==null)return resolve();engine.on('exit',resolve);setTimeout(()=>{engine.kill('SIGKILL');resolve();},5000).unref();});}
})().catch(error=>{console.error(error);process.exitCode=1;});
