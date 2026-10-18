const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1440}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
 assert.match(await page.locator('#structureStats').textContent(),/3 原子/);
 assert.ok((await page.locator('.mv-app').boundingBox()).y>=81);assert.ok((await page.locator('#structureTitle').boundingBox()).width>=530);assert.equal(await page.locator('.mv-subtitle').count(),0);
 await page.click('#btnToggleAxes');assert.equal(await page.locator('#btnToggleAxes').getAttribute('aria-pressed'),'true');await page.click('#btnToggleAxes');

 assert.equal(await page.locator('#coordX,#coordY,#coordZ').count(),0);
 const controls=await page.locator('#calculationControls').boundingBox(),viewer=await page.locator('#viewer').boundingBox();assert.ok(controls.y+controls.height<=viewer.y+1,'calculation controls must be above the viewer');
 assert.equal(await page.locator('#coordinatePanel').evaluate(e=>e.closest('[role=tabpanel]')),null);
 assert.equal(await page.locator('#coordinatePanel .mv-help').first().evaluate(e=>e.open),false);
 await page.click('#tab-bonds');assert.equal(await page.locator('#coordinatePanel').isVisible(),true);await page.click('#tab-atoms');
 await page.screenshot({path:'test-artifacts/controls-above-viewer.png'});
 // Workspace shortcuts navigate without replacing the coordinate draft.
 const draftBeforeJump=await page.locator('#dataText').inputValue();
 await page.locator('[data-workspace-jump=editing]').click();assert.equal(await page.locator('#tab-atoms').getAttribute('aria-selected'),'true');
 await page.locator('[data-workspace-jump=coordinates]').click();assert.equal(await page.locator('#dataText').evaluate(e=>document.activeElement===e),true);
 await page.locator('[data-workspace-jump=afir]').click();assert.equal(await page.locator('#afirPanel').isVisible(),true);
 await page.locator('[data-workspace-jump=editing]').click();assert.equal(await page.locator('#afirPanel').isVisible(),false);assert.equal(await page.locator('#dataText').inputValue(),draftBeforeJump);
 await page.locator('[data-workspace-jump=coordinates]').click();
 await page.screenshot({path:'test-artifacts/studio-workspace-desktop.png',fullPage:true});

 for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const left=await page.locator('.mv-stage').boundingBox(),right=await page.locator('#coordinatePanel').boundingBox();assert.ok(right.x>=left.x+left.width);
  const c=await page.locator('#calculationControls').boundingBox(),v=await page.locator('#viewer').boundingBox();assert.ok(c.y+c.height<=v.y+1);
  await page.screenshot({path:`test-artifacts/studio-${width}x${height}.png`});
 }
 await page.setViewportSize({width:1440,height:1440});
 // Resize the panel itself, keep headings usable, and contain wheel scrolling.
 const checkPanel=async(id,prefix)=>{
  const panel=page.locator('#'+id),draft=await page.locator('#dataText').inputValue();
  const atoms=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));
  await panel.scrollIntoViewIfNeeded();const start=await panel.boundingBox();
  await page.mouse.move(start.x+start.width-4,start.y+start.height-4);await page.mouse.down();
  await page.mouse.move(start.x+start.width-4,start.y+start.height-104,{steps:10});await page.mouse.up();
  const smaller=await panel.boundingBox();assert.ok(smaller.height<start.height-85,'native handle must shrink the whole panel');assert.ok(Math.abs(smaller.width-start.width)<1);
  await page.click('#'+prefix+'Taller');assert.ok(Math.abs((await panel.boundingBox()).height-smaller.height-80)<2);
  await page.locator('#'+prefix+'Shorter').focus();await page.keyboard.press('Enter');assert.ok(Math.abs((await panel.boundingBox()).height-smaller.height)<2);
  for(let i=0;i<8;i++)await page.click('#'+prefix+'Shorter');
  const small=await panel.boundingBox();assert.ok(Math.abs(small.height-240)<2);
  const top=await page.evaluate(()=>window.scrollY);await page.mouse.move(small.x+small.width-28,small.y+small.height-30);await page.mouse.wheel(0,2000);
  await page.waitForFunction(id=>{const e=document.getElementById(id);return e.scrollTop>0&&e.scrollTop+e.clientHeight>=e.scrollHeight-2;},id);
  await page.mouse.wheel(0,1000);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-top)<2,'wheel at panel boundary must not scroll the document');
  const heading=await panel.locator('.mv-scroll-panel-header').boundingBox();assert.ok(Math.abs(heading.y-small.y)<3,'heading must stay above scrolled content');
  await page.click('#'+prefix+'ResetHeight');assert.ok(Math.abs((await panel.boundingBox()).height-start.height)<2);
  assert.equal(await page.locator('#dataText').inputValue(),draft);assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),atoms);
  await page.screenshot({path:'test-artifacts/'+id+'-scroll.png'});
 };
 await checkPanel('coordinatePanel','coordinate');
 await page.click('#btnAFIR');await checkPanel('afirPanel','afir');await page.click('#afirClose');
 await page.fill('#dataText','O 2.5 0 0\nH .9572 0 0\nH -.239987 .926627 0');
 await page.click('#dataApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),2.5);
 await page.click('#btnUndo');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),0);


 await page.uncheck('#xyzHeader');assert.match(await page.locator('#dataText').inputValue(),/^O /);
 await page.fill('#dataText','O\u30000\t0 0\rH .9572 0 0\u2028H -.239987 .926627 0');await page.click('#dataApply');
 await page.check('#xyzHeader');assert.match(await page.locator('#dataText').inputValue(),/^3\n/);
 let bounds=await page.locator('canvas').boundingBox();
 await page.click('#btnViewXY');const unchanged=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
 await page.keyboard.down('Shift');await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+180,cy,{steps:12});await page.mouse.up();await page.keyboard.up('Shift');
 const rolled=await page.evaluate(()=>MoleculeVisualizer.App.renderer().rotate({x:1,y:0,z:0}));assert.ok(Math.abs(rolled.x-Math.cos(1.44))<1e-8&&Math.abs(rolled.y-Math.sin(1.44))<1e-8,'Shift drag provides explicit screen-normal roll');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),unchanged);
 // The same diagonal drag must not acquire edge roll or depend on event spacing.
 let referenceRotation;
 for(const [x,y,steps] of [[cx,cy,12],[bounds.x+12,bounds.y+12,1],[bounds.x+bounds.width-150,bounds.y+bounds.height-80,48]]){
  await page.click('#btnViewXY');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+120,y+48,{steps});await page.mouse.up();
  const q=await page.evaluate(()=>[...MoleculeVisualizer.App.renderer().orientation]);if(!referenceRotation)referenceRotation=q;q.forEach((v,i)=>assert.ok(Math.abs(v-referenceRotation[i])<1e-8,'center and edge drags must rotate identically'));
 }
 assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),unchanged);
 assert.match(await page.locator('#rotationHint').textContent(),/どこでも同じ感度/);
 await page.locator('#viewer').screenshot({path:'test-artifacts/free-rotation.png'});
 await page.click('#btnViewXY');
 // Pointer capture keeps delivering drag motion outside the canvas. Measure the
 // accumulated angle, since a final orientation alone cannot prove full turns.
 await page.mouse.move(cx,cy);await page.mouse.down();let turn=0,previous={x:0,y:0,z:1};
 for(let i=1;i<=260;i++){await page.mouse.move(cx+i*10,cy);const v=await page.evaluate(()=>MoleculeVisualizer.App.renderer().rotate({x:0,y:0,z:1}));turn+=Math.acos(Math.max(-1,Math.min(1,previous.x*v.x+previous.y*v.y+previous.z*v.z)));previous=v;}
 await page.mouse.up();assert.ok(turn>6*Math.PI,'a held drag must exceed three full turns');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),unchanged);await page.click('#btnViewXY');
 const picks=await page.evaluate(()=>MoleculeVisualizer.App.renderer().projectedAtoms.slice(0,2).map(p=>({id:p.atom.id,x:p.x,y:p.y})));
 for(const i of [0,1,1])await page.mouse.click(bounds.x+picks[i].x,bounds.y+picks[i].y,{button:'right'});
 assert.deepEqual(await page.evaluate(()=>[...MoleculeVisualizer.App.getState().selectedAtomIds]),[picks[0].id]);await page.click('#btnClearSel');
 // Toolbar actions may scroll the page; always use the current canvas bounds.
 await page.locator('canvas').scrollIntoViewIfNeeded();bounds=await page.locator('canvas').boundingBox();
 // Separate rectangles always accumulate, even without multi-select or modifiers.
 for(const i of [0,1,0]){
  await page.mouse.move(bounds.x+picks[i].x-6,bounds.y+picks[i].y-6);await page.mouse.down({button:'right'});await page.mouse.move(bounds.x+picks[i].x+6,bounds.y+picks[i].y+6,{steps:3});await page.mouse.up({button:'right'});
 }
 assert.deepEqual(await page.evaluate(()=>[...MoleculeVisualizer.App.getState().selectedAtomIds]),picks.map(p=>p.id));

 await page.mouse.move(bounds.x+5,bounds.y+5);await page.mouse.down({button:'right'});await page.mouse.move(bounds.x+bounds.width-5,bounds.y+bounds.height-5,{steps:6});await page.mouse.up({button:'right'});
 assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().selectedAtomIds.size),3);
 const original=await page.evaluate(()=>({atoms:MoleculeVisualizer.App.getState().atoms.map(a=>({...a})),orientation:MoleculeVisualizer.App.renderer().orientation.slice()}));
 const altDrag=async button=>{await page.locator('canvas').scrollIntoViewIfNeeded();bounds=await page.locator('canvas').boundingBox();await page.keyboard.down('Alt');await page.mouse.move(bounds.x+20,bounds.y+20);await page.mouse.down({button});await page.mouse.move(bounds.x+65,bounds.y+45,{steps:6});await page.mouse.up({button});await page.keyboard.up('Alt');};
 await altDrag('left');assert.notEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),original.atoms[0].x);await page.click('#btnUndo');
 await altDrag('right');assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.renderer().orientation),original.orientation);
 assert.notEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[1].z),original.atoms[1].z);await page.click('#btnUndo');await page.click('#btnClearSel');
 await page.click('#sampleCrystal');assert.match(await page.locator('#cellStatus').textContent(),/周期境界 abc/);
 const cellBefore=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.cell));await page.locator('#viewOptions>summary').click();await page.click('#btnCenterOrigin');assert.ok(await page.evaluate(()=>{const c=MoleculeVisualizer.Geometry.centerOfMass(MoleculeVisualizer.App.getState().atoms);return Math.hypot(c.x,c.y,c.z)<1e-10;}));assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().metadata.cell)),cellBefore);await page.click('#btnUndo');await page.locator('#viewOptions>summary').click();
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
 // Advanced controls: actual worker generation, projection, undo and stale-result protection.
 for(const id of ['indene','fluorene','norbornene','adamantane','cubane','anthracene','biphenyl','caffeine','aspirin','crown']){
   await page.selectOption('#complexSample',id);await page.click('#loadComplexSample');await page.waitForFunction(()=>!document.querySelector('#loadComplexSample').disabled,{},{timeout:130000});
   const result=await page.evaluate(id=>{const s=MoleculeVisualizer.App.getState(),sample=MoleculeVisualizer.Advanced.samples.find(v=>v[0]===id);return {title:s.metadata.title,name:sample[1],c:s.atoms.filter(a=>a.element==='C').length,h:s.atoms.filter(a=>a.element==='H').length,expected:sample.slice(3),finite:s.atoms.every(a=>[a.x,a.y,a.z].every(Number.isFinite))};},id);
   assert.equal(result.title,result.name,await page.locator('#statusBadge').textContent());assert.deepEqual([result.c,result.h],result.expected);assert.ok(result.finite);
 }
 await page.selectOption('#complexSample','adamantane');await page.click('#loadComplexSample');await page.waitForFunction(()=>!document.querySelector('#loadComplexSample').disabled);
 await page.locator('#viewOptions summary').first().click();await page.selectOption('#projectionMode','perspective');await page.locator('#cameraFov').fill('70');await page.locator('#cameraFov').dispatchEvent('input');assert.equal(await page.locator('#cameraFovValue').textContent(),'70°');
 if(await page.locator('#btnToggleAxes').getAttribute('aria-pressed')!=='true')await page.click('#btnToggleAxes');
 const cameraBefore=await page.evaluate(()=>({q:[...MoleculeVisualizer.App.renderer().orientation],direction:MoleculeVisualizer.App.renderer().viewVectorToWorld([0,0,1]),atoms:JSON.stringify(MoleculeVisualizer.App.getState().atoms)}));
 await page.locator('canvas').scrollIntoViewIfNeeded();const rollBox=await page.locator('canvas').boundingBox();await page.keyboard.down('Shift');await page.mouse.move(rollBox.x+rollBox.width/2,rollBox.y+rollBox.height/2);await page.mouse.down();await page.mouse.move(rollBox.x+rollBox.width/2+110,rollBox.y+rollBox.height/2,{steps:10});await page.mouse.up();await page.keyboard.up('Shift');
 const cameraAfter=await page.evaluate(()=>({q:[...MoleculeVisualizer.App.renderer().orientation],direction:MoleculeVisualizer.App.renderer().viewVectorToWorld([0,0,1]),atoms:JSON.stringify(MoleculeVisualizer.App.getState().atoms)}));assert.notDeepEqual(cameraAfter.q,cameraBefore.q);assert.equal(cameraAfter.atoms,cameraBefore.atoms);cameraAfter.direction.forEach((v,i)=>assert.ok(Math.abs(v-cameraBefore.direction[i])<1e-9));
 await page.screenshot({path:'test-artifacts/advanced.png',fullPage:true});
 await page.evaluate(()=>{const a=MoleculeVisualizer.App;a.change('distort',s=>{s.atoms[0].x+=1.2;});});const distorted=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));
 await page.click('#btnRelax');await page.waitForFunction(()=>!document.querySelector('#btnRelax').disabled);assert.match(await page.locator('#statusBadge').textContent(),/構造を整えました/);assert.notEqual(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),distorted);await page.click('#btnUndo');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),distorted);
 await page.evaluate(()=>{MoleculeVisualizer.Advanced.relax();MoleculeVisualizer.Advanced.cancel();});assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),distorted);
 await page.evaluate(()=>{MoleculeVisualizer.Advanced.relax();MoleculeVisualizer.App.change('edit while busy',s=>{s.atoms[0].x+=.25;});});const editedWhileBusy=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));await page.waitForFunction(()=>!document.querySelector('#btnRelax').disabled);assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),editedWhileBusy);assert.match(await page.locator('#statusBadge').textContent(),/結果は適用しませんでした/);

 // Text format import and trajectory-generation UI/worker regression coverage.
 const cifText='data_symmetric\n_cell_length_a 8\n_cell_length_b 9\n_cell_length_c 10\n_cell_angle_alpha 90\n_cell_angle_beta 100\n_cell_angle_gamma 90\nloop_\n_space_group_symop_operation_xyz\n\'x,y,z\'\n\'-x,-y,-z\'\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nC .1 .2 .3\nO 0 0 0\n';
 await page.click('#dataReset');await page.fill('#dataText',cifText);await page.click('#dataApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms.length),3);assert.match(await page.locator('#dataText').inputValue(),/TV /);assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.sourceFormat),'cif');
 const multiSdf=await page.evaluate(()=>{const m=MoleculeVisualizer,s=m.IO.parseXYZToState('C 0 0 0\nO 1.2 0 0');s.bonds[0].order=2;return m.IO.stateToSDFText(s)+m.IO.stateToSDFText(s);});await page.fill('#dataText',multiSdf);await page.click('#dataApply');assert.equal(await page.locator('#frameLabel').textContent(),'1 / 2');await page.click('#frameNext');assert.equal(await page.locator('#frameLabel').textContent(),'2 / 2');
 await page.fill('#dataText','#p hf/sto-3g\n\nwater\n\n0 1\nO 0 0 0\nH .96 0 0\nH -.24 .93 0\n\n');await page.click('#dataApply');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.sourceFormat),'gaussian');
 await page.click('#btnRandomStructures');await page.selectOption('#randomMode','orientation');await page.fill('#generationCount','20');await page.click('#generationRun');await page.waitForFunction(()=>!document.querySelector('#generationDialog').open||!document.querySelector('#generationRun').disabled);assert.equal(await page.locator('#generationDialog').evaluate(e=>e.open),false,await page.locator('#generationMessage').textContent());assert.equal(await page.locator('#frameLabel').textContent(),'1 / 20');await page.click('#frameNext');assert.equal(await page.locator('#frameLabel').textContent(),'2 / 20');
 await page.click('#btnUndo');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.sourceFormat),'gaussian');assert.equal(await page.locator('#frameLabel').textContent(),'1 / 1');
 await page.click('#btnReactionPath');await page.fill('#pathStart','C -1 0 0\nC 1 0 0');await page.fill('#pathEnd','C 1 0 0\nN -1 0 0');await page.fill('#generationCount','5');await page.click('#generationRun');await page.waitForFunction(()=>!document.querySelector('#generationRun').disabled);assert.match(await page.locator('#generationMessage').textContent(),/File-order/);
 await page.fill('#pathEnd','C 1 0 0\nC -1 0 0');await page.screenshot({path:'test-artifacts/path-dialog.png',fullPage:true});await page.click('#generationRun');await page.waitForFunction(()=>!document.querySelector('#generationDialog').open||!document.querySelector('#generationRun').disabled);assert.equal(await page.locator('#generationDialog').evaluate(e=>e.open),false,await page.locator('#generationMessage').textContent());assert.equal(await page.locator('#frameLabel').textContent(),'1 / 5');assert.equal(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[0].x),-1);await page.click('#frameNext');await page.click('#frameNext');assert.ok(await page.evaluate(()=>{const s=MoleculeVisualizer.App.getState();return MoleculeVisualizer.Geometry.distance(...s.atoms)>1.5;}));
 await page.click('#btnExport');const downloadPath=page.waitForEvent('download');await page.click('#allFrames');const generatedFile=await downloadPath;const output=fs.readFileSync(await generatedFile.path(),'utf8');assert.equal((output.match(/^2$/gm)||[]).length,5);await page.locator('#exportDialog [data-close]').click();
 await page.click('#btnRandomStructures');await page.selectOption('#randomMode','orientation');await page.fill('#generationCount','21');await page.click('#generationRun');assert.match(await page.locator('#generationMessage').textContent(),/20/);await page.fill('#generationCount','5');await page.evaluate(()=>{MoleculeVisualizer.GeneratorUI.run();MoleculeVisualizer.GeneratorUI.cancel();});assert.match(await page.locator('#generationMessage').textContent(),/中止/);await page.locator('#generationDialog [data-close]').click();assert.equal(await page.locator('#frameLabel').textContent(),'3 / 5');

 // Canvas shortcuts: one-edge expansion, connected-only selection and rigid B-side edits.
 await page.click('#dataReset');
 await page.evaluate(()=>{const m=MoleculeVisualizer,s=m.Model.createState({atoms:[{id:'A',element:'C',x:0,y:0,z:0},{id:'B',element:'C',x:1.5,y:0,z:0},{id:'C',element:'H',x:1.5,y:1,z:0},{id:'D',element:'H',x:1.5,y:0,z:1},{id:'F',element:'H',x:-1,y:0,z:0},{id:'X',element:'He',x:8,y:0,z:0}],bonds:[['A','B'],['B','C'],['B','D'],['A','F']].map(([atom1,atom2])=>({atom1,atom2})),selectedAtomIds:['A']});m.App.setState(s,false);});
 const keys=page.locator('canvas'),selected=()=>page.evaluate(()=>[...MoleculeVisualizer.App.getState().selectedAtomIds].sort());
 await keys.press('Control+e');assert.deepEqual(await selected(),['A','B','F']);
 await keys.press('Control+w');assert.deepEqual(await selected(),['A','B','C','D','F']);
 await keys.press('Control+r');assert.deepEqual(await selected(),['X']);await keys.press('Control+a');assert.equal((await selected()).length,6);
 await page.evaluate(()=>{const a=MoleculeVisualizer.App,s=a.getState();s.selectedAtomIds=new Set(['A','B']);a.setState(s,true);});
 const shortcutBefore=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));
 await keys.press(']');assert.ok(Math.abs(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[2].z)-Math.sin(5*Math.PI/180))<1e-10);
 await keys.press('Control+z');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),shortcutBefore);
 await keys.press('.');assert.ok(Math.abs(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[1].x)-1.6)<1e-10);await keys.press(',');
 // Repeated keydown events while the physical key remains down must share one undo entry.
 const heldBefore=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));
 for(let i=0;i<6;i++)await page.keyboard.down(']');await page.keyboard.up(']');
 const heldAfter=await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms));
 assert.ok(Math.abs(JSON.parse(heldAfter)[2].z-Math.sin(30*Math.PI/180))<1e-10);
 await keys.press('Control+z');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),heldBefore);
 await keys.press('Control+Shift+z');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),heldAfter);
 for(let i=0;i<4;i++)await page.keyboard.down('.');await page.keyboard.up('.');
 assert.ok(Math.abs(await page.evaluate(()=>MoleculeVisualizer.App.getState().atoms[1].x)-1.9)<1e-10);
 await keys.press('Control+z');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),heldAfter);
 await page.keyboard.down('.');await page.keyboard.down('.');await page.locator('#dataText').focus();await page.keyboard.up('.');
 await keys.press('Control+z');assert.equal(await page.evaluate(()=>JSON.stringify(MoleculeVisualizer.App.getState().atoms)),heldAfter);
 await page.click('#btnHelp');assert.match(await page.locator('#helpDialog').textContent(),/Ctrl\+E/);assert.match(await page.locator('#helpDialog').textContent(),/0.1 Å/);
 assert.match(await page.locator('#helpDialog').textContent(),/長押し前の構造/);
 await page.screenshot({path:'test-artifacts/keyboard-help.png',fullPage:true});await page.locator('#helpDialog [data-close]').click();
 await page.screenshot({path:'test-artifacts/studio.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 for(const [id,prefix] of [['coordinatePanel','coordinate'],['afirPanel','afir']]){
  if(prefix==='afir')await page.click('#btnAFIR');const panel=page.locator('#'+id);await panel.scrollIntoViewIfNeeded();
  const before=await panel.boundingBox();await page.click('#'+prefix+'Shorter');assert.ok((await panel.boundingBox()).height<before.height-70);
  await page.click('#'+prefix+'Taller');assert.ok(Math.abs((await panel.boundingBox()).height-before.height)<2);
  assert.ok(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:'test-artifacts/'+id+'-mobile.png'});
  if(prefix==='afir')await page.click('#afirClose');
 }
 await page.screenshot({path:'test-artifacts/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 assert.deepEqual(errors,[]);console.log('PASS: periodic cell, supercell undo, trajectory editing, shortcuts, Ketcher SMILES, UFF 3D generation, mobile layout');await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
