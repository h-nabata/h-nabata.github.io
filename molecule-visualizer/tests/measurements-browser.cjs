const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1150}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  const xyz=k=>{const p=[[0,0,0],[4,4,0],[1,0,0],[5,5,0],[0,0,2],[1,0,2],[1,1,k===2?3:2],[0,0,-4],[5,0,4],[1+k,1,0]];return `10\nmeasurement frame ${k+1}\n`+p.map(v=>'C '+v.join(' ')).join('\n')+'\n';};
  await page.fill('#dataText',[0,1,2].map(xyz).join(''));await page.click('#dataApply');
  const select=async indices=>{await page.evaluate(indices=>{const app=MoleculeVisualizer.App,s=app.getState();s.selectedAtomIds=new Set(indices.map(i=>s.atoms[i].id));app.setState(s,true);},indices);};
  await select([0,2,9]);assert.match(await page.locator('#measurementValue').textContent(),/90.000/);await page.click('#pinMeasurement');
  await page.click('#frameNext');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.Measurements.selectedIndices(MoleculeVisualizer.App.getState())),[0,2,9]);assert.match(await page.locator('#measurementValue').textContent(),/135.000/);assert.match(await page.locator('#pinnedMeasurements tr').textContent(),/135.000/);
  await page.click('#framePrev');await select([0,9]);await page.click('#pinMeasurement');
  await select([0,2,9,6]);await page.selectOption('#measurementType','dihedral');await page.click('#pinMeasurement');await page.selectOption('#measurementType','planeDistance');assert.match(await page.locator('#measurementValue').textContent(),/2.0000/);await page.click('#pinMeasurement');
  await select([7,0,2,9]);await page.selectOption('#measurementType','cone');assert.equal(await page.locator('#measurementConeOptions').isVisible(),true);await page.uncheck('#measurementConeVdw');await page.click('#pinMeasurement');
  await select([0,2,9,4,5,6]);assert.equal(await page.locator('#measurementType').inputValue(),'planeGap');assert.match(await page.locator('#measurementValue').textContent(),/2.0000/);await page.click('#pinMeasurement');assert.equal(await page.locator('#pinnedMeasurements tr').count(),6);
  await page.click('#btnClearSel');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().selectedAtomIds.size),0);assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().measurementAnnotations.filter(a=>a.pinned).length),6);
  const a0=await page.evaluate(()=>MoleculeVisualizer.App.renderer().measurementAnnotations.find(a=>a.id==='M2'));
  await page.click('#frameNext');const a1=await page.evaluate(()=>MoleculeVisualizer.App.renderer().measurementAnnotations.find(a=>a.id==='M2'));assert.notEqual(a0.value,a1.value);assert.notDeepEqual(a0.anchor,a1.anchor,'labels must follow molecular coordinates');
  await page.click('#frameNext');const planeRow=page.locator('[data-measurement-id="M6"] .mv-measure-number');assert.match(await planeRow.textContent(),/0.0000/);assert.match(await planeRow.getAttribute('title'),/交差/);
  const saved=await page.evaluate(()=>MoleculeVisualizer.IO.stateToProjectText(MoleculeVisualizer.App.getState()));await page.evaluate(text=>MoleculeVisualizer.App.loadText(text),saved);assert.equal(await page.locator('#pinnedMeasurements tr').count(),6);await page.click('#framePrev');assert.equal(await page.locator('#pinnedMeasurements tr').count(),6);
  const download=page.waitForEvent('download');await page.click('#downloadMeasurements');const file=await download,text=fs.readFileSync(await file.path(),'utf8');assert.equal(text.trim().split('\r\n').length,4);assert.match(text,/M1.*M6/);assert.match(text,/交差/);
  // Moving atoms updates values immediately and deleting a target produces undefined.
  await page.evaluate(()=>MoleculeVisualizer.App.change('move target',s=>{s.atoms[9].x+=.4;}));const moved=await page.evaluate(()=>MoleculeVisualizer.App.renderer().measurementAnnotations.find(a=>a.id==='M2'));assert.notEqual(moved.value,a1.value);
  await page.click('#btnUndo');await select([9]);await page.click('#btnDeleteSel');assert.match(await page.locator('[data-measurement-id="M2"] .mv-measure-number').textContent(),/未定義/);await page.click('#btnUndo');
  await page.locator('[data-measurement-id="M1"] .mv-measure-select').click();assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.Measurements.selectedIndices(MoleculeVisualizer.App.getState())),[0,2,9]);
  await page.locator('#viewer').scrollIntoViewIfNeeded();await page.screenshot({path:'test-artifacts/measurements-viewer.png'});
  await page.locator('#pinnedMeasurementTable').scrollIntoViewIfNeeded();await page.screenshot({path:'test-artifacts/measurements-panel.png'});
  await page.click('#clearMeasurements');assert.equal(await page.locator('#pinnedMeasurements tr').count(),0);await page.click('#btnUndo');assert.equal(await page.locator('#pinnedMeasurements tr').count(),6);
  // Actual generation Worker loads the ring module and produces non-rigid ring conformers.
  await page.evaluate(()=>{const {Model:M,App}=MoleculeVisualizer,s=M.createState();s.atoms=Array.from({length:6},(_,i)=>M.createAtom({element:'C',x:1.45*Math.cos(i*Math.PI/3),y:1.45*Math.sin(i*Math.PI/3),z:i%2?.24:-.24}));for(let i=0;i<6;i++)M.addOrUpdateBond(s,s.atoms[i].id,s.atoms[(i+1)%6].id,1,'covalent','manual');App.setState(s,false);document.getElementById('dataReset').click();});
  await page.click('#btnRandomStructures');await page.selectOption('#randomMode','torsion');await page.fill('#generationCount','5');assert.equal(await page.locator('#randomRings').isChecked(),true);await page.click('#generationRun');await page.waitForFunction(()=>!document.getElementById('generationDialog').open);
  const generated=await page.evaluate(()=>{const s=MoleculeVisualizer.App.getState();return {count:s.metadata.trajectory.length,moves:s.metadata.generation.ringMoves,angles:s.metadata.trajectory.map(f=>MoleculeVisualizer.Geometry.dihedral(...f.atoms.slice(0,4)))};});assert.equal(generated.count,5);assert.ok(generated.moves>0);assert.ok(Math.max(...generated.angles)-Math.min(...generated.angles)>1);
  const mobile=await browser.newPage({viewport:{width:390,height:844}});await mobile.goto('http://127.0.0.1:8765/molecule-visualizer/');await mobile.waitForSelector('canvas');await mobile.evaluate(text=>MoleculeVisualizer.App.loadText(text),saved);await mobile.locator('#pinnedMeasurementTable').scrollIntoViewIfNeeded();const dimension=await mobile.locator('.mv-measurements').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert.ok(dimension.scroll<=dimension.width+2,'measurement panel fits mobile width');await mobile.screenshot({path:'test-artifacts/measurements-mobile.png'});
  assert.deepEqual(errors,[]);console.log('Ring conformer and persistent measurements browser integration passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
