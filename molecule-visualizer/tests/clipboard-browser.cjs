const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1360,height:1050},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  const state=()=>page.evaluate(()=>JSON.parse(MoleculeVisualizer.IO.stateToProjectText(MoleculeVisualizer.App.getState())));
  const select=async i=>{const p=await page.evaluate(i=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===i+1);return {x:a.x,y:a.y};},i);await page.locator('canvas').click({position:p});};
  const count=async n=>{await page.waitForFunction(n=>MoleculeVisualizer.App.getState().atoms.length===n,n);};
  await page.check('#multiSelect');await select(0);await select(1);const original=await state();
  await page.keyboard.press('Control+c');const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.match(copied,/V3000/);
  await page.keyboard.press('Control+v');await count(5);let next=await state();
  assert.equal(next.bonds.length,3);assert.deepEqual(next.atoms.slice(0,3),original.atoms);assert.equal(new Set(next.atoms.map(a=>a.id)).size,5);
  assert.equal(await page.locator('#toolMove').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Control+z');await count(3);await page.keyboard.press('Control+Shift+z');await count(5);
  // Drag either pasted atom: both move rigidly and internal/host bonds stay unchanged.
  const p=await page.evaluate(()=>{const a=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.index===4),r=document.querySelector('canvas').getBoundingClientRect();return {x:a.x+r.x,y:a.y+r.y};});
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x-45,p.y+35,{steps:5});await page.mouse.up();
  const moved=await state();assert.notDeepEqual(moved.atoms[3],next.atoms[3]);assert.deepEqual(moved.atoms.slice(0,3),original.atoms);assert.deepEqual(moved.bonds,next.bonds);
  for(const axis of ['x','y','z'])assert.ok(Math.abs((moved.atoms[4][axis]-moved.atoms[3][axis])-(next.atoms[4][axis]-next.atoms[3][axis]))<1e-10);
  await page.click('#btnExport');const pending=page.waitForEvent('download');await page.click('#btnSaveProject');const saved=JSON.parse(fs.readFileSync(await (await pending).path(),'utf8'));assert.deepEqual(saved.atoms,moved.atoms);assert.deepEqual(saved.bonds,moved.bonds);await page.click('[data-close=exportDialog]');
  await page.locator('.mv-stage-toolbar').scrollIntoViewIfNeeded();await page.screenshot({path:'test-artifacts/fragment-copy-desktop.png',fullPage:true});
  // New document retains page clipboard; button paste and shortcut paste share the format.
  await page.click('#btnNew');await page.click('#btnPasteSelection');await count(2);next=await state();assert.equal(next.atoms[0].x,original.atoms[0].x);assert.equal(next.bonds.length,1);assert.ok(next.atoms.every(a=>!original.atoms.some(b=>a.id===b.id)));
  await page.click('#btnCopySelection');await page.waitForFunction(()=>document.getElementById('statusBadge').textContent.includes('コピーしました'));assert.equal(await page.evaluate(()=>document.activeElement.tagName),'CANVAS');
  await page.keyboard.press('Control+v');await count(4);
  // Textarea shortcuts remain text operations and do not add atoms.
  await page.locator('#dataText').focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/^4\n/);
  await page.evaluate(()=>navigator.clipboard.writeText('He 0 0 0'));await page.keyboard.press('Control+v');assert.equal((await state()).atoms.length,4);assert.equal(await page.locator('#dataText').inputValue(),'He 0 0 0');
  await page.click('#btnPasteSelection');assert.match(await page.locator('#statusBadge').textContent(),/未適用/);assert.equal((await state()).atoms.length,4);await page.click('#dataReset');
  // Browser denial uses the exact page copy and announces the fallback.
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{throw Error('permission denied');},writeText:async()=>{throw Error('permission denied');}}});});
  await page.click('#btnPasteSelection');await count(6);assert.match(await page.locator('#statusBadge').textContent(),/ページ内/);
  await page.setViewportSize({width:390,height:844});await page.locator('.mv-stage-toolbar').scrollIntoViewIfNeeded();
  for(const selector of ['.mv-stage-toolbar','#btnCopySelection','#btnPasteSelection']){const box=await page.locator(selector).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:'test-artifacts/fragment-copy-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Fragment clipboard: native copy/paste, selection and internal bonds, rigid drag, undo/redo, saved project, new document, text focus, denied API fallback and mobile layout passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
