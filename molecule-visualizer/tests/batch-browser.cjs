const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',[path.join(root,'local-engine/bridge.py'),'--engine','tblite','--port','8766','--site-dir',root],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let output='',stderr='',browser;engine.stderr.on('data',d=>stderr+=d);
 const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr)),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('bridge '+code+' '+stderr));});});
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))requests.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:8766/');await page.waitForSelector('canvas');
  const water=x=>`O 0 0 0\nH ${x} 0 0\nH -.24 .92 0`,text=water(1.1)+'\n\n'+water(1.3)+'\n--\n'+water(1.1);
  const original=await page.evaluate(()=>MoleculeVisualizer.IO.stateToProjectText(MoleculeVisualizer.App.getState()));
  await page.click('#btnBatchOptimize');await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  await page.uncheck('#engineLive');await page.fill('#batchText',text);await page.click('#batchCheck');assert.match(await page.locator('#batchInputSummary').textContent(),/3構造/);
  // No input blur before Run: exact conditions must be captured once for all jobs.
  await page.selectOption('#engineOptimizer','lbfgs');await page.fill('#engineFmax','0.0001');await page.fill('#engineMove','0.02');await page.fill('#engineSteps','3');await page.click('#engineRun');
  await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&document.getElementById('batchRows').children.length===3&&document.getElementById('engineMessage').textContent.includes('終了しました'),{},{timeout:60000});
  assert.equal(requests.length,3);assert.ok(requests.every(r=>r.mode==='optimize'&&r.images.length===1&&r.maxSteps===3&&r.fmax===.0001&&r.maxMove===.02&&r.optimizer==='lbfgs'&&!r.vibrations));
  assert.deepEqual(requests[0].images,requests[2].images);assert.equal(await page.evaluate(()=>MoleculeVisualizer.IO.stateToProjectText(MoleculeVisualizer.App.getState())),original);
  const download=async selector=>{const pending=page.waitForEvent('download');await page.click(selector);return fs.readFileSync(await (await pending).path(),'utf8');};
  const json=await download('#batchJSON'),report=JSON.parse(json);assert.ok(!json.includes(token));assert.equal(report.entries.length,3);
  assert.ok(report.entries.every(e=>['converged','step_limit'].includes(e.status)));assert.ok(report.entries.some(e=>e.status==='step_limit'));
  assert.equal(report.entries[0].result.energies[0],report.entries[2].result.energies[0]);assert.notDeepEqual(report.entries[0].result.images[0],requests[0].images[0]);
  const csv=await download('#batchCSV');assert.match(csv,/relative_kJ_mol/);assert.ok(!csv.includes(token));
  const xyz=await download('#batchXYZ');assert.equal((xyz.match(/energy_eV=/g)||[]).length,3);assert.match(xyz,/status=step_limit/);
  await page.selectOption('#batchSort','energy');const energies=await page.locator('#batchRows tr').evaluateAll(rows=>rows.map(r=>Number(r.children[3].textContent)));assert.deepEqual(energies,[...energies].sort((a,b)=>a-b));
  await page.screenshot({path:'test-artifacts/batch-comparison.png',fullPage:true});
  await page.locator('#batchRows button').first().click();assert.equal(await page.locator('#engineDialog').isVisible(),false);
  assert.equal(await page.evaluate(()=>{const MV=MoleculeVisualizer,a=MV.IO.parseXYZToState(document.getElementById('dataText').value).atoms,b=MV.App.getDisplayedState().atoms;return a.every((v,i)=>['x','y','z'].every(k=>Math.abs(v[k]-b[i][k])<1e-8));}),true);
  await page.click('#profileDetails');await page.click('#batchApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory.length),3);
  // A valid multi-frame file can be loaded without changing the current model.
  await page.click('#btnBatchOptimize');await page.locator('#batchFile').setInputFiles({name:'three.xyz',mimeType:'chemical/x-xyz',buffer:Buffer.from(xyz)});await page.waitForFunction(()=>document.getElementById('batchText').value.includes('energy_eV='));await page.click('#batchCheck');assert.match(await page.locator('#batchInputSummary').textContent(),/3構造/);
  await page.selectOption('#batchSource','frames');await page.click('#batchCheck');assert.match(await page.locator('#batchInputSummary').textContent(),/3構造/);await page.selectOption('#batchSource','text');
  await page.fill('#batchText',water(.95)+'\n\nC 0 0 0');await page.click('#engineRun');assert.match(await page.locator('#engineMessage').textContent(),/元素順序/);assert.equal(requests.length,3);
  // UI fixtures isolate failure/cancellation behavior; the chemistry above uses tblite.
  let fixtureCount=0,cancelCount=0,held=false,cancelled=false,fixtureInput;
  const id='f'.repeat(32);
  await page.route('**/api/jobs',async route=>{fixtureInput=route.request().postDataJSON();fixtureCount++;await route.fulfill({json:{id}});});
  await page.route(new RegExp('/api/jobs/'+id+'(?:[/?].*)?$'),async route=>{
   if(route.request().url().endsWith('/cancel')){cancelCount++;cancelled=true;await route.fulfill({json:{}});return;}
   if(held){await route.fulfill({json:{status:cancelled?'cancelled':'running',progress:{step:0}}});return;}
   if(fixtureCount===2){await route.fulfill({json:{status:'error',error:'Fixture SCF failure'}});return;}
   const images=fixtureInput.images,energies=[-fixtureCount];await route.fulfill({json:{status:'completed',result:{symbols:fixtureInput.symbols,cell:fixtureInput.cell,images,energies,imageFmax:[0],effectiveFmax:0,mode:'optimize',reason:'converged',converged:true,steps:0,evaluations:1,engine:'UI fixture',method:'test',units:{energy:'eV',length:'angstrom'},trajectory:{images,energies}}}});
  });
  await page.fill('#batchText',text);await page.click('#engineRun');await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&document.getElementById('batchRows').textContent.includes('Fixture SCF failure'));
  assert.equal(fixtureCount,3);const partial=JSON.parse(await download('#batchJSON'));assert.deepEqual(partial.entries.map(e=>e.status),['converged','failed','converged']);assert.equal(((await download('#batchXYZ')).match(/energy_eV=/g)||[]).length,2);
  held=true;await page.click('#engineRun');await page.waitForFunction(()=>MoleculeVisualizer.EngineUI.isBusy());await page.click('#engineCancel');await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy());
  assert.equal(fixtureCount,4);assert.equal(cancelCount,1);const stopped=JSON.parse(await download('#batchJSON'));assert.deepEqual(stopped.entries.map(e=>e.status),['cancelled','not_run','not_run']);
  // Live batch execution still sends isolated inputs and ends on the comparison profile.
  held=false;await page.check('#engineLive');await page.click('#engineRun');await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&document.getElementById('profileTitle').textContent.includes('最終エネルギー比較'));
  assert.equal(fixtureCount,7);assert.ok(requests.slice(-3).every(r=>r.livePreview));
  await page.click('#profileDetails');await page.setViewportSize({width:390,height:844});const dimensions=await page.locator('#engineDialog').evaluate(e=>[e.clientWidth,e.scrollWidth]);assert.ok(dimensions[1]<=dimensions[0]+2);await page.screenshot({path:'test-artifacts/batch-mobile.png',fullPage:true});
  assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage}))).includes(token));assert.deepEqual(errors,[]);console.log('Batch optimization: real tblite, isolated jobs, input, comparison, exports, preview, failure and cancellation passed');
 }finally{if(browser)await browser.close();engine.kill('SIGINT');await new Promise(resolve=>{if(engine.exitCode!==null)return resolve();engine.on('exit',resolve);setTimeout(()=>{engine.kill('SIGKILL');resolve();},5000).unref();});}
})().catch(e=>{console.error(e);process.exitCode=1;});
