/* Real HTTP/spawn/lifecycle/UI; analytic fixture models, no GPU accuracy claim. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',['-u',path.join(__dirname,'anysolv_fixture_bridge.py'),'--engine','uma','--uma-device','cuda:0','--anysolv','--anysolv-device','cuda:1','--port','8766','--site-dir',root]);
 let output='',stderr='',browser;engine.stderr.on('data',d=>stderr+=d);
 try{
  const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr||'timeout')),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('bridge '+code+' '+stderr));});});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))requests.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:8766/');await page.waitForSelector('canvas');
  await page.click('#btnExternalEngine');await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  assert.equal(await page.isChecked('#engineAnySolv'),false);
  assert.equal(await page.inputValue('#engineUMADevice'),'cuda:0');assert.equal(await page.inputValue('#engineAnySolvDevice'),'cuda:1');
  await page.check('#engineAnySolv');await page.selectOption('#engineAnySolvModel','model_moe');await page.selectOption('#engineSolvent','ethanol');
  await page.uncheck('#engineLive');await page.selectOption('#engineMode','optimize');await page.fill('#engineSteps','2');await page.fill('#engineFmax','0.00001');
  await page.locator('#engineRun').evaluate(el=>el.click());
  await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&!document.getElementById('engineResult').hidden,{},{timeout:60000});
  assert.deepEqual(requests.at(-1).solvation,{model:'model_moe',solvent:'ethanol',device:'cuda:1'});assert.equal(requests.at(-1).umaDevice,'cuda:0');
  const save=async id=>{const pending=page.waitForEvent('download');await page.click(id);return JSON.parse(fs.readFileSync(await (await pending).path(),'utf8'));};
  const report=await save('#engineDownload');assert.equal(report.result.provenance.solvent,'ethanol');assert.equal(report.result.provenance.uma.device,'cuda:0');assert.equal(report.result.provenance.anysolv.device,'cuda:1');
  assert.equal(report.result.energyComponents.uma.length,1);assert.equal(report.result.trajectory.energyComponents.solvation.length,3);
  assert.ok(Math.abs(report.result.energies[0]-report.result.energyComponents.uma[0]-report.result.energyComponents.solvation[0])<1e-10);
  assert.ok(!JSON.stringify(report).includes(token));assert.ok(!JSON.stringify(report).includes('/private/'));
  await page.screenshot({path:'test-artifacts/anysolv-settings.png'});
  await page.click('#engineApply');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getDisplayedState().atoms.map(a=>[a.x,a.y,a.z])),report.result.images[0]);
  // Select fragments via the canvas and use the SAME potential settings for AFIR.
  await page.click('#btnAFIR');await page.click('#btnClearSel');
  for(const i of [0,1]){
   const p=await page.evaluate(i=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===i+1);return {x:a.x,y:a.y};},i);
   await page.locator('canvas').click({position:p});await page.fill('#afirName','Group '+i);await page.click('#afirAddFragment');
  }
  await page.click('#afirAddPair');await page.fill('#afirSteps','2');await page.fill('#afirFmax','0.00001');await page.uncheck('#afirLive');await page.click('#afirRun');
  await page.waitForFunction(()=>!MoleculeVisualizer.AFIRUI.isBusy()&&!document.getElementById('afirResult').hidden,{},{timeout:60000});
  assert.equal(requests.at(-1).mode,'afir');assert.deepEqual(requests.at(-1).solvation,report.input.solvation);
  const afir=await save('#afirDownload');assert.deepEqual(afir.input.solvation,report.input.solvation);assert.equal(afir.result.provenance.solvent,'ethanol');assert.equal(afir.result.energyComponents.solvation.length,3);
  for(let i=0;i<afir.result.energies.length;i++)assert.ok(Math.abs(afir.result.biasedEnergies[i]-afir.result.energies[i]-afir.result.biasEnergies[i])<1e-8);
  // Failed delta computation keeps only completely evaluated corrected frames.
  await page.click('#btnExternalEngine');await page.selectOption('#engineSolvent','failure');await page.selectOption('#engineMode','optimize');await page.fill('#engineSteps','3');await page.locator('#engineRun').evaluate(el=>el.click());
  await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&!document.getElementById('engineResult').hidden,{},{timeout:60000});
  const failed=await save('#engineDownload');assert.equal(failed.result.reason,'failed');assert.equal(failed.result.trajectory.images.length,1);assert.equal(failed.result.provenance.solvent,'failure');assert.ok(!JSON.stringify(failed).includes('hf_private_token'));
  // Cancel a waiting delta worker, then immediately run a new gas-phase job.
  await page.selectOption('#engineSolvent','slow');await page.selectOption('#engineMode','evaluate');await page.click('#engineRun');
  await page.waitForFunction(()=>MoleculeVisualizer.EngineUI.isBusy());await page.click('#engineCancel');await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy(),{},{timeout:15000});
  await page.uncheck('#engineAnySolv');await page.click('#engineRun');await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&!document.getElementById('engineResult').hidden,{},{timeout:60000});
  const gas=await save('#engineDownload');assert.equal(gas.result.provenance.solvent,'gas');assert.equal(requests.at(-1).solvation,undefined);
  await page.fill('#engineToken','changed');assert.equal(await page.isVisible('#engineModelSettings'),false);assert.equal(await page.isChecked('#engineAnySolv'),false);
  assert.deepEqual(errors,[]);console.log('AnySolv two-process browser contract passed: device masks, MIN/AFIR, input/export/apply, failed correction, cancellation and gas reset.');
 }finally{if(browser)await browser.close();engine.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
