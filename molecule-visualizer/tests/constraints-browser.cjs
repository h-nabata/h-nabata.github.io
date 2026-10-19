const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',[path.join(root,'local-engine/bridge.py'),'--engine','tblite','--port','8766','--site-dir',root],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let output='',stderr='',browser;engine.stderr.on('data',d=>stderr+=d);
 const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr)),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('bridge '+code+' '+stderr));});});
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1360,height:1050}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))requests.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:8766/');await page.waitForSelector('canvas');
  const download=async selector=>{const pending=page.waitForEvent('download');await page.click(selector);return fs.readFileSync(await (await pending).path(),'utf8');};
  const select=async i=>{const p=await page.evaluate(i=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===i+1);return {x:a.x,y:a.y};},i);await page.locator('canvas').click({position:p});};
  await page.click('#btnConstraints');await select(0);await page.click('#constraintAddSelected');
  assert.equal(await page.locator('#constraintEnabled').isChecked(),true);assert.equal(await page.locator('#constraintAtoms').inputValue(),'1');
  await page.click('#btnUndo');assert.equal(await page.locator('#constraintEnabled').isChecked(),false);await page.click('#btnRedo');assert.equal(await page.locator('#constraintAtoms').inputValue(),'1');
  // Last keystroke need not blur: the submitted request must capture the visible draft.
  await page.fill('#constraintAtoms','1, 3');await page.click('#btnExternalEngine');await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  await page.selectOption('#engineMode','optimize');await page.uncheck('#engineLive');await page.fill('#engineSteps','3');await page.fill('#engineFmax','0.00001');await page.selectOption('#engineOptimizer','lbfgs');await page.click('#engineRun');
  await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&!document.getElementById('engineResult').hidden,{},{timeout:60000});
  assert.deepEqual(requests.at(-1).fixedAtoms,[0,2]);assert.equal(requests.at(-1).optimizer,'lbfgs');
  const report=JSON.parse(await download('#engineDownload'));
  assert.deepEqual(report.result.fixedAtoms,[0,2]);assert.ok(!JSON.stringify(report).includes(token));
  for(const p of report.result.trajectory.images)for(const i of [0,2])assert.deepEqual(p[i],report.input.images[0][i]);
  assert.notDeepEqual(report.result.images[0][1],report.input.images[0][1]);
  await page.click('#engineApply');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.Constraints.indices(MoleculeVisualizer.App.getState())),[0,2]);
  const project=await page.evaluate(()=>MoleculeVisualizer.IO.stateToProjectText(MoleculeVisualizer.App.getState()));assert.ok(project.includes('molecule-fixed-atoms/1'));
  await page.click('#btnUndo');await page.click('#btnConstraints');
  // Frozen AFIR group can be selected by name; force still acts on the mobile group.
  await page.click('#constraintClear');await page.click('#btnAFIR');await page.click('#btnClearSel');await select(0);await page.fill('#afirName','Fixed O');await page.click('#afirAddFragment');
  await select(1);await page.fill('#afirName','Mobile H');await page.click('#afirAddFragment');await page.click('#afirAddPair');
  await page.click('#btnConstraints');await page.selectOption('#constraintGroup',{label:'Fixed O'});await page.click('#constraintAddGroup');assert.equal(await page.locator('#constraintAtoms').inputValue(),'1');
  await page.fill('#afirSteps','3');await page.fill('#afirFmax','0.00001');await page.uncheck('#afirLive');await page.click('#afirRun');
  await page.waitForFunction(()=>!MoleculeVisualizer.AFIRUI.isBusy()&&!document.getElementById('afirResult').hidden,{},{timeout:60000});
  const afir=JSON.parse(await download('#afirDownload'));assert.deepEqual(afir.input.fixedAtoms,[0]);assert.deepEqual(afir.result.fixedAtoms,[0]);
  for(const p of afir.result.images)assert.deepEqual(p[0],afir.result.images[0][0]);assert.notDeepEqual(afir.result.images.at(-1)[1],afir.result.images[0][1]);
  await page.click('#afirApply');await page.evaluate(()=>MoleculeVisualizer.Studio.stop());assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.Constraints.indices(MoleculeVisualizer.App.getState())),[0]);
  await page.screenshot({path:'test-artifacts/fixed-afir.png',fullPage:true});
  // Batch MIN applies the same indices to each input's own anchors.
  await page.click('#btnBatchOptimize');await page.uncheck('#engineLive');await page.fill('#batchText','O 0 0 0\nH 1.2 0 0\nH -.24 .93 0\n--\nO 2 0 0\nH 3.2 0 0\nH 1.76 .93 0');await page.fill('#engineSteps','2');await page.click('#engineRun');
  await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&document.getElementById('engineMessage').textContent.includes('終了しました'),{},{timeout:60000});
  const batch=JSON.parse(await download('#batchJSON'));assert.deepEqual(batch.settings.fixedAtoms,[0]);assert.equal(batch.entries.length,2);
  for(const e of batch.entries){assert.ok(e.result);assert.deepEqual(e.result.images[0][0],[e.frame.atoms[0].x,e.frame.atoms[0].y,e.frame.atoms[0].z]);}
  assert.notDeepEqual(batch.entries[0].result.images[0][0],batch.entries[1].result.images[0][0]);
  // All-fixed, vibrations, unsupported services fail before any calculation is sent.
  await page.click('#engineClose');await page.click('#btnConstraints');await page.fill('#constraintAtoms','1-3');await page.click('#constraintApply');await page.click('#btnExternalEngine');await page.selectOption('#engineMode','optimize');const count=requests.length;await page.click('#engineRun');assert.match(await page.locator('#engineMessage').textContent(),/全原子/);assert.equal(requests.length,count);
  await page.click('#engineClose');await page.fill('#constraintAtoms','1');await page.click('#constraintApply');await page.click('#btnExternalEngine');await page.selectOption('#engineMode','optimize');await page.check('#engineVibrationCheck');await page.click('#engineRun');assert.match(await page.locator('#engineMessage').textContent(),/振動解析/);assert.equal(requests.length,count);await page.uncheck('#engineVibrationCheck');
  await page.route('**/api/info',async route=>{const response=await route.fetch(),info=await response.json();delete info.fixedAtoms;info.version='1.4.0';await route.fulfill({json:info});});await page.click('#engineConnect');await page.waitForFunction(()=>!document.getElementById('engineConnect').disabled);await page.click('#engineRun');assert.match(await page.locator('#engineMessage').textContent(),/bridge.py/);assert.equal(requests.length,count);
  // Manual drag, coordinate input, rigid transforms and navigation preserve bonds.
  await page.click('#engineClose');await page.click('#constraintClear');await page.evaluate(()=>{const MV=MoleculeVisualizer;MV.App.change('edit fixture',()=>MV.IO.parseXYZToState('C 0 0 0\nC 3 0 0'),true);});
  await page.fill('#dataText','C 0 0 0\nC 1.4 0 0');await page.click('#dataApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().bonds.length),0);
  await page.click('#tab-bonds');await page.click('#btnReinferBonds');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().bonds.length),1);
  await page.click('#toolMove');const p=await page.evaluate(()=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===2),r=document.querySelector('canvas').getBoundingClientRect();return {x:a.x+r.x,y:a.y+r.y};});await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+150,p.y+80,{steps:5});await page.mouse.up();assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().bonds.length),1);
  await page.setViewportSize({width:390,height:844});await page.click('#btnConstraints');await page.locator('#constraintPanel').scrollIntoViewIfNeeded();const dimensions=await page.locator('#constraintPanel').evaluate(e=>[e.clientWidth,e.scrollWidth]);assert.ok(dimensions[1]<=dimensions[0]+2);await page.screenshot({path:'test-artifacts/fixed-atoms-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Fixed MIN / AFIR-MIN: real tblite, selections, unblurred input, batch anchors, exports, apply, old bridge rejection and manual bond preservation passed');
 }finally{if(browser)await browser.close();engine.kill('SIGINT');await new Promise(resolve=>{if(engine.exitCode!==null)return resolve();engine.on('exit',resolve);setTimeout(()=>{engine.kill('SIGKILL');resolve();},5000).unref();});}
})().catch(e=>{console.error(e);process.exitCode=1;});
