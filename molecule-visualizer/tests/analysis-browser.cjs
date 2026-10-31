const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1360,height:1050}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  await page.evaluate(()=>{
   const MV=MoleculeVisualizer,s=MV.IO.parseXYZToState('C 0 0 0\nH 1 0 0\nN 0 2 0\nO 0 0 3'),a=MV.Periodic.snapshot(s),b=MV.Periodic.snapshot(s),c=MV.Periodic.snapshot(s);
   b.atoms.forEach(p=>{const x=p.x;p.x=4-p.y;p.y=2+x;p.z-=9;});c.atoms[3].z=4;
   s.metadata.trajectory=[a,b,c];s.metadata.frameIndex=0;MV.App.change('test trajectory',()=>s,true);
  });
  const state=()=>page.evaluate(()=>MoleculeVisualizer.IO.stateToProjectText(MoleculeVisualizer.App.getState())),original=await state();
  await page.click('#analysisToggle');await page.selectOption('#analysisReference','0');await page.selectOption('#analysisMobile','1');await page.click('#analysisOverlay');
  assert.match(await page.locator('#analysisMessage').textContent(),/RMSD = 0\.00000/);assert.equal(await state(),original);
  assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().analysisOverlay.atoms.length),4);
  const before=await page.evaluate(()=>MoleculeVisualizer.App.renderer().orientation.slice());
  const canvas=page.locator('canvas'),box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.9,box.y+box.height*.8);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.7,{steps:5});await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().orientation.slice()),before);assert.equal(await state(),original);
  await page.click('#analysisRestore');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().analysisOverlay),null);
  await page.fill('#analysisThreshold','0.05');await page.click('#analysisCluster');await page.waitForFunction(()=>!document.getElementById('analysisSaveRepresentatives').disabled);
  assert.equal(await page.locator('#analysisRows tr').count(),2);assert.match(await page.locator('#analysisRows').textContent(),/先頭構造/);
  const pending=page.waitForEvent('download');await page.click('#analysisSaveRepresentatives');const download=await pending,text=fs.readFileSync(await download.path(),'utf8');assert.equal(download.suggestedFilename(),'molecule-representatives.xyz');assert.equal(text.match(/representative_frame=/g).length,2);assert.equal(await state(),original);
  await page.click('#analysisApplyRepresentatives');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory.length),2);await page.click('#analysisHide');
  await page.evaluate(()=>{
   const M=MoleculeVisualizer,s=M.App.getState(),p=s.atoms.map(a=>[a.x,a.y,a.z]);
   const infer=M.Bonding.refreshInferredBonds;window.analysisBuilds=0;
   M.Bonding.refreshInferredBonds=function(s){window.analysisBuilds++;return infer(s);};
   M.StructureAnalysisUI.setSource({mode:'optimize',symbols:s.atoms.map(a=>a.element),images:[p],energies:[-2],charge:0,multiplicity:1,cell:null,
    trajectory:{images:[p,p.map(v=>v.map((x,k)=>x+(k===0?2:0)))],energies:[-1,-2]}},{original:s});
  });
  assert.equal(await page.evaluate(()=>window.analysisBuilds),0);
  await page.click('#analysisToggle');await page.selectOption('#analysisSource','latest');
  assert.equal(await page.evaluate(()=>window.analysisBuilds),0);
  const beforeLatest=await state();await page.selectOption('#analysisMobile','1');await page.click('#analysisOverlay');
  assert.match(await page.locator('#analysisMessage').textContent(),/RMSD = 0\.00000/);assert.equal(await state(),beforeLatest);
  assert.equal(await page.evaluate(()=>window.analysisBuilds),2);await page.click('#analysisOverlay');assert.equal(await page.evaluate(()=>window.analysisBuilds),2);
  await page.click('#analysisRestore');await page.click('#analysisCluster');await page.waitForFunction(()=>!document.getElementById('analysisSaveRepresentatives').disabled);
  assert.equal(await page.locator('#analysisRows tr').count(),1);assert.match(await page.locator('#analysisRows').textContent(),/同一条件の最低エネルギー/);
  assert.equal(await page.locator('#analysisRows tr td').nth(1).textContent(),'2');assert.equal(await page.evaluate(()=>window.analysisBuilds),2);
  await page.click('#analysisHide');
  await page.evaluate(()=>{
   const MV=MoleculeVisualizer,s=MV.App.getState(),p=s.atoms.map(a=>[a.x,a.y,a.z]),f=p.map((_,i)=>[i===0?.5:0,0,0]);
   MV.DiagnosticsUI.load({mode:'optimize',symbols:s.atoms.map(a=>a.element),images:[p],energies:[-2],effectiveFmax:.5,steps:1,forceComponents:{physical:[f],effective:[f]},history:[{step:0,fmax:1,energies:[-1],diagnostics:{rmsForce:.4}},{step:1,fmax:.5,energies:[-2],diagnostics:{rmsForce:.2}}]}, {data:{fmax:.05},frames:[MV.Periodic.snapshot(s)]});
  });
  const beforeForce=await state();await page.click('#diagnosticsToggle');assert.match(await page.locator('#diagnosticsSummary').textContent(),/RMS有効力 0.20000/);
  assert.equal(await page.locator('#diagnosticsForces polyline').count(),2);assert.doesNotMatch(await page.locator('#diagnosticsEnergyLegend').textContent(),/溶媒補正/);
  await page.click('#diagnosticsShowVectors');assert.ok(await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedForceArrows.length>0));assert.equal(await state(),beforeForce);
  await page.locator('#diagnosticsVectorScale').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));});assert.match(await page.locator('#diagnosticsVectorValue').textContent(),/2.0 Å/);assert.equal(await state(),beforeForce);
  await page.click('#diagnosticsRestore');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().forceVectors),null);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/analysis-diagnostics-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('Structure analysis: proper overlay, camera rotation, immutable previews, worker dedup, XYZ export/apply, scalar diagnostics, force vectors and mobile layout passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
