/* Native CPU bridge + browser lifecycle. LLMLIP_TEST_MODEL must contain H/O.
   The upstream synthetic fixture verifies transport, never chemical accuracy. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const model=process.env.LLMLIP_TEST_MODEL;if(!model)throw Error('Set LLMLIP_TEST_MODEL to an absolute .e3rs model directory');
 const root=path.resolve(__dirname,'..'),history=fs.mkdtempSync(path.join(os.tmpdir(),'llmlip-test-'));
 const engine=spawn(process.env.PYTHON||'python',['-u',path.join(root,'local-engine/bridge.py'),'--engine','llmlip','--llmlip-model','first='+model,'--llmlip-model','second='+model,'--llmlip-model','unavailable='+path.join(history,'missing.e3rs'),'--threads','4','--workers','2','--port','8778','--history-dir',history,'--site-dir',root],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let out='',err='',browser;engine.stderr.on('data',d=>err+=d);
 try{
  const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('bridge startup: '+err)),60000);engine.stdout.on('data',d=>{out+=d;const m=out.match(/Token: (\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('bridge exit '+code+': '+err));});});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],posted=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))posted.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:8778/');await page.waitForSelector('canvas');
  await page.click('#btnConstraints');const point=await page.evaluate(()=>{const p=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===1);return{x:p.x,y:p.y};});
  await page.locator('canvas').click({position:point});await page.click('#constraintAddSelected');assert.equal(await page.locator('#constraintAtoms').inputValue(),'1');
  await page.click('#btnExternalEngine');await page.fill('#engineURL','http://127.0.0.1:8778');await page.selectOption('#engineChoice','llmlip');await page.fill('#engineToken',token);await page.click('#engineConnect');
  await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  assert.equal(await page.locator('#engineLLMLIPFields').isVisible(),true);assert.match(await page.locator('#engineLLMLIPFields').textContent(),/β版/);
  assert.equal(await page.locator('#engineUMAFields').isVisible(),false);assert.equal(await page.locator('#modelFEnabled').isDisabled(),true);
  assert.equal(await page.locator('#engineLLMLIPModel option[value=unavailable]').isDisabled(),true);
  await page.uncheck('#engineLive');await page.selectOption('#engineMode','optimize');await page.fill('#engineSteps','2');await page.fill('#engineFmax','0.00001');await page.fill('#engineLLMLIPThreads','2');
  await page.evaluate(()=>{if(document.activeElement.id!=='engineLLMLIPThreads')throw Error('lost input focus');document.getElementById('engineRun').click();});
  const done=async()=>{await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy(),null,{timeout:60000});assert.equal(await page.locator('#engineResult').isVisible(),true,await page.locator('#engineMessage').textContent());};
  await done();assert.equal(posted.at(-1).llmlip.threads,2);assert.deepEqual(posted.at(-1).fixedAtoms,[0]);
  const download=async selector=>{const promise=page.waitForEvent('download');await page.click(selector);return fs.readFileSync(await (await promise).path(),'utf8');};
  const saved=JSON.parse(await download('#engineDownload'));
  assert.equal(saved.result.engine,'llmlip');assert.equal(saved.result.provenance.llmlip.beta,true);assert.equal(saved.result.provenance.llmlip.backend,'direct');assert.equal(saved.result.provenance.llmlip.device,'cpu');
  assert.match(saved.result.provenance.llmlip.modelSHA256,/^[a-f0-9]{64}$/);assert.deepEqual(saved.result.images[0][0],saved.input.images[0][0]);assert.equal(saved.result.units.force,'eV/angstrom');
  assert.ok(!JSON.stringify(saved).includes(token));assert.ok(!JSON.stringify(saved).includes(model));
  await page.click('#engineApply');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getDisplayedState().atoms.map(a=>[a.x,a.y,a.z])),saved.result.images[0]);
  await page.click('#btnExport');const project=JSON.parse(await download('#btnSaveProject'));assert.deepEqual(project.metadata.externalCalculation.llmlip,saved.result.provenance.llmlip);await page.locator('#exportDialog [data-close]').click();
  await page.click('#btnExternalEngine');await page.selectOption('#engineMode','evaluate');await page.selectOption('#engineLLMLIPModel','second');await page.fill('#engineLLMLIPThreads','4');await page.click('#engineRun');await done();
  const second=JSON.parse(await download('#engineDownload'));assert.equal(second.result.provenance.llmlip.model,'second');assert.equal(second.result.provenance.llmlip.threads,4);
  // Reload the persisted first job through the same path used by history UI.
  await page.evaluate(async()=>{const M=MoleculeVisualizer,c=M.EngineUI.getConnection(),list=await M.EngineUI.request(c,'/api/jobs');const record=await M.EngineUI.request(c,'/api/jobs/'+list.jobs.find(j=>j.mode==='optimize').id);M.EngineUI.restoreJob(record);});
  assert.equal(await page.locator('#engineLLMLIPModel').inputValue(),'first');assert.equal(await page.locator('#engineLLMLIPThreads').inputValue(),'2');
  await page.fill('#engineLLMLIPThreads','99');const count=posted.length;await page.click('#engineRun');assert.equal(posted.length,count);assert.match(await page.locator('#engineMessage').textContent(),/CPUスレッド/);
  await page.fill('#engineLLMLIPThreads','2');fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/llmlip-cpu.png'});
  await page.setViewportSize({width:390,height:844});await page.locator('#engineLLMLIPFields').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-artifacts/llmlip-mobile.png'});
  await page.fill('#engineToken','changed');assert.equal(await page.locator('#engineLLMLIPFields').isVisible(),false);assert.equal(await page.locator('#engineRun').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('llmlip native browser: selection, capabilities, focused threads, fixed MIN, model switch, apply/export/history, desktop/mobile passed.');
 }finally{if(browser)await browser.close();engine.kill('SIGTERM');await new Promise(resolve=>engine.exitCode!==null?resolve():engine.once('exit',resolve));fs.rmSync(history,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
