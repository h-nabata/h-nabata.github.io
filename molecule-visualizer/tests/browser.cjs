const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1440}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
 assert.match(await page.locator('#structureStats').textContent(),/3 原子/);
 assert.ok((await page.locator('.mv-app').boundingBox()).y>=81);assert.ok((await page.locator('#structureTitle').boundingBox()).width>=530);assert.equal(await page.locator('.mv-subtitle').count(),0);
 await page.click('#btnToggleAxes');assert.equal(await page.locator('#btnToggleAxes').getAttribute('aria-pressed'),'true');await page.click('#btnToggleAxes');

 assert.equal(await page.locator('#coordX,#coordY,#coordZ').count(),0);
 await page.fill('#dataText','O 2.5 0 0\nH .9572 0 0\nH -.239987 .926627 0');
 await page.click('#dataApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),2.5);
 await page.click('#btnUndo');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),0);


 await page.uncheck('#xyzHeader');assert.match(await page.locator('#dataText').inputValue(),/^O /);
 await page.fill('#dataText','O\u30000\t0 0\rH .9572 0 0\u2028H -.239987 .926627 0');await page.click('#dataApply');
 await page.check('#xyzHeader');assert.match(await page.locator('#dataText').inputValue(),/^3\n/);
 const bounds=await page.locator('canvas').boundingBox();
 await page.click('#btnViewXY');const unchanged=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2,radius=Math.min(bounds.width,bounds.height)*.46;
 await page.mouse.move(cx+radius,cy);await page.mouse.down();for(let i=1;i<=12;i++){const a=i*Math.PI/24;await page.mouse.move(cx+radius*Math.cos(a),cy-radius*Math.sin(a));}await page.mouse.up();
 const rolled=await page.evaluate(()=>MoleculeVisualizer.App.renderer().rotate({x:1,y:0,z:0}));assert.ok(Math.abs(rolled.x)<1e-8&&Math.abs(rolled.y-1)<1e-8,'screen-normal roll must be reachable');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),unchanged);
 await page.click('#btnViewXY');
 // Pointer capture keeps delivering drag motion outside the canvas. Measure the
 // accumulated angle, since a final orientation alone cannot prove full turns.
 await page.mouse.move(cx,cy);await page.mouse.down();let turn=0,previous={x:0,y:0,z:1};
 for(let i=1;i<=260;i++){await page.mouse.move(cx+i*10,cy);const v=await page.evaluate(()=>MoleculeVisualizer.App.renderer().rotate({x:0,y:0,z:1}));turn+=Math.acos(Math.max(-1,Math.min(1,previous.x*v.x+previous.y*v.y+previous.z*v.z)));previous=v;}
 await page.mouse.up();assert.ok(turn>6*Math.PI,'a held drag must exceed three full turns');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),unchanged);await page.click('#btnViewXY');
 const picks=await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedAtoms.slice(0,2).map(p=>({x:p.x,y:p.y})));
 for(const i of [0,1,1])await page.mouse.click(bounds.x+picks[i].x,bounds.y+picks[i].y,{button:'right'});
 assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().selectedAtomIds.size),2);await page.click('#btnClearSel');

 await page.mouse.move(bounds.x+5,bounds.y+5);await page.mouse.down({button:'right'});await page.mouse.move(bounds.x+bounds.width-5,bounds.y+bounds.height-5,{steps:6});await page.mouse.up({button:'right'});
 assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().selectedAtomIds.size),3);
 const original=await page.evaluate(()=>({atoms:MoleculeVisualizer.App.getState().atoms.map(a=>({...a})),orientation:MoleculeVisualizer.App.renderer().orientation.slice()}));
 const altDrag=async button=>{await page.keyboard.down('Alt');await page.mouse.move(bounds.x+20,bounds.y+20);await page.mouse.down({button});await page.mouse.move(bounds.x+65,bounds.y+45,{steps:6});await page.mouse.up({button});await page.keyboard.up('Alt');};
 await altDrag('left');assert.notEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),original.atoms[0].x);await page.click('#btnUndo');
 await altDrag('right');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().orientation),original.orientation);
 assert.notEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[1].z),original.atoms[1].z);await page.click('#btnUndo');await page.click('#btnClearSel');
 await page.click('#sampleCrystal');assert.match(await page.locator('#cellStatus').textContent(),/周期境界 abc/);
 const cellBefore=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.cell));await page.click('#btnCenterOrigin');assert.ok(await page.evaluate(()=>{const c=MoleculeVisualizer.Geometry.centerOfMass(MoleculeVisualizer.App.getState().atoms);return Math.hypot(c.x,c.y,c.z)<1e-10;}));assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.cell)),cellBefore);await page.click('#btnUndo');
 await page.click('#btnViewXY');await page.locator('canvas').scrollIntoViewIfNeeded();const cb=await page.locator('canvas').boundingBox(),mx=cb.x+cb.width/2,my=cb.y+cb.height/2;await page.mouse.move(mx,my);await page.mouse.down();let cellTurn=0,lastCell={x:0,y:0,z:1};for(let i=1;i<=260;i++){await page.mouse.move(mx+10*i,my);const v=await page.evaluate(()=>MoleculeVisualizer.App.renderer().rotate({x:0,y:0,z:1}));cellTurn+=Math.acos(Math.max(-1,Math.min(1,lastCell.x*v.x+lastCell.y*v.y+lastCell.z*v.z)));lastCell=v;}await page.mouse.up();assert.ok(cellTurn>6*Math.PI);assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.cell)),cellBefore);
 await page.click('#btnZoomIn');await page.click('#btnResetCamera');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().zoom),1);await page.click('#btnToggleAxes');

 await page.click('#btnCell');await page.fill('#repeatCell','2 2 2');await page.click('#cellSuper');assert.match(await page.locator('#structureStats').textContent(),/16 原子/);
 await page.screenshot({path:'test-artifacts/periodic.png',fullPage:true});await page.click('#btnUndo');assert.match(await page.locator('#structureStats').textContent(),/2 原子/);
 await page.evaluate(()=>MoleculeVisualizer.App.loadText('1\nframe 1\nHe 0 0 0\n1\nframe 2\nHe 1 0 0\n'));await page.click('#frameNext');assert.equal(await page.locator('#frameLabel').textContent(),'2 / 2');
 await page.locator('canvas').click();await page.evaluate(()=>{const s=MoleculeVisualizer.App.getState();s.selectedAtomIds.add(s.atoms[0].id);MoleculeVisualizer.App.setState(s,true);});await page.locator('canvas').press('ArrowRight');assert.ok(await page.evaluate(()=>Math.abs(MoleculeVisualizer.App.getState().atoms[0].x-1.01)<1e-8));await page.click('#framePrev');await page.click('#frameNext');assert.ok(await page.evaluate(()=>Math.abs(MoleculeVisualizer.App.getState().atoms[0].x-1.01)<1e-8));
 await page.fill('#dataText','C 99 0 0');
 await page.click('#btnKetcher');await page.waitForFunction(()=>document.querySelector('#ketcherFrame').contentWindow.ketcher,{},{timeout:90000});
 await page.fill('#smilesText','C');await page.click('#chemReadSmiles');await page.waitForFunction(()=>document.querySelector('#chemMessage').textContent.includes('描画しました'));await page.click('#chemSmiles');await page.waitForFunction(()=>document.querySelector('#chemMessage').textContent.includes('変換しました'));assert.match(await page.locator('#smilesText').inputValue(),/C/);
 await page.screenshot({path:'test-artifacts/ketcher.png',fullPage:true});await page.fill('#smilesText','CCO');await page.click('#chemSmilesTo3D');
 await page.waitForFunction(()=>!document.querySelector('#chemDialog').open||document.querySelector('#statusBadge').classList.contains('error'),{},{timeout:130000});
 assert.equal(await page.locator('#chemDialog').evaluate(e=>e.open),false,await page.locator('#chemMessage').textContent());
 const atoms=await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms);assert.equal(atoms.length,9);assert.match(await page.locator('#dataText').inputValue(),/^9\n/);assert.ok(atoms.every(a=>[a.x,a.y,a.z].every(Number.isFinite)));
 assert.equal(await page.locator('#previousXYZDraft').inputValue(),'C 99 0 0');
 assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedAtoms.length),9);assert.equal(atoms.filter(a=>a.element==='H').length,6);
 for(const [smiles,count] of [['C',5],['C[C@H](O)C(=O)O',12]]){await page.click('#btnKetcher');await page.fill('#smilesText',smiles);await page.click('#chemSmilesTo3D');await page.waitForFunction(()=>!document.querySelector('#chemDialog').open||document.querySelector('#statusBadge').classList.contains('error'),{},{timeout:130000});assert.equal(await page.locator('#chemDialog').evaluate(e=>e.open),false,await page.locator('#chemMessage').textContent());assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedAtoms.length),count);}
 await page.click('#btnKetcher');await page.fill('#smilesText','C');await page.click('#chemReadSmiles');await page.waitForFunction(()=>document.querySelector('#chemMessage').textContent.includes('描画しました'));await page.click('#chemTo3D');await page.waitForFunction(()=>!document.querySelector('#chemDialog').open||document.querySelector('#statusBadge').classList.contains('error'),{},{timeout:130000});assert.equal(await page.locator('#chemDialog').evaluate(e=>e.open),false,await page.locator('#chemMessage').textContent());assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms.filter(a=>a.element==='H').length),4);const methane=await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms),carbon=methane.find(a=>a.element==='C'),hydrogens=methane.filter(a=>a.element==='H');for(const h of hydrogens){const d=Math.hypot(h.x-carbon.x,h.y-carbon.y,h.z-carbon.z);assert.ok(d>.9&&d<1.3,'generated C–H distance');}const v=hydrogens.slice(0,3).map(h=>[h.x-carbon.x,h.y-carbon.y,h.z-carbon.z]);const volume=v[0][0]*(v[1][1]*v[2][2]-v[1][2]*v[2][1])-v[0][1]*(v[1][0]*v[2][2]-v[1][2]*v[2][0])+v[0][2]*(v[1][0]*v[2][1]-v[1][1]*v[2][0]);assert.ok(Math.abs(volume)>.1,'methane must be tetrahedral, not a flat 2D drawing');

 await page.click('#btnKetcher');await page.fill('#smilesText','[13CH3:7]CO');await page.click('#chemSmilesTo3D');await page.waitForFunction(()=>!document.querySelector('#chemDialog').open||document.querySelector('#statusBadge').classList.contains('error'),{},{timeout:130000});assert.equal(await page.locator('#chemDialog').evaluate(e=>e.open),false,await page.locator('#chemMessage').textContent());assert.ok(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms.some(a=>a.mol?.props.MASS==='13')));
 const molDraft=await page.evaluate(()=>{const s=MoleculeVisualizer.IO.parseXYZToState('C 0 0 0\nO 1.4 0 0');s.atoms[0].mol={props:{MASS:'13',RAD:'2',CFG:'1'},map:7};s.bonds[0].order=2;s.bonds[0].source='manual';return MoleculeVisualizer.IO.stateToMolV3000Text(s);});await page.fill('#dataText',molDraft);await page.click('#dataApply');assert.equal(await page.locator('#coordinateFormat').inputValue(),'mol3000');assert.match(await page.locator('#dataText').inputValue(),/MASS=13/);assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].mol.map),7);assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().bonds[0].order),2);
 await page.fill('#dataText',(await page.locator('#dataText').inputValue()).replace('C 0.0000000000','C 2.0000000000'));await page.click('#dataApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),2);await page.click('#btnUndo');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),0);await page.selectOption('#coordinateFormat','xyz');await page.selectOption('#coordinateFormat','mol3000');assert.match(await page.locator('#dataText').inputValue(),/RAD=2/);await page.screenshot({path:'test-artifacts/mol3000.png',fullPage:true});await page.selectOption('#coordinateFormat','xyz');
 await page.fill('#dataText','C 1 2 3\nTV 4 0 0\nTV 1 5 0\nTV 2 3 6');await page.click('#dataApply');assert.match(await page.locator('#cellStatus').textContent(),/周期境界 abc/);await page.uncheck('#xyzHeader');assert.equal(((await page.locator('#dataText').inputValue()).match(/^TV /gm)||[]).length,3);await page.check('#xyzHeader');await page.click('#dataApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms.length),1);
 await page.screenshot({path:'test-artifacts/studio.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-artifacts/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 assert.deepEqual(errors,[]);console.log('PASS: periodic cell, supercell undo, trajectory editing, shortcuts, Ketcher SMILES, UFF 3D generation, mobile layout');await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
