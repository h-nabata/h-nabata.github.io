/* End-to-end, real tblite + Sella; only small public NH3/H2O test structures. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',[path.join(root,'local-engine/bridge.py'),'--engine','tblite','--port','8767','--allow-origin','http://127.0.0.1:8765','--job-timeout','240'],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let output='',stderr='',browser;
 engine.stderr.on('data',d=>stderr+=d);
 const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Bridge startup failed: '+stderr)),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('Bridge exited '+code+': '+stderr));});});
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:1100}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))requests.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  assert.equal(await page.locator('#engineVibrationCheck').isChecked(),false);
  await page.click('#btnExternalEngine');await page.fill('#engineURL','http://127.0.0.1:8767');await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('Sella 2.6'));
  await page.click('#engineClose');
  const ammonia=async(count=1)=>page.evaluate(count=>{
    const M=MoleculeVisualizer,s=M.IO.parseXYZToState('4\nNH3 inversion test\nN 0 0 0.05\nH 1.03 0 0\nH -0.515 0.892 0\nH -0.515 -0.892 0\n');
    if(count>1){const frames=Array.from({length:count},(_,i)=>{const f=M.Model.createState(s);f.atoms[0].z=-.3+.6*i/(count-1);return M.Periodic.snapshot(f);});s.atoms=frames[0].atoms;s.metadata.trajectory=frames;s.metadata.frameIndex=0;}
    M.App.change('public ammonia fixture',()=>s,true);document.getElementById('dataReset').click();
  },count);
  const waitDone=async()=>{await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy(),null,{timeout:180000});assert.equal(await page.locator('#engineResult').isVisible(),true,await page.locator('#engineMessage').textContent());};
  const report=async()=>{const pending=page.waitForEvent('download');await page.click('#engineDownload');const file=await pending;return JSON.parse(fs.readFileSync(await file.path(),'utf8'));};
  await ammonia();const original=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));
  await page.click('#btnTS');assert.equal(await page.locator('#engineMode').inputValue(),'ts');assert.equal(await page.locator('#engineScope').inputValue(),'current');
  await page.fill('#engineSteps','60');await page.fill('#engineFmax','0.00001');await page.check('#engineVibrationCheck');await page.selectOption('#engineVibrationNfree','4');await page.fill('#engineVibrationThreshold','50');await page.fill('#engineTrust','0.03');await page.fill('#engineVibrationDelta','0.004'); // intentionally no blur
  await page.click('#engineRun');await waitDone();const ts=await report();
  assert.equal(requests.at(-1).mode,'ts');assert.equal(requests.at(-1).trustRadius,.03);assert.deepEqual(requests.at(-1).vibrations,{delta:.004,nfree:4,imaginaryThreshold:50});
  assert.equal(ts.result.converged,true);assert.equal(ts.result.optimizer,'sella-prfo');assert.equal(ts.result.vibrations.status,'completed');assert.equal(ts.result.vibrations.significantImaginaryCount,1);assert.equal(ts.result.vibrations.modes.length,12);assert.equal(ts.result.vibrations.evaluations,49);
  assert.ok(ts.result.vibrations.imaginary[0]);assert.ok(ts.result.vibrations.frequenciesCM[0]>800);assert.equal(ts.result.trajectory.images.length,ts.result.steps+1);assert.deepEqual(ts.result.atomIds,ts.input.atomIds);
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),original);
  await page.click('#engineVibrationShow');assert.equal(await page.locator('#vibrationRows tr').count(),12);await page.locator('#vibrationRows tr').first().click();
  assert.equal(await page.locator('#vibrationRows tr').first().evaluate(e=>getComputedStyle(e).color),'rgb(183, 28, 28)');
  await page.click('#btnViewXZ');assert.ok(await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedModeArrows.length)>0);
  const staticPositions=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.renderer().state.atoms));await page.click('#vibrationPlay');
  await page.waitForFunction(before=>JSON.stringify(MoleculeVisualizer.App.renderer().state.atoms)!==before,staticPositions);
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),original);
  await page.screenshot({path:'test-artifacts/ts-vibration-modes.png'});
  const csvPending=page.waitForEvent('download');await page.click('#vibrationCSV');const csv=await csvPending,csvText=fs.readFileSync(await csv.path(),'utf8');assert.equal(csvText.trim().split('\n').length,13);assert.match(csvText,/1,[\d.]+,true,/);
  await page.fill('#vibrationAmplitude','0.03');await page.click('#vibrationPlus');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().previewOnly),false);assert.notEqual(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),original);
  await page.click('#btnUndo');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),original);
  // Frequency-only analysis uses exactly the approximate, unoptimized input.
  await page.click('#btnVibrations');await page.selectOption('#engineVibrationNfree','2');await page.fill('#engineVibrationDelta','0.006');await page.click('#engineRun');await waitDone();const vib=await report();assert.equal(vib.input.mode,'vibrations');assert.deepEqual(vib.result.images,vib.input.images);assert.equal(vib.result.vibrations.status,'completed');
  // Minimize with L-BFGS; optional frequencies OFF and edited value forwarded.
  await page.selectOption('#engineMode','optimize');await page.uncheck('#engineVibrationCheck');await page.selectOption('#engineOptimizer','lbfgs');await page.fill('#engineSteps','3');await page.fill('#engineMove','0.03');await page.click('#engineRun');await waitDone();const opt=await report();assert.equal(opt.result.optimizer,'lbfgs');assert.equal(opt.input.maxMove,.03);assert.equal(opt.result.vibrations,undefined);assert.equal(opt.result.trajectory.images.length,opt.result.steps+1);
  await page.click('#engineClose');await ammonia(5);
  // Relax a band, keep all its nodes when choosing one specific TS candidate.
  await page.click('#btnExternalEngine');assert.equal(await page.locator('#engineMode').inputValue(),'cineb');await page.fill('#engineSteps','1');await page.fill('#engineClimb','0');await page.click('#engineRun');await waitDone();const neb=await report();
  const nodeIDs=await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms.map(a=>a.id));await page.getByRole('button',{name:'構造3をTS入力にする',exact:true}).click();
  assert.equal(await page.locator('#engineMode').inputValue(),'ts');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.frameIndex),2);assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory.length),5);
  assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms.map(a=>[a.x,a.y,a.z])),neb.result.images[2]);assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms.map(a=>a.id)),nodeIDs);
  await page.click('#engineClose');
  // Insert only the selected interval; retain all old nodes and fixed endpoints.
  const beforeRefinement=requests.length;
  const oldFrames=await page.evaluate(()=>MoleculeVisualizer.EngineUI.frames(MoleculeVisualizer.App.getState(),'all'));
  await page.click('#btnRefinePath');await page.fill('#refineFrom','2');await page.fill('#refineTo','4');await page.fill('#refineEach','2');await page.click('#refineNEB');
  const refined=await page.evaluate(()=>MoleculeVisualizer.EngineUI.frames(MoleculeVisualizer.App.getState(),'all'));assert.equal(refined.length,9);
  for(const [i,j] of [[0,0],[1,1],[2,4],[3,7],[4,8]])assert.deepEqual(refined[j].atoms,oldFrames[i].atoms);
  assert.equal(await page.locator('#engineMode').inputValue(),'cineb');assert.equal(requests.length,beforeRefinement,'opening settings does not launch a new job');
  await page.click('#engineRun');await waitDone();assert.equal(requests.at(-1).mode,'cineb');assert.equal(requests.at(-1).images.length,9);assert.equal((await report()).result.mode,'cineb');await page.click('#engineClose');
  // Running NEB can be stopped at its latest fully evaluated band with live preview OFF.
  await ammonia(21);await page.click('#btnExternalEngine');assert.equal(await page.locator('#engineMode').inputValue(),'cineb');await page.fill('#engineSteps','10000');await page.fill('#engineFmax','0.00001');assert.equal(await page.locator('#engineLive').isChecked(),false);
  const checkpoint=page.waitForResponse(async response=>{if(!response.url().match(/\/api\/jobs\/[a-f0-9]+$/)||response.request().method()!=='GET')return false;const j=await response.json();return j.status==='running'&&j.progress?.step>=1;},{timeout:60000});
  await page.click('#engineRun');await checkpoint;await page.click('#enginePause');await page.waitForSelector('#refineDialog[open]',{timeout:30000});
  assert.match(await page.locator('#refineSummary').textContent(),/21ノード/);await page.fill('#refineFrom','10');await page.fill('#refineTo','12');await page.fill('#refineEach','1');await page.screenshot({path:'test-artifacts/neb-pause-refine.png'});await page.click('#refineNEB');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory.length),23);assert.equal(await page.locator('#engineMode').inputValue(),'cineb');
  await page.fill('#engineSteps','2');await page.fill('#engineClimb','1');await page.click('#engineRun');await waitDone();
  const resumed=await report();assert.equal(resumed.input.mode,'cineb');assert.equal(resumed.input.climbAfter,1);assert.equal(resumed.result.images.length,23);assert.ok(Number.isInteger(resumed.result.climbingImage));await page.click('#engineClose');
  // Mode table is scrollable and fits mobile width; hide restores the real input.
  await page.setViewportSize({width:390,height:844});await page.click('#vibrationToggle');await page.screenshot({path:'test-artifacts/ts-vibration-mobile.png'});const dim=await page.locator('#vibrationPanel').evaluate(e=>({w:e.clientWidth,scroll:e.scrollWidth}));assert.ok(dim.scroll<=dim.w+2);await page.click('#vibrationHide');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().previewOnly),false);
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));assert.ok(!storage.includes(token));assert.ok(!JSON.stringify(ts).includes(token));assert.deepEqual(errors,[]);
  console.log('Sella TS / vibrations / mode arrows / NEB refinement browser integration passed');
 }finally{if(browser)await browser.close();engine.kill('SIGINT');await new Promise(resolve=>{if(engine.exitCode!==null)return resolve();engine.on('exit',resolve);setTimeout(()=>{engine.kill('SIGKILL');resolve();},5000).unref();});}
})().catch(error=>{console.error(error);process.exitCode=1;});
