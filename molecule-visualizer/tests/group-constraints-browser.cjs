const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const C=require('../group-constraints.js');
(async()=>{
 const root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',[path.join(root,'local-engine/bridge.py'),'--engine','tblite','--port','8766','--site-dir',root,'--no-history'],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let output='',stderr='',browser;engine.stderr.on('data',d=>stderr+=d);
 try{
  const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr)),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('bridge '+code+' '+stderr));});});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1360,height:1050}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))requests.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:8766/');await page.waitForSelector('canvas');
  const download=async selector=>{const pending=page.waitForEvent('download');await page.click(selector);return fs.readFileSync(await (await pending).path(),'utf8');};
  const select=async indices=>{await page.click('#btnClearSel');for(const i of indices){const p=await page.evaluate(i=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===i+1);return{x:a.x,y:a.y};},i);await page.locator('canvas').click({position:p});}};
  const done=()=>page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&!document.getElementById('engineResult').hidden,{},{timeout:60000});
  await page.evaluate(()=>{const M=MoleculeVisualizer;M.App.change('public water dimer',()=>{const s=M.IO.parseXYZToState('O 0 0 0\nH 1.2 0 0\nH -.24 .93 0\nO 3.5 .3 .4\nH 4.7 .3 .4\nH 3.26 1.23 .4');s.atoms[0].xyzExtras={mass:{type:'R',values:['18']}};return s;},true);});
  await page.click('#btnGroupConstraints');await select([0,1,2]);await page.click('#groupConstraintAddSelected');
  assert.equal(await page.locator('#groupConstraintRows > div').count(),1);assert.match(await page.locator('#groupConstraintSummary').textContent(),/位置を固定/);
  await page.click('#btnUndo');assert.equal(await page.locator('#groupConstraintRows > div').count(),0);await page.click('#btnRedo');
  await page.click('#groupConstraintAddSelected');assert.match(await page.locator('#groupConstraintStatus').textContent(),/重複/);assert.equal(await page.locator('#groupConstraintRows > div').count(),1);
  await select([3,4,5]);await page.click('#groupConstraintAddSelected');assert.match(await page.locator('#groupConstraintSummary').textContent(),/相対位置/);
  const project=await page.evaluate(()=>{const M=MoleculeVisualizer;return M.IO.stateToProjectText(M.App.getState());});
  const saved=JSON.parse(project).metadata.groupConstraints;
  await page.click('#groupConstraintClear');assert.equal(await page.locator('#groupConstraintRows > div').count(),0);
  await page.evaluate(project=>{const M=MoleculeVisualizer;M.App.change('reload project',()=>M.IO.parseProject(project),true);},project);
  assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.groupConstraints),saved);
  await page.click('#groupConstraintOptimize');await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  await page.uncheck('#engineLive');await page.fill('#engineSteps','3');await page.fill('#engineFmax','0.00001');await page.selectOption('#engineOptimizer','lbfgs');await page.click('#engineRun');await done();
  const report=JSON.parse(await download('#engineDownload'));assert.ok(!JSON.stringify(report).includes(token));
  assert.equal(requests.at(-1).groupConstraints.mode,'relative');assert.deepEqual(report.input.groupConstraints.groups,[[0,1,2],[3,4,5]]);assert.equal(report.input.groupConstraints.masses[0],18);
  C.validateResult(report.result,report.input);assert.notDeepEqual(report.result.images[0],report.input.images[0]);assert.ok(report.result.energies.every(Number.isFinite));
  await page.click('#engineApply');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.groupConstraints),saved);
  await page.screenshot({path:'test-artifacts/group-centers.png',fullPage:true});
  // Recalculate with one active group, then both absolutely fixed: UI changes reach real jobs.
  if(!await page.locator('#groupConstraintMode').isVisible())await page.click('#btnGroupConstraints');
  await page.locator('#groupConstraintRows input').last().uncheck();await page.click('#groupConstraintOptimize');await page.click('#engineRun');await done();
  const single=JSON.parse(await download('#engineDownload'));assert.equal(single.input.groupConstraints.groups.length,1);C.validateResult(single.result,single.input);await page.click('#engineApply');
  await page.locator('#groupConstraintRows input').last().check();await page.selectOption('#groupConstraintMode','absolute');await page.click('#groupConstraintOptimize');await page.click('#engineRun');await done();
  const absolute=JSON.parse(await download('#engineDownload'));assert.equal(absolute.input.groupConstraints.mode,'absolute');C.validateResult(absolute.result,absolute.input);await page.click('#engineApply');
  // Restoring a saved job reconstructs stable groups and explicit masses.
  await page.evaluate(report=>MoleculeVisualizer.EngineUI.restoreJob({data:report.input,result:report.result},true),report);
  const restored=await page.evaluate(()=>MoleculeVisualizer.EngineUI.input().data.groupConstraints);assert.deepEqual(restored,report.input.groupConstraints);await page.click('#engineClose');
  // AFIR uses the same independent COM groups and retains physical/artificial energies.
  await page.click('#btnAFIR');await select([0,1,2]);await page.fill('#afirName','Water A');await page.click('#afirAddFragment');await select([3,4,5]);await page.fill('#afirName','Water B');await page.click('#afirAddFragment');await page.click('#afirAddPair');
  await page.fill('#afirSteps','3');await page.fill('#afirFmax','0.00001');await page.uncheck('#afirLive');await page.click('#afirRun');
  await page.waitForFunction(()=>!MoleculeVisualizer.AFIRUI.isBusy()&&!document.getElementById('afirResult').hidden,{},{timeout:60000});
  const afir=JSON.parse(await download('#afirDownload')),afirInput=requests.at(-1);C.validateResult(afir.result,afirInput);assert.equal(afir.result.validation,'biased-trajectory-not-ts');
  for(let i=0;i<afir.result.energies.length;i++)assert.ok(Math.abs(afir.result.biasedEnergies[i]-afir.result.energies[i]-afir.result.biasEnergies[i])<1e-10);
  await page.click('#afirApply');await page.evaluate(()=>MoleculeVisualizer.Studio.stop());
  // AFIR groups can be copied; registering a group does not alter AFIR definitions.
  await page.click('#groupConstraintClear');await page.selectOption('#groupConstraintAFIR',{label:'Water A'});await page.click('#groupConstraintAddAFIR');
  assert.match(await page.locator('#groupConstraintRows').textContent(),/Water A/);
  const mass=report.input.groupConstraints.masses,batchXYZ=shift=>'6\nProperties=species:S:1:pos:R:3:mass:R:1\n'+report.input.symbols.map((s,i)=>s+' '+report.input.images[0][i].map((v,k)=>v+(k===0?shift:0)).join(' ')+' '+mass[i]).join('\n');
  await page.click('#btnBatchOptimize');await page.fill('#batchText',batchXYZ(0)+'\n'+batchXYZ(2));await page.uncheck('#engineLive');await page.fill('#engineSteps','2');await page.click('#engineRun');
  await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&document.getElementById('engineMessage').textContent.includes('終了しました'),{},{timeout:60000});
  const batch=JSON.parse(await download('#batchJSON'));assert.equal(batch.entries.length,2);
  for(const e of batch.entries){assert.ok(e.result);C.validateResult(e.result,{images:[e.frame.atoms.map(a=>[a.x,a.y,a.z])],groupConstraints:batch.settings.groupConstraints});}
  assert.notDeepEqual(batch.entries[0].result.groupConstraints.referenceCenters,batch.entries[1].result.groupConstraints.referenceCenters);await page.click('#engineClose');
  const before=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));await page.click('#btnRelax');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  // Incompatible methods and old services are rejected before POST, never silently unconstrained.
  await page.click('#groupConstraintOptimize');const count=requests.length;await page.selectOption('#engineMode','evaluate');await page.click('#engineRun');assert.match(await page.locator('#engineMessage').textContent(),/重心拘束/);assert.equal(requests.length,count);
  await page.selectOption('#engineMode','optimize');await page.route('**/api/info',async route=>{const response=await route.fetch(),info=await response.json();delete info.groupConstraints;info.version='1.10.0';await route.fulfill({json:info});});
  await page.click('#engineConnect');await page.waitForFunction(()=>!document.getElementById('engineConnect').disabled);await page.click('#engineRun');assert.match(await page.locator('#engineMessage').textContent(),/bridge.py/);assert.equal(requests.length,count);
  await page.click('#engineClose');await page.setViewportSize({width:390,height:844});await page.locator('#groupConstraintPanel').scrollIntoViewIfNeeded();const sizes=await page.locator('#groupConstraintPanel').evaluate(e=>[e.clientWidth,e.scrollWidth]);assert.ok(sizes[1]<=sizes[0]+2);await page.screenshot({path:'test-artifacts/group-centers-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Group centers: real tblite relative/single/absolute MIN, batch and AFIR, canvas registration, isotope mass, undo/redo, project and saved-job restoration, apply, AFIR copy, guards and mobile layout passed');
 }finally{if(browser)await browser.close();engine.kill('SIGINT');await new Promise(resolve=>{if(engine.exitCode!==null)return resolve();engine.on('exit',resolve);setTimeout(()=>{engine.kill('SIGKILL');resolve();},5000).unref();});}
})().catch(e=>{console.error(e);process.exitCode=1;});
