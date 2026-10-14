const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),engine=spawn(process.env.PYTHON||'python',[path.join(root,'local-engine/bridge.py'),'--engine','tblite','--port','8766','--allow-origin','http://127.0.0.1:8765','--site-dir',root],{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
 let output='',stderr='',browser;
 engine.stderr.on('data',d=>stderr+=d);
 const token=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Bridge did not start: '+stderr)),20000);engine.stdout.on('data',d=>{output+=d;const m=output.match(/Token: ([^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});engine.on('exit',code=>{clearTimeout(timeout);reject(Error('Bridge exited '+code+': '+stderr));});});
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  const before=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));
  await page.click('#btnExternalEngine');await page.fill('#engineURL','http://127.0.0.1:8766');await page.fill('#engineToken','incorrect');await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineMessage').textContent.includes('トークンが一致'));
  await page.fill('#engineToken',token);await page.click('#engineConnect');await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
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
  await page.click('#btnAFIR');
  for(let i=0;i<3;i++){
    const p=await page.evaluate(i=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===i+1);return {x:a.x,y:a.y};},i);
    await page.locator('canvas').click({position:p});await page.fill('#afirName','Group '+(i+1));await page.click('#afirAddFragment');
  }
  await page.selectOption('#afirA','f1');await page.selectOption('#afirB','f2');await page.fill('#afirGamma','40');await page.click('#afirAddPair');
  await page.selectOption('#afirA','f2');await page.selectOption('#afirB','f3');await page.selectOption('#afirMode','repel');await page.fill('#afirGamma','20');await page.click('#afirAddPair');
  await page.fill('#afirSteps','3');await page.fill('#afirFmax','0.00001');await page.fill('#afirMove','0.02');await page.click('#afirRun');
  await page.waitForSelector('#afirResult:not([hidden])');assert.match(await page.locator('#afirResultSummary').textContent(),/3ステップ/);
  assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),before);
  const afirDownload=page.waitForEvent('download');await page.click('#afirDownload');const afirFile=await afirDownload;
  const afir=JSON.parse(fs.readFileSync(await afirFile.path(),'utf8'));assert.equal(afir.input.config.maxSteps,3);assert.equal(afir.result.images.length,4);assert.equal(afir.result.validation,'biased-trajectory-not-ts');assert.ok(!JSON.stringify(afir).includes(token));
  await page.click('#afirApply');await page.click('#frameNext');assert.match(await page.locator('#frameLabel').textContent(),/2 \/ 4/);
  await page.screenshot({path:'test-artifacts/afir.png',fullPage:true});await page.click('#btnUndo');await page.click('#afirClose');await page.click('#dataReset');
  // Actual fixed-cell path relaxation, final review, apply, navigation, export and Undo.
  const xyz=offset=>`3\npath Lattice="9 0 0 1 9 0 0 0 9" pbc="T T T"\nO 0 0 0\nH ${.96+offset} 0 0\nH -.24 .93 0\n`;
  await page.fill('#dataText',[0,.2,.4].map(xyz).join(''));await page.click('#dataApply');
  const source=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.trajectory));
  await page.click('#btnExternalEngine');await page.selectOption('#engineMode','perpendicular');await page.fill('#engineSteps','3');await page.fill('#engineFmax','0.00001');await page.click('#engineRun');await page.waitForSelector('#engineResult:not([hidden])');
  assert.equal(await page.locator('#engineEnergyRows tr').count(),3);assert.match(await page.locator('#engineResultSummary').textContent(),/接線方向の最大更新/);
  await page.screenshot({path:'test-artifacts/engine-path.png'});
  await page.click('#engineApply');const after=await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory);const initial=JSON.parse(source),positions=f=>f.atoms.map(a=>[a.x,a.y,a.z]);
  assert.deepEqual(positions(after[0]),positions(initial[0]));assert.deepEqual(positions(after[2]),positions(initial[2]));assert.notDeepEqual(positions(after[1]),positions(initial[1]));assert.deepEqual(after[1].metadata.cell,initial[1].metadata.cell);
  await page.evaluate(()=>MoleculeVisualizer.Studio.frame(1));assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.externalCalculation.mode),'perpendicular');assert.equal((await page.evaluate(()=>MoleculeVisualizer.Studio.allXYZ())).match(/\nO /g).length,3);
  await page.click('#btnUndo');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.trajectory)),source);
  // Local UI fallback is served without Jekyll front matter and works at mobile width.
  const local=await browser.newPage({viewport:{width:390,height:844}});await local.goto('http://127.0.0.1:8766/');await local.waitForSelector('canvas');await local.click('#btnExternalEngine');assert.equal(await local.locator('#engineURL').inputValue(),'http://127.0.0.1:8766');
  await local.fill('#engineToken',token);await local.click('#engineConnect');await local.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
  const dimensions=await local.locator('#engineDialog').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.client+2,'dialog must fit mobile width');await local.screenshot({path:'test-artifacts/engine-mobile.png'});
  // Tokens do not enter autosave.
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));assert.ok(!storage.includes(token));assert.deepEqual(errors,[]);console.log('External engine browser integration passed');
 }finally{if(browser)await browser.close();engine.kill('SIGINT');await new Promise(resolve=>{if(engine.exitCode!==null)return resolve();engine.on('exit',resolve);setTimeout(()=>{engine.kill('SIGKILL');resolve();},5000).unref();});}
})().catch(error=>{console.error(error);process.exitCode=1;});
