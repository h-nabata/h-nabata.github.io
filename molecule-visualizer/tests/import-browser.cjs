/* Synthetic file import through native File/DataTransfer and real UI controls. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=require('./import-fixtures.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],posted=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&!r.url().startsWith('http://127.0.0.1:8777/'))external.push(r.url());});
  let job;
  await page.route('http://127.0.0.1:8777/api/**',async route=>{
   const req=route.request(),pathname=new URL(req.url()).pathname;
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'http://127.0.0.1:8765','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'}});
   let body;
   if(pathname==='/api/info')body={version:'1.9.0',engine:'tblite',method:'GFN2-xTB',modes:['evaluate','optimize'],maxImages:100,maxSteps:10000,periodic:false,fixedAtoms:true,optimizationTrajectory:true};
   else if(pathname==='/api/jobs'&&req.method()==='POST'){
    const d=req.postDataJSON();posted.push(d);
    const positions=d.images[0].map((p,i)=>p.map((v,j)=>v+(i===1&&j===2?.01:0))),zeros=d.symbols.map(()=>[0,0,0]);
    job={id:'1'.repeat(32),status:'completed',result:{mode:d.mode,symbols:d.symbols,atomIds:d.atomIds,cell:d.cell,charge:d.charge,multiplicity:d.multiplicity,engine:'tblite',method:'GFN2-xTB',images:[positions],energies:[-.1],forces:[zeros],imageFmax:[.01],effectiveFmax:.01,steps:1,evaluations:2,converged:true,reason:'converged',units:{length:'angstrom',energy:'eV',force:'eV/angstrom'},fixedAtoms:d.fixedAtoms,optimizer:d.optimizer,trajectory:{images:[d.images[0],positions],energies:[0,-.1]},history:[{step:1,energies:[-.1],fmax:.01}]}};
    body=job;
   }else body=job||{};
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'http://127.0.0.1:8765'},body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  const state=()=>page.evaluate(()=>{const s=MoleculeVisualizer.App.getState();return {atoms:s.atoms,metadata:s.metadata};});
  const drop=async records=>{await page.evaluate(records=>{const dt=new DataTransfer();for(const r of records)dt.items.add(new File([r.text],r.name,{type:'text/plain'}));document.querySelector('.mv-app').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},records);};
  await drop([{name:'reaction.com',text:fixture.grrm}]);
  await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.sourceFormat==='grrm');
  let s=await state();assert.equal(s.atoms.length,3);assert.equal(s.metadata.trajectory.length,2);assert.deepEqual(s.metadata.constraints.fixedAtomIds,[s.atoms[2].id]);
  await page.click('#frameNext');await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.frameIndex===1);
  s=await state();assert.equal(s.atoms[1].z,1.4);assert.equal(await page.locator('#frameLabel').textContent(),'2 / 2');
  // Actual canvas hit test and selected atom must agree after frame change.
  const point=await page.evaluate(()=>{const r=MoleculeVisualizer.App.renderer(),p=r.projectedAtoms[2],box=r.canvas.getBoundingClientRect();return {x:box.left+p.x,y:box.top+p.y,id:p.atom.id};});
  await page.mouse.click(point.x,point.y);assert.equal(await page.evaluate(id=>MoleculeVisualizer.App.getState().selectedAtomIds.has(id),point.id),true);
  await page.click('#btnExternalEngine');await page.fill('#engineURL','http://127.0.0.1:8777');await page.fill('#engineToken','synthetic-token');await page.click('#engineConnect');
  await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.startsWith('接続済み'));
  await page.selectOption('#engineMode','optimize');await page.uncheck('#engineVibrationCheck');await page.uncheck('#engineLive');await page.fill('#engineSteps','17');await page.click('#engineRun');
  await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy());
  assert.equal(posted.length,1,await page.locator('#engineMessage').textContent());assert.deepEqual(posted[0].fixedAtoms,[2]);assert.equal(posted[0].maxSteps,17);assert.equal(posted[0].charge,0);assert.equal(posted[0].multiplicity,1);assert.equal(posted[0].images[0][1][2],1.4);
  assert.equal(await page.locator('#engineResult').isVisible(),true,await page.locator('#engineMessage').textContent());await page.click('#engineApply');s=await state();assert.ok(Math.abs(s.atoms[1].z-1.41)<1e-8);assert.equal(s.atoms[2].x,5);
  // Save through a real browser download and reopen the exact bytes.
  await page.click('#btnExport');const downloadPromise=page.waitForEvent('download');await page.click('#btnSaveProject');const download=await downloadPromise;const path=await download.path(),saved=fs.readFileSync(path,'utf8');assert.ok(!saved.includes('synthetic-token'));assert.ok(saved.includes('constraints'));await page.locator('[data-close=exportDialog]').click();
  await page.setInputFiles('#fileInput',{name:'saved.json',mimeType:'application/json',buffer:Buffer.from(saved)});await page.waitForFunction(()=>document.getElementById('statusBadge').textContent.includes('読み込みました'));
  // Multiple files are committed together; failure leaves the full state unchanged.
  await page.setInputFiles('#fileInput',[{name:'a.gjf',mimeType:'text/plain',buffer:Buffer.from(fixture.gaussian)},{name:'b.xyz',mimeType:'text/plain',buffer:Buffer.from(fixture.xyz)}]);
  await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.trajectory?.length===2&&MoleculeVisualizer.App.getState().metadata.sourceFile==='a.gjf');
  const before=JSON.stringify(await state());
  await drop([{name:'a.xyz',text:fixture.xyz},{name:'bad.com',text:'# OPT/x\n0 1\nH bad 0 0'}]);
  await page.waitForFunction(()=>document.getElementById('statusBadge').textContent.includes('bad.com'));assert.equal(JSON.stringify(await state()),before);
  await page.click('#btnUndo');assert.ok(Math.abs((await state()).atoms[1].z-1.41)<1e-8);
  // Companion files are resolved locally and not duplicated in the trajectory.
  await drop([{name:'job.inp',text:'* xyzfile 0 1 h2.xyz'},{name:'h2.xyz',text:fixture.xyz}]);await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.sourceFormat==='orca');assert.equal((await state()).metadata.trajectory,undefined);
  // Editor file import uses filename hints for otherwise ambiguous GRO content.
  await page.click('#tab-atoms');await page.locator('#coordinateImportHelp summary').click();
  await page.setInputFiles('#dataFile',{name:'coords.gro',mimeType:'text/plain',buffer:Buffer.from(fixture.gro)});await page.waitForFunction(()=>document.getElementById('inputFormat').value==='gro');
  await page.click('#dataApply');await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.sourceFormat==='gro');s=await state();assert.equal(s.atoms[1].z,.74);assert.equal(s.metadata.cell.vectors[0][0],10);
  // Removing the cell is a model edit: no stale TV/Lattice in exports or localhost jobs.
  const originalCell=s.metadata.cell,geometry=await page.evaluate(()=>{const M=MoleculeVisualizer;return JSON.stringify([M.App.getState().atoms,M.App.getState().bonds,M.App.renderer().orientation]);});
  const coordinateText=await page.locator('#dataText').inputValue();await page.fill('#dataText',coordinateText+'\nH invalid 0 0');await page.click('#btnRemoveCell');
  assert.match(await page.locator('#statusBadge').textContent(),/編集中/);assert.deepEqual((await state()).metadata.cell,originalCell);assert.equal(await page.locator('#dataText').inputValue(),coordinateText+'\nH invalid 0 0');await page.click('#dataReset');
  await page.click('#btnRemoveCell');assert.equal((await state()).metadata.cell,null);assert.equal(await page.locator('#btnRemoveCell').isDisabled(),true);assert.equal(await page.locator('#cellStatus').textContent(),'非周期構造');
  assert.equal(await page.evaluate(()=>{const M=MoleculeVisualizer;return JSON.stringify([M.App.getState().atoms,M.App.getState().bonds,M.App.renderer().orientation]);}),geometry);assert.doesNotMatch(await page.locator('#dataText').inputValue(),/^TV /m);
  await page.click('#btnUndo');assert.deepEqual((await state()).metadata.cell,originalCell);await page.click('#btnRedo');assert.equal((await state()).metadata.cell,null);
  await page.click('#btnExport');assert.doesNotMatch(await page.locator('#exportText').inputValue(),/Lattice=|pbc=/);const removedDownload=page.waitForEvent('download');await page.click('#btnSaveProject');const removedText=fs.readFileSync(await (await removedDownload).path(),'utf8');assert.equal(JSON.parse(removedText).metadata.cell,null);await page.locator('[data-close=exportDialog]').click();
  await page.setInputFiles('#fileInput',{name:'nonperiodic.json',mimeType:'application/json',buffer:Buffer.from(removedText)});await page.waitForFunction(()=>document.getElementById('statusBadge').textContent.includes('読み込みました'));assert.equal((await state()).metadata.cell,null);
  await page.click('#btnExternalEngine');await page.selectOption('#engineMode','optimize');await page.click('#engineRun');await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy());assert.equal(posted.length,2);assert.equal(posted.at(-1).cell,null);await page.click('#engineApply');assert.equal((await state()).metadata.cell,null);
  // A late file read cannot overwrite a newer edit.
  await page.evaluate(()=>{window.originalRead=MoleculeVisualizer.Formats.readFiles;MoleculeVisualizer.Formats.readFiles=async(...args)=>{await new Promise(resolve=>window.finishRead=resolve);return originalRead(...args);};});
  await drop([{name:'late.com',text:fixture.grrm}]);await page.waitForFunction(()=>!!window.finishRead);
  await page.evaluate(()=>{MoleculeVisualizer.App.change('newer edit',s=>{s.atoms[0].x=8;});window.finishRead();});
  await page.waitForFunction(()=>document.getElementById('statusBadge').textContent.includes('中止'));assert.equal((await state()).atoms[0].x,8);
  await page.evaluate(()=>MoleculeVisualizer.Formats.readFiles=window.originalRead);
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:'test-artifacts/imports.png',fullPage:true});
  console.log(JSON.stringify({passed:true,checks:['GRRM drop and frozen atoms','frame navigation and canvas selection','fixed atom job transport and apply','project save/reopen','multi-file atomic failure and undo','ORCA local companion','GRO editor hints','cell removal, undo/redo, export/reopen and nonperiodic job/apply','stale read rejected','no external upload']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
