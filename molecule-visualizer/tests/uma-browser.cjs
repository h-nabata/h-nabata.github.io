/* UI/transport contract test with a fake ML predictor, not native UMA accuracy. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',['-u',path.join(__dirname,'uma_fixture_bridge.py'),'--engine','uma','--uma-model','uma-s-1p2p1','--uma-device','cpu','--uma-precision','float64','--port','8766','--site-dir',root],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let output='',stderr='',browser;engine.stderr.on('data',d=>stderr+=d);
 try{
  const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr||'bridge timeout')),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('bridge '+code+' '+stderr));});});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1360,height:1050}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))requests.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:8766/');await page.waitForSelector('canvas');
  await page.click('#btnConstraints');const p=await page.evaluate(()=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===1);return {x:a.x,y:a.y};});
  await page.locator('canvas').click({position:p});await page.click('#constraintAddSelected');assert.equal(await page.locator('#constraintAtoms').inputValue(),'1');
  await page.click('#btnExternalEngine');await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  assert.equal(await page.locator('#engineUMADetails').isVisible(),true);assert.match(await page.locator('#engineUMASummary').textContent(),/uma-s-1p2p1.*omol.*CPU.*float64/);
  assert.match(await page.locator('#engineMessage').textContent(),/計算実行時/);
  await page.selectOption('#engineMode','optimize');await page.uncheck('#engineLive');await page.fill('#engineSteps','2');await page.fill('#engineFmax','0.00001');
  await page.fill('#engineCharge','1');await page.fill('#engineMultiplicity','2');
  // Submit while the condition field still has focus: do not depend on blur.
  await page.locator('#engineRun').evaluate(el=>el.click());
  await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&!document.getElementById('engineResult').hidden,{},{timeout:60000});
  assert.equal(requests.at(-1).charge,1);assert.equal(requests.at(-1).multiplicity,2);assert.deepEqual(requests.at(-1).fixedAtoms,[0]);
  const pending=page.waitForEvent('download');await page.click('#engineDownload');const report=JSON.parse(fs.readFileSync(await (await pending).path(),'utf8'));
  assert.equal(report.result.engine,'uma');assert.match(report.result.method,/uma-s-1p2p1.*omol/);assert.equal(report.result.provenance.uma.inference.base_precision_dtype,'float64');
  assert.equal(JSON.stringify(report).includes(token),false);
  assert.deepEqual(report.result.images[0][0],report.input.images[0][0]);assert.notDeepEqual(report.result.images[0][1],report.input.images[0][1]);
  await page.click('#engineApply');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getDisplayedState().atoms.map(a=>[a.x,a.y,a.z])),report.result.images[0]);
  await page.click('#btnExternalEngine');await page.screenshot({path:'test-artifacts/uma-connection.png'});
  // Rejected requests must never reach the worker; reconnecting resets capability UI.
  await page.selectOption('#engineMode','evaluate');await page.fill('#engineMultiplicity','101');const count=requests.length;await page.locator('#engineRun').evaluate(el=>el.click());
  assert.equal(requests.length,count);assert.match(await page.locator('#engineMessage').textContent(),/UMA.*1〜100/);
  await page.fill('#engineToken','changed');assert.equal(await page.locator('#engineUMADetails').isVisible(),false);assert.equal(await page.locator('#engineMultiplicity').getAttribute('max'),'101');
  assert.deepEqual(errors,[]);console.log('UMA browser contract: conditions, selection, fixed MIN, apply, export, capability reset passed (fake predictor).');
 }finally{if(browser)await browser.close();engine.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
