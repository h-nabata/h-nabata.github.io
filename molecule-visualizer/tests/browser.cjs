const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
 assert.match(await page.locator('#structureStats').textContent(),/3 原子/);
 assert.equal(await page.locator('#coordX,#coordY,#coordZ').count(),0);
 await page.fill('#dataText','O 2.5 0 0\nH .9572 0 0\nH -.239987 .926627 0');
 await page.click('#dataApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),2.5);
 await page.click('#btnUndo');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),0);

 await page.click('#sampleCrystal');assert.match(await page.locator('#cellStatus').textContent(),/周期境界 abc/);
 await page.click('#btnCell');await page.fill('#repeatCell','2 2 2');await page.click('#cellSuper');assert.match(await page.locator('#structureStats').textContent(),/16 原子/);
 await page.screenshot({path:'test-artifacts/periodic.png',fullPage:true});await page.click('#btnUndo');assert.match(await page.locator('#structureStats').textContent(),/2 原子/);
 await page.evaluate(()=>MoleculeVisualizer.App.loadText('1\nframe 1\nHe 0 0 0\n1\nframe 2\nHe 1 0 0\n'));await page.click('#frameNext');assert.equal(await page.locator('#frameLabel').textContent(),'2 / 2');
 await page.locator('canvas').click();await page.evaluate(()=>{const s=MoleculeVisualizer.App.getState();s.selectedAtomIds.add(s.atoms[0].id);MoleculeVisualizer.App.setState(s,true);});await page.locator('canvas').press('ArrowRight');assert.ok(await page.evaluate(()=>Math.abs(MoleculeVisualizer.App.getState().atoms[0].x-1.01)<1e-8));await page.click('#framePrev');await page.click('#frameNext');assert.ok(await page.evaluate(()=>Math.abs(MoleculeVisualizer.App.getState().atoms[0].x-1.01)<1e-8));
 await page.click('#btnKetcher');await page.waitForFunction(()=>document.querySelector('#ketcherFrame').contentWindow.ketcher,{},{timeout:90000});
 await page.fill('#smilesText','CCO');await page.click('#chemReadSmiles');await page.waitForFunction(()=>document.querySelector('#chemMessage').textContent.includes('描画しました'));await page.click('#chemSmiles');await page.waitForFunction(()=>document.querySelector('#chemMessage').textContent.includes('変換しました'));assert.match(await page.locator('#smilesText').inputValue(),/C/);
 await page.screenshot({path:'test-artifacts/ketcher.png',fullPage:true});await page.click('#chemTo3D');
 await page.waitForFunction(()=>!document.querySelector('#chemDialog').open||document.querySelector('#statusBadge').classList.contains('error'),{},{timeout:130000});
 assert.equal(await page.locator('#chemDialog').evaluate(e=>e.open),false,await page.locator('#chemMessage').textContent());
 const atoms=await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms);assert.equal(atoms.length,9);assert.ok(atoms.every(a=>[a.x,a.y,a.z].every(Number.isFinite)));
 await page.screenshot({path:'test-artifacts/studio.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-artifacts/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 assert.deepEqual(errors,[]);console.log('PASS: periodic cell, supercell undo, trajectory editing, shortcuts, Ketcher SMILES, UFF 3D generation, mobile layout');await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
