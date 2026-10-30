/* Real tblite AMF calculations; synthetic H2, no molecular upload. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),history=fs.mkdtempSync(path.join(os.tmpdir(),'model-f-test-'));
 const engine=spawn(process.env.PYTHON||'python',[path.join(root,'local-engine/bridge.py'),'--engine','tblite','--port','8777','--history-dir',history,'--allow-origin','http://127.0.0.1:8765'],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let out='',err='',browser;engine.stderr.on('data',d=>err+=d);
 try{
  const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('bridge startup: '+err)),20000);engine.stdout.on('data',d=>{out+=d;const m=out.match(/Token: (\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('bridge exit '+code+': '+err));});});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],posted=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))posted.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  const load=async(lengths)=>{await page.locator('#fileInput').setInputFiles({name:'synthetic-h2.xyz',mimeType:'text/plain',buffer:Buffer.from(lengths.map(r=>`2\nSynthetic H2\nH 0 0 0\nH ${r} 0.1 0\n`).join(''))});await page.waitForFunction(lengths=>{const s=MoleculeVisualizer.App.getState();return s.atoms.length===2&&s.atoms[1].x===lengths[0]&&(lengths.length===1?!s.metadata.trajectory||s.metadata.trajectory.length===1:s.metadata.trajectory?.length===lengths.length);},lengths);};
  await load([1.2]);await page.click('#btnExternalEngine');await page.fill('#engineURL','http://127.0.0.1:8777');await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  await page.uncheck('#engineLive');await page.locator('#modelFSettings summary').click();await page.check('#modelFEnabled');await page.selectOption('#engineMode','optimize');await page.selectOption('#engineOptimizer','lbfgs');await page.fill('#engineSteps','3');await page.fill('#engineFmax','0.00001');
  await page.fill('#modelFAlpha','41.25');await page.locator('#modelFAlpha').focus();
  const done=async()=>{await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy(),null,{timeout:60000});assert.equal(await page.locator('#engineResult').isVisible(),true,await page.locator('#engineMessage').textContent());};
  await page.evaluate(()=>{if(document.activeElement.id!=='modelFAlpha')throw Error('lost input focus');document.getElementById('engineRun').click();});await done();
  assert.deepEqual(posted.at(-1).modelF,{model:'amf',surface:'lower',alphaKJMol:41.25,multiplicities:[1,3]});
  const download=async(selector)=>{const promise=page.waitForEvent('download');await page.click(selector);const file=await promise;return fs.readFileSync(await file.path(),'utf8');};
  const saved=JSON.parse(await download('#engineDownload'));assert.equal(saved.result.trajectory.images.length,4);assert.equal(saved.result.surfaceComponents.lowerEV[0],saved.result.energies[0]);assert.ok(!JSON.stringify(saved).includes(token));
  const csv=await download('#engineModelFResult button');assert.equal(csv.trim().split('\n').length,5);assert.match(csv,/state1EV,state2EV,gapEV,couplingEV,lowerEV,upperEV/);
  assert.equal(await page.locator('#engineModelFResult svg polyline').count(),4);await page.screenshot({path:'test-artifacts/model-f-minimum.png'});
  await page.click('#engineApply');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.modelF),saved.input.modelF);
  await page.click('#btnExport');const project=JSON.parse(await download('#btnSaveProject'));assert.deepEqual(project.metadata.externalCalculation.surfaceComponents,await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.externalCalculation.surfaceComponents));assert.deepEqual(project.metadata.modelF,saved.input.modelF);await page.locator('#exportDialog [data-close]').click();
  await page.click('#btnExternalEngine');assert.equal(await page.locator('#modelFAlpha').inputValue(),'41.25');
  // Save/load conditions without silently clearing AMF; the final edited field
  // stays focused when the actual run button is dispatched.
  await page.getByText('条件の保存・表示方法',{exact:true}).click();await page.fill('#optimizationPresetName','AMF H2');await page.click('#optimizationPresetSave');await page.uncheck('#modelFEnabled');await page.click('#optimizationPresetLoad');assert.equal(await page.locator('#modelFEnabled').isChecked(),true);
  // Thermochemistry is explicitly unsupported for mixed electronic surfaces.
  await page.selectOption('#engineMode','vibrations');await page.locator('#engineThermoSettings summary').click();await page.check('#thermoEnabled');let count=posted.length;await page.click('#engineRun');assert.equal(posted.length,count);assert.match(await page.locator('#engineMessage').textContent(),/熱化学/);await page.uncheck('#thermoEnabled');
  await page.click('#engineClose');await load([.85,1.3,2.0]);await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.trajectory?.length===3);await page.click('#btnExternalEngine');
  for(const [mode,surface] of [['cineb','lower'],['lup','upper']]){
   await page.selectOption('#engineMode',mode);await page.selectOption('#modelFSurface',surface);await page.fill('#engineSteps','2');await page.fill('#engineClimb','0');await page.fill('#modelFAlpha','30');await page.click('#engineRun');await done();
   const r=await page.evaluate(()=>MoleculeVisualizer.EngineUI.getResult().result);assert.equal(r.modelF.surface,surface);assert.deepEqual(r.images[0],posted.at(-1).images[0]);assert.deepEqual(r.images.at(-1),posted.at(-1).images.at(-1));assert.deepEqual(r.energies,r.surfaceComponents[surface+'EV']);
  }
  await page.click('#engineXYZ');const xyz=await download('#trajectorySaveAll');assert.match(xyz,/modelF=amf surface=upper/);assert.match(xyz,/couplingEV=/);await page.click('#trajectoryClose');
  // Reopen a real persisted job, then restart from its saved optimizer state.
  const restored=await page.evaluate(async()=>{const M=MoleculeVisualizer,c=M.EngineUI.getConnection(),listing=await M.EngineUI.request(c,'/api/jobs');const id=listing.jobs.find(j=>j.mode==='lup').id;const next=await M.EngineUI.request(c,`/api/jobs/${id}/resume`,{});return next.id;});
  await page.waitForFunction(async id=>{const M=MoleculeVisualizer,r=await M.EngineUI.request(M.EngineUI.getConnection(),'/api/jobs/'+id);return ['completed','error'].includes(r.status);},restored,{timeout:60000});
  await page.evaluate(async id=>{const M=MoleculeVisualizer,r=await M.EngineUI.request(M.EngineUI.getConnection(),'/api/jobs/'+id);if(r.status!=='completed')throw Error(r.error);M.EngineUI.restoreJob(r);},restored);
  assert.equal(await page.locator('#modelFSurface').inputValue(),'upper');assert.match(await page.locator('#engineModelFResult').textContent(),/AMF上側/);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-artifacts/model-f-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1280,height:1000});await page.click('#engineClose');
  // Real canvas selection -> AFIR fragments -> ModelF run -> apply/export.
  await load([1.3]);await page.click('#btnAFIR');await page.uncheck('#afirLive');
  for(let i=0;i<2;i++){const p=await page.evaluate(i=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===i+1);return {x:a.x,y:a.y};},i);await page.locator('canvas').click({position:p});await page.fill('#afirName','H '+(i+1));await page.click('#afirAddFragment');}
  await page.selectOption('#afirMode','repel');await page.fill('#afirGamma','20');await page.click('#afirAddPair');await page.fill('#afirSteps','2');await page.fill('#afirFmax','0.00001');await page.click('#afirRun');await page.waitForFunction(()=>!MoleculeVisualizer.AFIRUI.isBusy(),null,{timeout:60000});assert.equal(await page.locator('#afirResult').isVisible(),true,await page.locator('#afirMessage').textContent());
  assert.equal(posted.at(-1).modelF.surface,'upper');const afir=JSON.parse(await download('#afirDownload'));assert.deepEqual(afir.result.energies,afir.result.surfaceComponents.upperEV);assert.ok(afir.result.biasEnergies.some(e=>e!==0));await page.click('#afirApply');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.modelF),afir.result.modelF);
  assert.deepEqual(errors,[]);console.log('ModelF native browser: focused input, lower MIN, upper LUP/lower CI-NEB, AFIR selection/run/apply, surfaces/CSV/XYZ/project, presets, saved-job resume, mobile: passed');
 }finally{if(browser)await browser.close();engine.kill('SIGTERM');await new Promise(resolve=>engine.exitCode!==null?resolve():engine.once('exit',resolve));fs.rmSync(history,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
