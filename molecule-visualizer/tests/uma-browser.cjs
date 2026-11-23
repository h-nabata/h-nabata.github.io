const {clickWorkspaceCommand, openCalculationPane, openDetails} = require('./workspace-commands.cjs');
/* UI/transport contract test with a fake ML predictor, not native UMA accuracy. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const port=Number(process.env.UMA_UI_PORT||8937),root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',['-u',path.join(__dirname,'uma_fixture_bridge.py'),'--engine','uma','--uma-model','uma-s-1p2p1','--uma-device','cpu','--uma-precision','float64','--port',String(port),'--site-dir',root,'--no-history'],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let output='',stderr='',browser;engine.stderr.on('data',d=>stderr+=d);
 try{
  const token=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr||'bridge timeout')),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timer);reject(Error('bridge '+code+' '+stderr));});});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1360,height:1050}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))requests.push(r.postDataJSON());});
  await page.goto('http://127.0.0.1:'+port+'/');await page.waitForSelector('canvas');
  await clickWorkspaceCommand(page, '#btnConstraints');const p=await page.evaluate(()=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===1);return {x:a.x,y:a.y};});
  await page.locator('canvas').click({position:p});await page.click('#constraintAddSelected');assert.equal(await page.locator('#constraintAtoms').inputValue(),'1');
  await page.click('#btnExternalEngine');await openCalculationPane(page, 'connection');await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  await openCalculationPane(page, 'connection');
  assert.equal(await page.locator('#engineUMADetails').isVisible(),true);assert.match(await page.locator('#engineUMASummary').textContent(),/uma-s-1p2p1.*OMOL.*CPU.*float64/);
  assert.match(await page.locator('#engineMessage').textContent(),/実行時/);
  await page.screenshot({path:'test-artifacts/uma-connection.png'});
  await openCalculationPane(page, 'setup');
  await page.selectOption('#engineMode','optimize');await openDetails(page, '#engineNumericOptions');await page.uncheck('#engineLive');await page.fill('#engineSteps','2');await page.fill('#engineFmax','0.00001');
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
  await page.click('#btnExternalEngine');await openCalculationPane(page, 'setup');
  // Rejected requests must never reach the worker; reconnecting resets capability UI.
  await page.selectOption('#engineMode','evaluate');await page.fill('#engineMultiplicity','101');const count=requests.length;await page.locator('#engineRun').evaluate(el=>el.click());
  assert.equal(requests.length,count);assert.match(await page.locator('#engineMessage').textContent(),/UMA.*1〜100/);
  // Changing dimensionality updates the suggested task. A manual choice survives a run.
  for(const [pbc,defaultTask,selected] of [['T T T','omat','omc'],['T T F','oc20','oc22']]){
    await page.click('#engineClose');
    const xyz='2\nLattice="5 0 0 0 5 0 0 0 15" Properties=species:S:1:pos:R:3 pbc="'+pbc+'"\nCu 0 0 5\nO 0 0 6.7\n';
    await page.locator('#fileInput').setInputFiles({name:selected+'.xyz',mimeType:'text/plain',buffer:Buffer.from(xyz)});
    const mask=pbc.split(' ').map(v=>v==='T');
    await page.waitForFunction(mask=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.cell?.pbc)===JSON.stringify(mask),mask);
    await page.click('#btnExternalEngine');await openCalculationPane(page,'setup');
    assert.equal(await page.inputValue('#engineUMATask'),defaultTask);
    await page.selectOption('#engineUMATask',selected);
    assert.equal(await page.isVisible('#modelFSettings'),false);
    await page.selectOption('#engineMode','md');
    const npt=await page.locator('#mdEnsemble option[value="npt"]').evaluate(option=>option.disabled);
    assert.equal(npt,!['omat','omc'].includes(selected),JSON.stringify({selected,errors,help:await page.textContent('#mdEnsembleHelp')}));
    await page.selectOption('#engineMode','evaluate');
    await page.fill('#engineCharge','0');await page.fill('#engineMultiplicity','1');
    const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/jobs'));
    await page.click('#engineRun');
    const input=(await sent).postDataJSON();
    assert.equal(input.umaTask,selected);assert.deepEqual(input.cell.pbc,mask);
    await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy()&&!document.getElementById('engineResult').hidden,undefined,{timeout:60000});
    const event=page.waitForEvent('download');await page.click('#engineDownload');
    const saved=JSON.parse(fs.readFileSync(await(await event).path(),'utf8'));
    assert.equal(saved.result.provenance.uma.task,selected);assert.ok(Number.isFinite(saved.result.energies[0]));
  }
  await openCalculationPane(page, 'connection');await page.fill('#engineToken','changed');assert.equal(await page.locator('#engineUMADetails').isVisible(),false);assert.equal(await page.locator('#engineMultiplicity').getAttribute('max'),'101');
  assert.deepEqual(errors,[]);console.log('UMA browser contract: conditions, selection, fixed MIN, apply, export, capability reset passed (fake predictor).');
 }finally{if(browser)await browser.close();engine.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
