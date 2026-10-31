// Browser-independent integration checks; a visual browser pass is still required.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function boot(afir=false,profile=false,modes=false,storage=null,constraints=false){
 const saved=new Map();storage??={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
 const nodes=new Map(),doc={activeElement:null,events:{},addEventListener(t,f){(this.events[t]??=[]).push(f);}};
 class El{
  constructor(id=''){this.id=id;this.value='';this.children=[];this.events={};this.dataset={};this.attrs={};this.style={};this.checked=false;this.open=false;this.classList={toggle(){},add(){},remove(){}};this.clientWidth=800;this.clientHeight=500;this.tagName='DIV';}
  appendChild(x){this.children.push(x);return x;}append(...xs){xs.forEach(x=>this.appendChild(x));}removeChild(x){this.children=this.children.filter(c=>c!==x);}replaceChildren(...xs){this.children=xs;if(xs[0]?.value)this.value=xs[0].value;}
  set innerHTML(v){this.children=[];}get innerHTML(){return '';}
  setAttribute(k,v){this.attrs[k]=v;}addEventListener(t,f){(this.events[t]??=[]).push(f);}getBoundingClientRect(){return {width:800,height:500,left:0,top:0};}setPointerCapture(){}focus(){doc.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;}scrollIntoView(){}contains(){return false;}
  getContext(){return new Proxy({createRadialGradient(){return {addColorStop(){}};}},{get:(o,k)=>o[k]||(()=>{})});}
  querySelectorAll(){return [...nodes.values()].filter(e=>/^constraint/.test(e.id)&&['INPUT','BUTTON','SELECT'].includes(e.tagName));}
  toDataURL(){return 'data:image/png;base64,';}fire(type,extra={}){const e={type,target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},stopImmediatePropagation(){},...extra};for(const f of this.events[type]||[])f(e);return e;}click(){this.fire('click');}
 }
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 for(const m of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const e=new El(m[3]);e.tagName=m[1].toUpperCase();e.value=m[2].match(/value="([^"]*)"/)?.[1]||'';e.dataset.tab=m[2].match(/data-tab="([^"]*)"/)?.[1];nodes.set(m[3],e);}
 for(const [k,v] of Object.entries({bondOrder:'1',bondType:'covalent',styleSelect:'stickball',addMode:'custom',fragPlace:'offset',fragScale:'1',fragAnchorIndex:'1',fragBondDistance:'1.45',fragBondOrder:'1'}))nodes.get(k).value=v;
 const app=new El();doc.getElementById=id=>nodes.get(id)||null;doc.createElement=()=>new El();doc.body=new El();
 doc.createElementNS=()=>new El();
 const tables={'#atomTable tbody':new El(),'#bondTable tbody':new El()};
 doc.querySelector=q=>tables[q]||((q==='.mv-app'||q==='.mv-inspector')?app:q==='dialog[open]'?[...nodes.values()].find(x=>x.open):null);
 doc.querySelectorAll=q=>q==='[data-tab]'?[...nodes.values()].filter(x=>x.dataset.tab):q==='dialog'?[...nodes.values()].filter(x=>x.tagName==='DIALOG'):[];
 const timers=new Map();let seq=0;const win={document:doc,devicePixelRatio:1,events:{},addEventListener(t,f){(this.events[t]??=[]).push(f);}};
 const ctx={window:win,document:doc,navigator:{clipboard:{writeText:async()=>{}}},localStorage:storage,setTimeout(f){timers.set(++seq,f);return seq;},clearTimeout(i){timers.delete(i);},Blob,URL,console};
 vm.createContext(ctx);for(const f of ['model','bonding','geometry','io','molfile','periodic','formats','history','fragment-clipboard','renderer3dmol','ui'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);
 if(constraints)for(const f of ['constraints','constraints-ui'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);
 if(profile){ctx.setInterval=ctx.setTimeout;ctx.clearInterval=ctx.clearTimeout;for(const f of ['studio','trajectory','trajectory-ui','energy-profile'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);}
 if(modes)for(const f of ['vibration-ui','path-refinement'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);
 if(afir)for(const f of ['afir','afir-ui'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);win.MoleculeVisualizer.App.init();if(constraints)win.MoleculeVisualizer.ConstraintUI.init();if(profile){win.MoleculeVisualizer.Studio.init();win.MoleculeVisualizer.EnergyProfile.init();win.MoleculeVisualizer.TrajectoryUI.init();}if(afir)win.MoleculeVisualizer.AFIRUI.init();if(modes)win.MoleculeVisualizer.VibrationUI.init();return {MV:win.MoleculeVisualizer,nodes,doc,win,timers,storage,navigator:ctx.navigator,canvas:nodes.get('viewer').children[0]};
}
test('table rows survive selection and edits, with current handlers after undo and reorder',()=>{
 const {MV,nodes,doc}=boot(),app=MV.App;
 const atomBody=doc.querySelector('#atomTable tbody'),bondBody=doc.querySelector('#bondTable tbody');
 const atomRows=atomBody.children.slice(),bondRows=bondBody.children.slice(),first=atomRows[0],checkbox=first.children.at(-1).children[0];
 checkbox.focus();checkbox.checked=true;checkbox.fire('change');
 assert.equal(atomBody.children[0],first);assert.equal(doc.activeElement,checkbox);assert.equal(checkbox.checked,true);
 assert.equal(bondBody.children[0],bondRows[0]);assert.equal(checkbox.events.change.length,1);
 const edited=MV.Model.cloneEditableState(app.getState());edited.atoms[0].x=2;edited.bonds[0].order=3;
 app.change('table edit',()=>edited,true);
 assert.equal(atomBody.children[0],first);assert.equal(first.children[2].textContent,'2.000');
 bondRows[0].click();assert.equal(nodes.get('bondOrder').value,'3');
 nodes.get('btnUndo').click();assert.equal(atomBody.children[0],first);assert.equal(first.children[2].textContent,'0.000');
 bondRows[0].click();assert.equal(nodes.get('bondOrder').value,'1');
 const reordered=MV.Model.cloneEditableState(app.getState());reordered.atoms.reverse();app.setState(reordered,true);
 assert.equal(atomBody.children.at(-1),first);assert.equal(checkbox.attrs['aria-label'],'3番を選択');
 assert.match(bondBody.children[0].children[1].textContent,/^3:O$/);
 const removedId=reordered.atoms[0].id;MV.Model.setSelectedAtoms(reordered,[removedId]);MV.Model.removeSelectedAtoms(reordered);app.setState(reordered,true);
 assert.equal(atomBody.children.length,2);assert.equal(atomBody.children.includes(atomRows[2]),false);
 assert.equal(atomBody.children.at(-1),first);assert.equal(checkbox.events.change.length,1);
});
test('app loads, atom edit/undo, invalid import is non-destructive, export uses latest state',()=>{const {MV,nodes}=boot(),app=MV.App;assert.equal(app.getState().atoms.length,3);assert.equal(nodes.get('statusBadge').classList!==null,true);
 const s=app.getState();s.selectedAtomIds.add(s.atoms[0].id);app.setState(s,true);nodes.get('dataText').value='O 2.5 0 0\nH .9572 0 0\nH -.239987 .926627 0';nodes.get('dataText').fire('input');nodes.get('dataApply').click();assert.equal(app.getState().atoms[0].x,2.5);nodes.get('btnUndo').click();assert.equal(app.getState().atoms[0].x,0);
 nodes.get('dataText').value='invalid';nodes.get('dataText').fire('input');nodes.get('dataApply').click();assert.equal(app.getState().atoms[0].x,0);assert.equal(nodes.get('dataText').value,'invalid');nodes.get('dataReset').click();assert.match(nodes.get('dataText').value,/O /);
 nodes.get('xyz_input').value='2\n\nH 0 0 0';nodes.get('btnRender').click();assert.equal(app.getState().atoms.length,3);nodes.get('xyz_input').value='1\n\nHe 1 2 3';nodes.get('btnRender').click();assert.equal(app.getState().atoms[0].element,'He');nodes.get('btnExport').click();assert.match(nodes.get('exportText').value,/He 1.00000000/);
 nodes.get('btnNew').click();assert.equal(app.getState().atoms.length,0);nodes.get('btnUndo').click();assert.equal(app.getState().atoms.length,1);
});
test('selection drag rotates; explicit move changes coordinates, cancelled pointer ends safely',()=>{const {MV,canvas,nodes}=boot();const s=MV.App.getState();const before=JSON.stringify(s.atoms);canvas.fire('pointerdown',{pointerId:1,clientX:400,clientY:250,button:0});canvas.fire('pointermove',{pointerId:1,clientX:420,clientY:265});canvas.fire('pointerup',{pointerId:1,clientX:420,clientY:265});assert.equal(JSON.stringify(s.atoms),before);
 const R=MV.Renderer3DMol,r=new R('viewer');r.ensureViewer();r.renderState(s,false);const p=r.projectedAtoms[0];let starts=0,moves=0,ends=0;r.onAtomDragStart=()=>starts++;r.onAtomsDrag=()=>moves++;r.onDragEnd=()=>ends++;r.setInteractionMode('move');r.canvas.fire('pointerdown',{pointerId:2,clientX:p.x,clientY:p.y,button:0});r.canvas.fire('pointermove',{pointerId:2,clientX:p.x+1,clientY:p.y+1});assert.equal(starts,0);r.canvas.fire('pointermove',{pointerId:2,clientX:p.x+20,clientY:p.y+10});r.canvas.fire('pointercancel',{pointerId:2});assert.equal(starts,1);assert.equal(moves,1);assert.equal(ends,1);
 s.viewSettings.style='wire';r.draw();const wire=r.projectedAtoms[0].radius;s.viewSettings.style='vdw';r.draw();assert.ok(r.projectedAtoms[0].radius>wire);assert.equal(r.pickBond(0,0),null);
});
test('header toggle preserves pending coordinates and invalid drafts',()=>{
 const {MV,nodes}=boot(),box=nodes.get('dataText'),header=nodes.get('xyzHeader');
 header.checked=true;header.fire('change');assert.match(box.value,/^3\n/);
 header.checked=false;header.fire('change');assert.match(box.value,/^O /);
 box.value='O\u30002.5\t0 0\rH .9572 0 0\rH -.239987 .926627 0';box.fire('input');
 header.checked=true;header.fire('change');assert.match(box.value,/^3\n/);nodes.get('dataApply').click();assert.equal(MV.App.getState().atoms[0].x,2.5);
 box.value='bad';box.fire('input');header.checked=false;header.fire('change');assert.equal(header.checked,true);assert.equal(box.value,'bad');
});
test('display preferences default on, persist independently and reject an invalid header change',()=>{
 const {nodes,storage}=boot(),ids=['engineLive','afirLive','xyzHeader'];
 for(const id of ids){assert.equal(nodes.get(id).checked,true);nodes.get(id).checked=false;nodes.get(id).fire('change');}
 const restored=boot(false,false,false,storage);
 for(const id of ids)assert.equal(restored.nodes.get(id).checked,false);
 assert.match(restored.nodes.get('dataText').value,/^O /);
 restored.nodes.get('engineLive').checked=true;restored.nodes.get('engineLive').fire('change');
 restored.nodes.get('dataText').value='bad';restored.nodes.get('dataText').fire('input');
 restored.nodes.get('xyzHeader').checked=true;restored.nodes.get('xyzHeader').fire('change');
 assert.equal(restored.nodes.get('xyzHeader').checked,false);
 const again=boot(false,false,false,storage);
 assert.equal(again.nodes.get('engineLive').checked,true);assert.equal(again.nodes.get('afirLive').checked,false);assert.equal(again.nodes.get('xyzHeader').checked,false);
});
test('display preferences tolerate malformed, partial and blocked browser storage',()=>{
 for(const value of ['bad','null','[]','{"engineLive":false,"afirLive":"false"}']){
  const {nodes}=boot(false,false,false,{getItem:key=>key==='molecule-studio-display-v1'?value:null,setItem(){}});
  assert.equal(nodes.get('engineLive').checked,!value.includes('engineLive'));assert.equal(nodes.get('afirLive').checked,true);assert.equal(nodes.get('xyzHeader').checked,true);
 }
 const {MV,nodes}=boot(false,false,false,{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});
 MV.App.loadText('O 0 0 0\nH .9572 0 0\nH -.239987 .926627 0');
 nodes.get('engineLive').checked=false;nodes.get('engineLive').fire('change');
 nodes.get('xyzHeader').checked=false;nodes.get('xyzHeader').fire('change');
 assert.equal(nodes.get('engineLive').checked,false);assert.match(nodes.get('dataText').value,/^O /);
});
test('right rectangle and Alt gestures transform only target groups with undo',()=>{
 const {MV,nodes,canvas}=boot(),app=MV.App,r=app.renderer();
 const s=MV.IO.parseXYZToState('4\n\nO 0 0 0\nH .95 0 0\nH -.24 .92 0\nHe 6 0 0\n');app.setState(s,false);
 const gesture=(button,alt,x,y,dx,dy)=>{canvas.fire('pointerdown',{pointerId:9,button,altKey:alt,clientX:x,clientY:y});canvas.fire('pointermove',{pointerId:9,button,altKey:alt,clientX:x+dx,clientY:y+dy});canvas.fire('pointerup',{pointerId:9,button,altKey:alt,clientX:x+dx,clientY:y+dy});};
 let p=r.projectedAtoms[0];const before=s.atoms.map(a=>({...a}));gesture(0,true,p.x,p.y,25,10);let moved=app.getState();assert.notEqual(moved.atoms[0].x,before[0].x);assert.equal(moved.atoms[3].x,before[3].x);assert.ok(Math.abs((moved.atoms[1].x-before[1].x)-(moved.atoms[0].x-before[0].x))<1e-9);nodes.get('btnUndo').click();assert.equal(app.getState().atoms[0].x,0);
 const current=app.getState();current.selectedAtomIds=new Set(current.atoms.slice(0,3).map(a=>a.id));app.setState(current,true);const oldRot=JSON.stringify(r.orientation),oldDistance=MV.Geometry.distance(current.atoms[0],current.atoms[1]);gesture(2,true,20,20,40,25);assert.equal(JSON.stringify(r.orientation),oldRot);assert.ok(Math.abs(MV.Geometry.distance(current.atoms[0],current.atoms[1])-oldDistance)<1e-9);assert.equal(current.atoms[3].x,6);assert.notEqual(current.atoms[1].y,0);nodes.get('btnUndo').click();
 const old=JSON.stringify(app.getState().atoms);nodes.get('btnClearSel').click();
 for(const index of [0,3,0]){const point=r.projectedAtoms.find(p=>p.atom.id===app.getState().atoms[index].id);gesture(2,false,point.x-4,point.y-4,8,8);}
 assert.deepEqual([...app.getState().selectedAtomIds],[app.getState().atoms[0].id,app.getState().atoms[3].id]);
 gesture(2,false,0,0,8,8);assert.equal(app.getState().selectedAtomIds.size,2);
 gesture(2,false,0,0,800,500);assert.equal(app.getState().selectedAtomIds.size,4);assert.equal(JSON.stringify(app.getState().atoms),old);
});
test('right click toggles only the clicked atom; cancel preserves selection',()=>{
 const {MV,canvas}=boot(),r=MV.App.renderer(),s=MV.App.getState();
 s.selectedAtomIds=new Set([s.atoms[0].id]);MV.App.setState(s,true);const p=r.projectedAtoms[1];
 const click=end=>{canvas.fire('pointerdown',{pointerId:11,button:2,clientX:p.x,clientY:p.y});canvas.fire(end,{pointerId:11,button:2,clientX:p.x,clientY:p.y});};
 click('pointercancel');assert.equal(s.selectedAtomIds.size,1);click('pointerup');assert.equal(s.selectedAtomIds.size,2);assert.ok(s.selectedAtomIds.has(s.atoms[0].id));click('pointercancel');assert.equal(s.selectedAtomIds.size,2);click('pointerup');assert.deepEqual([...s.selectedAtomIds],[s.atoms[0].id]);click('pointerup');assert.equal(s.selectedAtomIds.size,2);
});
test('coordinate editor accepts V3000, applies bonds and attributes, switches format, and undoes',()=>{
 const {MV,nodes}=boot(),app=MV.App,s=MV.IO.parseXYZToState('C 0 0 0\nO 1.4 0 0');s.atoms[0].mol={props:{MASS:'13',RAD:'2',CFG:'1'},map:7};s.bonds[0].order=2;s.bonds[0].source='manual';
 const box=nodes.get('dataText');box.value=MV.IO.stateToMolV3000Text(s);box.fire('input');nodes.get('dataApply').click();assert.equal(app.getState().atoms.length,2);assert.equal(app.getState().atoms[0].mol.props.MASS,'13');assert.equal(app.getState().bonds[0].order,2);assert.equal(nodes.get('coordinateFormat').value,'mol3000');assert.match(box.value,/V3000/);
 box.value=box.value.replace('C 0.0000000000','C 2.0000000000');box.fire('input');nodes.get('dataApply').click();assert.equal(app.getState().atoms[0].x,2);nodes.get('btnUndo').click();assert.equal(app.getState().atoms[0].x,0);assert.equal(app.getState().atoms[0].mol.map,7);
 nodes.get('coordinateFormat').value='xyz';nodes.get('coordinateFormat').fire('change');assert.doesNotMatch(box.value,/V3000/);nodes.get('coordinateFormat').value='mol3000';nodes.get('coordinateFormat').fire('change');assert.match(box.value,/MASS=13/);
 const before=app.getState();box.value=box.value.replace('END CTAB','END WRONG');box.fire('input');nodes.get('dataApply').click();assert.equal(app.getState(),before);assert.match(box.value,/WRONG/);
});
test('free rotation reaches roll and inverted orientations without changing coordinates; inverse stays stable',()=>{
 const {MV,canvas,nodes}=boot(),r=MV.App.renderer(),before=JSON.stringify(MV.App.getState().atoms);
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`),drag=(x,y,u,v,shiftKey=false)=>{canvas.fire('pointerdown',{pointerId:21,button:0,shiftKey,clientX:x,clientY:y});canvas.fire('pointermove',{pointerId:21,clientX:u,clientY:v});canvas.fire('pointerup',{pointerId:21,clientX:u,clientY:v});};
 nodes.get('btnViewXY').click();drag(400,250,400+Math.PI/(2*.008),250,true);let p=r.rotate({x:1,y:0,z:0});near(p.x,0);near(p.y,1);near(p.z,0);p=r.rotate({x:0,y:0,z:1});near(p.z,1); // Explicit 90-degree roll, without changing the viewing direction.
 nodes.get('btnViewXY').click();drag(400,250,400+Math.PI/.008,250);p=r.rotate({x:0,y:0,z:1});near(p.z,-1); // Complete inversion, crossing the old poles.
 drag(400,250,400,100);assert.ok(Math.abs(r.rotate({x:0,y:0,z:1}).y)>.1);
 for(let i=0;i<5000;i++)r.rotateTrackball(400,250,400+80*Math.sin(i),250+70*Math.cos(i));
 near(Math.hypot(...r.orientation),1);const v=[.7,-2.1,3.2],w=r.rotate({x:v[0],y:v[1],z:v[2]});r.viewVectorToWorld([w.x,w.y,w.z]).forEach((x,i)=>near(x,v[i]));
 const delta=r.screenDeltaToWorld(24,-16,false),screen=r.rotate(delta);near(screen.x,24/r.currentScale);near(screen.y,16/r.currentScale);near(screen.z,0);
 const basis=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}].map(v=>r.rotate(v));for(let i=0;i<3;i++)for(let j=0;j<3;j++)near(basis[i].x*basis[j].x+basis[i].y*basis[j].y+basis[i].z*basis[j].z,i===j?1:0);
 assert.equal(JSON.stringify(MV.App.getState().atoms),before);nodes.get('btnViewXY').click();near(r.rotate({x:1,y:2,z:3}).y,2);
 r.rotateTrackball(175,250,625,250);near(Math.hypot(...r.orientation),1); // Single-event drag across the canvas.
});

test('equal drags give equal rotations at the center and edges, after pan/zoom, with any event spacing',()=>{
 const {MV,canvas}=boot(),r=MV.App.renderer(),s=MV.App.getState(),before=JSON.stringify(s.atoms);let expected;
 for(const [x,y,panX,panY,zoom,projection] of [[400,250,0,0,1,'orthographic'],[15,15,0,0,1,'orthographic'],[700,440,180,-90,3,'perspective']]){
  for(const steps of [1,2,12,120]){
   r.setViewAngles(-.45,.65);r.panX=panX;r.panY=panY;r.zoom=zoom;s.viewSettings.projection=projection;r.draw();
   canvas.fire('pointerdown',{pointerId:27,button:0,clientX:x,clientY:y});
   for(let i=1;i<=steps;i++)canvas.fire('pointermove',{pointerId:27,clientX:x+120*i/steps,clientY:y+48*i/steps});
   canvas.fire('pointerup',{pointerId:27});
   if(!expected)expected=[...r.orientation];r.orientation.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-9,'cursor position and pointer event frequency must not change a straight drag'));
  }
 }
 assert.equal(JSON.stringify(s.atoms),before);
});

test('rotation stays screen-relative after inversion and roll; reversing a curved drag restores the view',()=>{
 const {MV,canvas}=boot(),r=MV.App.renderer();r.setViewAngles(0,Math.PI);r.rollCamera(.8);
 const before=[...r.orientation],v=r.rotate({x:.7,y:-1.2,z:2.3}),a=.64;
 r.rotateTrackball(10,10,90,10);const rotated=r.rotate({x:.7,y:-1.2,z:2.3});
 assert.ok(Math.abs(rotated.x-(Math.cos(a)*v.x+Math.sin(a)*v.z))<1e-9);assert.ok(Math.abs(rotated.y-v.y)<1e-9);
 r.rotateTrackball(90,10,10,10);r.orientation.forEach((v,i)=>assert.ok(Math.abs(v-before[i])<1e-9));
 const points=[[30,30],[160,55],[230,240],[480,130],[650,460],[950,310]],path=[...points,...points.slice(0,-1).reverse()];
 canvas.fire('pointerdown',{pointerId:28,button:0,clientX:points[0][0],clientY:points[0][1]});
 for(const [clientX,clientY] of path.slice(1))canvas.fire('pointermove',{pointerId:28,clientX,clientY});
 canvas.fire('pointercancel',{pointerId:28});r.orientation.forEach((v,i)=>assert.ok(Math.abs(v-before[i])<1e-9));
 canvas.fire('pointermove',{pointerId:28,clientX:600,clientY:200});r.orientation.forEach((v,i)=>assert.ok(Math.abs(v-before[i])<1e-9));
});

test('one held drag keeps turning past 1080 degrees horizontally, vertically and diagonally',()=>{
 const {MV,canvas,nodes}=boot(),r=MV.App.renderer(),before=JSON.stringify(MV.App.getState().atoms);
 for(const [ux,uy] of [[1,0],[0,1],[Math.SQRT1_2,Math.SQRT1_2],[-1,0],[0,-1]]){
  nodes.get('btnViewXY').click();let last={x:0,y:0,z:1},total=0;
  canvas.fire('pointerdown',{pointerId:31,button:0,clientX:400,clientY:250});
  for(let i=1;i<=300;i++){
   canvas.fire('pointermove',{pointerId:31,clientX:400+ux*i*10,clientY:250+uy*i*10});
   const v=r.rotate({x:0,y:0,z:1});total+=Math.acos(Math.max(-1,Math.min(1,last.x*v.x+last.y*v.y+last.z*v.z)));last=v;
   assert.ok(Math.abs(v.z-Math.cos(i*10*.008))<1e-9,'rotation must track total pointer distance, beyond the canvas and multiple turns');
  }
  canvas.fire('pointerup',{pointerId:31});assert.ok(total>6*Math.PI);
 }
 assert.equal(JSON.stringify(MV.App.getState().atoms),before);
});
test('mass centering moves all cell contents only, supports undo, and camera/axes controls preserve coordinates',()=>{
 const {MV,nodes}=boot(),app=MV.App,r=app.renderer(),s=MV.IO.parseXYZToState('2\nLattice="8 0 0 1 9 0 2 3 10"\nH 2 3 4\nO 4 5 6\n');s.selectedAtomIds.add(s.atoms[0].id);app.setState(s,false);
 const cell=JSON.stringify(s.metadata.cell),before=JSON.stringify(s.atoms),distance=MV.Geometry.distance(...s.atoms);nodes.get('btnCenterOrigin').click();const next=app.getState(),c=MV.Geometry.centerOfMass(next.atoms);assert.ok(Math.hypot(c.x,c.y,c.z)<1e-12);assert.ok(Math.abs(MV.Geometry.distance(...next.atoms)-distance)<1e-12);assert.equal(JSON.stringify(next.metadata.cell),cell);assert.notEqual(next.atoms[1].x,4);nodes.get('btnUndo').click();assert.equal(JSON.stringify(app.getState().atoms),before);
 r.rotateTrackball(400,250,3400,250);r.zoom=4;r.panX=70;r.panY=-30;nodes.get('btnResetCamera').click();assert.equal(r.zoom,1);assert.equal(r.panX,0);assert.equal(r.panY,0);assert.equal(JSON.stringify(app.getState().atoms),before);assert.equal(JSON.stringify(app.getState().metadata.cell),cell);
 let drawn=0;const original=r.drawAxes;r.drawAxes=function(w){drawn++;original.call(this,w);};nodes.get('btnToggleAxes').click();assert.ok(drawn>0);assert.equal(app.getState().viewSettings.showAxes,true);assert.equal(nodes.get('btnToggleAxes').attrs['aria-pressed'],'true');assert.equal(MV.IO.parseProject(MV.IO.stateToProjectText(app.getState())).viewSettings.showAxes,true);nodes.get('btnToggleAxes').click();const count=drawn;r.draw();assert.equal(drawn,count);
 const isotope=MV.Geometry.centerOfMass([{element:'C',x:0,y:0,z:0,mol:{props:{MASS:'12'}}},{element:'C',x:25,y:0,z:0,mol:{props:{MASS:'13'}}}]);assert.equal(isotope.x,13);
});
test('periodic cell and atoms share unrestricted multi-turn view rotation',()=>{
 const {MV,canvas,nodes}=boot(),s=MV.IO.parseXYZToState('1\nLattice="4 0 0 1 5 0 2 3 6"\nC 1 2 3\n'),r=MV.App.renderer();MV.App.setState(s,false);nodes.get('btnViewXY').click();const before=MV.IO.stateToProjectText(s),corner=r.cellCorners()[7];
 canvas.fire('pointerdown',{pointerId:39,button:0,clientX:400,clientY:250});for(let i=1;i<=260;i++){canvas.fire('pointermove',{pointerId:39,clientX:400+10*i,clientY:250});assert.ok(Math.abs(r.rotate({x:0,y:0,z:1}).z-Math.cos(.08*i))<1e-9);}canvas.fire('pointerup',{pointerId:39});assert.equal(MV.IO.stateToProjectText(s),before);assert.notEqual(r.rotate(corner).x,corner.x);
});
test('Shift-left rolls at a fixed view direction; perspective and world-origin axes share projection',()=>{
 const {MV,canvas,nodes}=boot(),r=MV.App.renderer(),s=MV.App.getState(),coords=JSON.stringify(s.atoms);
 const direction=r.viewVectorToWorld([0,0,1]),center=JSON.stringify(r.cameraCenter),q=[...r.orientation];
 canvas.fire('pointerdown',{pointerId:25,button:0,shiftKey:true,clientX:400,clientY:250});canvas.fire('pointermove',{pointerId:25,clientX:600,clientY:250});canvas.fire('pointerup',{pointerId:25});
 assert.notDeepEqual(r.orientation,q);r.viewVectorToWorld([0,0,1]).forEach((v,i)=>assert.ok(Math.abs(v-direction[i])<1e-10));assert.equal(JSON.stringify(r.cameraCenter),center);assert.equal(JSON.stringify(s.atoms),coords);
 s.viewSettings.projection='perspective';s.viewSettings.fov=70;s.viewSettings.showAxes=true;r.renderState(s,true);
 const origin=r.project({x:0,y:0,z:0},r.cameraCenter,r.currentScale,800,500);assert.equal(r.projectedAxes.origin.x,origin.x);assert.equal(r.projectedAxes.origin.y,origin.y);
 assert.ok(r.perspectiveFactor(1)>r.perspectiveFactor(-1));const factor=r.perspectiveFactor(1);s.viewSettings.fov=10;r.draw();assert.ok(r.perspectiveFactor(1)<factor);
 assert.ok(r.projectedAtoms.every(p=>[p.x,p.y,p.radius].every(Number.isFinite)));assert.equal(JSON.stringify(s.atoms),coords);
});
test('B deletes the selected pair; Shift+B creates it, preserves suppression and supports undo',()=>{
 const {MV,canvas,nodes}=boot(),app=MV.App,s=app.getState();s.selectedAtomIds=new Set(s.atoms.slice(0,2).map(a=>a.id));app.setState(s,true);canvas.focus();
 const count=s.bonds.length;canvas.fire('keydown',{key:'b'});assert.equal(app.getState().bonds.length,count-1);
 MV.Bonding.refreshInferredBonds(app.getState());assert.equal(app.getState().bonds.length,count-1);canvas.fire('keydown',{key:'b',repeat:true});assert.equal(app.getState().bonds.length,count-1);
 canvas.fire('keydown',{key:'b'});assert.equal(app.getState().bonds.length,count-1);
 canvas.fire('keydown',{key:'B',shiftKey:true});assert.equal(app.getState().bonds.length,count);
 canvas.fire('keydown',{key:'B',shiftKey:true});assert.equal(app.getState().bonds.length,count);
 nodes.get('btnUndo').click();assert.equal(app.getState().bonds.length,count-1);nodes.get('btnUndo').click();assert.equal(app.getState().bonds.length,count);
});
test('bulk bond keys preserve boundary bonds, coordinates, selection and existing bond properties',()=>{
 const {MV,canvas,nodes,doc}=boot(),app=MV.App,s=shortcutMolecule(MV.Model);s.selectedAtomIds=new Set(['A','B','C']);s.bonds[0].order=2;app.setState(s,true);canvas.focus();
 const atoms=JSON.stringify(s.atoms),original=MV.IO.stateToProjectText(s),firstBond=JSON.stringify(s.bonds[0]);
 nodes.get('bondOrder').value='3';nodes.get('bondType').value='coordination_candidate';
 canvas.fire('keydown',{key:'B',shiftKey:true});assert.equal(app.getState().bonds.length,5);assert.equal(JSON.stringify(app.getState().bonds[0]),firstBond);
 const ac=MV.Model.findBondBetween(app.getState(),'A','C');assert.equal(ac.order,3);assert.equal(ac.type,'coordination_candidate');
 canvas.fire('keydown',{key:'b'});assert.deepEqual(Array.from(app.getState().bonds,b=>[b.atom1,b.atom2]),[['B','D'],['A','F']]);assert.equal(JSON.stringify(app.getState().atoms),atoms);assert.deepEqual(Array.from(app.getState().selectedAtomIds),['A','B','C']);
 const cut=MV.IO.stateToProjectText(app.getState());canvas.fire('keydown',{key:'b'});nodes.get('btnUndo').click();assert.equal(app.getState().bonds.length,5);nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),original);
 nodes.get('btnRedo').click();nodes.get('btnRedo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),cut);
 canvas.focus();canvas.fire('keydown',{key:'B',shiftKey:true,repeat:true});assert.equal(MV.IO.stateToProjectText(app.getState()),cut);
 canvas.fire('keydown',{key:'B',shiftKey:true});assert.equal(app.getState().bonds.length,5);assert.equal(app.getState().metadata.suppressedBondKeys.length,0);
 assert.equal(MV.IO.parseProject(MV.IO.stateToProjectText(app.getState())).bonds.length,5);
 const saved=MV.IO.stateToProjectText(app.getState());
 for(const modifiers of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true}]){canvas.fire('keydown',{key:'b',...modifiers});assert.equal(MV.IO.stateToProjectText(app.getState()),saved);}
 doc.activeElement=nodes.get('dataText');canvas.fire('blur');nodes.get('dataText').fire('keydown',{key:'b'});assert.equal(MV.IO.stateToProjectText(app.getState()),saved);
 canvas.focus();nodes.get('helpDialog').showModal();canvas.fire('keydown',{key:'b'});assert.equal(MV.IO.stateToProjectText(app.getState()),saved);nodes.get('helpDialog').close();
 nodes.get('dataText').value='C bad 0 0';nodes.get('dataText').fire('input');canvas.fire('keydown',{key:'b'});assert.equal(MV.IO.stateToProjectText(app.getState()),saved);assert.match(nodes.get('statusBadge').textContent,/編集中/);
 nodes.get('dataReset').click();const large=MV.Model.createState({atoms:Array.from({length:143},(_,i)=>({id:'n'+i,element:'C',x:i,y:0,z:0}))});MV.Model.selectAllAtoms(large);app.setState(large,true);canvas.focus();
 const before=MV.IO.stateToProjectText(large);canvas.fire('keydown',{key:'B',shiftKey:true});assert.equal(MV.IO.stateToProjectText(app.getState()),before);assert.match(nodes.get('statusBadge').textContent,/10000/);
});
test('cell removal preserves atoms, bonds, selection and camera, updates only the current frame, and undoes once',()=>{
 const {MV,nodes}=boot(false,true),app=MV.App,s=app.getState();nodes.get('cancelAdvanced').disabled=true;
 s.metadata.cell=MV.Periodic.cell([[10,0,0],[2,9,0],[1,1,8]],[true,false,true]);s.metadata.externalCalculation={energyEV:-1};
 s.selectedAtomIds.add(s.atoms[1].id);const frame=MV.Periodic.snapshot(s);s.metadata.trajectory=[frame,JSON.parse(JSON.stringify(frame))];s.metadata.frameIndex=0;app.setState(s,true);
 const before=MV.IO.stateToProjectText(s),atoms=JSON.stringify(s.atoms),bonds=JSON.stringify(s.bonds),camera=JSON.stringify(app.renderer().orientation);
 assert.equal(nodes.get('btnRemoveCell').disabled,false);nodes.get('btnRemoveCell').click();
 const next=app.getState();assert.equal(next.metadata.cell,null);assert.equal(next.metadata.trajectory[0].metadata.cell,null);assert.ok(next.metadata.trajectory[1].metadata.cell);assert.equal(next.metadata.externalCalculation,undefined);
 assert.equal(JSON.stringify(next.atoms),atoms);assert.equal(JSON.stringify(next.bonds),bonds);assert.equal(next.selectedAtomIds.has(s.atoms[1].id),true);assert.equal(JSON.stringify(app.renderer().orientation),camera);
 assert.doesNotMatch(nodes.get('dataText').value,/^TV /m);assert.doesNotMatch(MV.IO.stateToXYZText(next),/Lattice=|pbc=/);assert.equal(nodes.get('btnRemoveCell').disabled,true);
 const saved=MV.IO.stateToProjectText(next);assert.equal(MV.IO.parseProject(saved).metadata.cell,null);
 app.removeCell();nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),before);nodes.get('btnRedo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),saved);
 nodes.get('frameNext').click();assert.ok(app.getState().metadata.cell);nodes.get('framePrev').click();assert.equal(app.getState().metadata.cell,null);
});
test('cell removal rejects drafts and active jobs, and adopts a preview in a single undo step',()=>{
 const {MV,nodes}=boot(false,true),app=MV.App,s=app.getState();nodes.get('cancelAdvanced').disabled=true;
 s.metadata.cell=MV.Periodic.cell([[8,0,0],[0,8,0],[0,0,8]]);app.setState(s,true);const before=MV.IO.stateToProjectText(s);
 nodes.get('dataText').value+='\nH invalid 0 0';nodes.get('dataText').fire('input');const draft=nodes.get('dataText').value;
 assert.throws(()=>app.removeCell(),/編集中/);assert.equal(nodes.get('dataText').value,draft);assert.equal(MV.IO.stateToProjectText(app.getState()),before);nodes.get('dataReset').click();
 MV.EngineUI={isBusy:()=>true};assert.throws(()=>app.removeCell(),/計算/);delete MV.EngineUI;
 nodes.get('cancelAdvanced').disabled=false;assert.throws(()=>app.removeCell(),/計算/);nodes.get('cancelAdvanced').disabled=true;
 const base=MV.Periodic.snapshot(s);MV.EnergyProfile.set({title:'cell preview',kind:'path',energies:[0,1],base:()=>base,positions:i=>base.atoms.map(a=>[a.x+2*i,a.y,a.z])});MV.EnergyProfile.select(1);
 nodes.get('btnRemoveCell').click();assert.equal(app.getState().atoms[0].x,2);assert.equal(app.getState().metadata.cell,null);assert.equal(app.renderer().previewOnly,false);
 nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),before);
 nodes.get('btnCell').click();nodes.get('cellRemove').click();assert.equal(app.getState().metadata.cell,null);assert.equal(nodes.get('cellDialog').open,false);
});
test('bulk bond edit adopts displayed geometry and undoes the entire operation once',()=>{
 const {MV,nodes,canvas}=boot(false,true),app=MV.App,s=app.getState();s.selectedAtomIds=new Set(s.atoms.map(a=>a.id));app.setState(s,true);
 const before=MV.IO.stateToProjectText(s),base=MV.Periodic.snapshot(s);
 MV.EnergyProfile.set({title:'bond preview',kind:'path',energies:[0,1],base:()=>base,positions:i=>base.atoms.map(a=>[a.x+2*i,a.y,a.z])});MV.EnergyProfile.select(1);canvas.focus();
 canvas.fire('keydown',{key:'b'});assert.equal(app.getState().atoms[0].x,2);assert.equal(app.getState().bonds.length,0);assert.equal(app.renderer().previewOnly,false);
 nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),before);
});
function shortcutMolecule(M){
 return M.createState({atoms:[{id:'A',element:'C',x:0,y:0,z:0},{id:'B',element:'C',x:1.5,y:0,z:0},{id:'C',element:'H',x:1.5,y:1,z:0},{id:'D',element:'H',x:1.5,y:0,z:1},{id:'F',element:'H',x:-1,y:0,z:0},{id:'X',element:'He',x:8,y:0,z:0}],bonds:[['A','B'],['B','C'],['B','D'],['A','F']].map(([atom1,atom2])=>({atom1,atom2,order:1})),selectedAtomIds:['A','B']});
}
test('Ctrl selection shortcuts expand one edge, select connected components, invert, and respect canvas focus',()=>{
 const {MV,canvas,nodes,doc}=boot(),app=MV.App,s=shortcutMolecule(MV.Model);s.selectedAtomIds=new Set(['A']);app.setState(s,true);canvas.focus();
 const press=(key,extra={})=>canvas.fire('keydown',{key,ctrlKey:true,...extra}),selected=()=>[...app.getState().selectedAtomIds].sort();
 assert.ok(press('e').defaultPrevented);assert.deepEqual(selected(),['A','B','F']);press('e',{repeat:true});assert.deepEqual(selected(),['A','B','F']);
 assert.ok(press('w').defaultPrevented);assert.deepEqual(selected(),['A','B','C','D','F']);
 assert.ok(press('r').defaultPrevented);assert.deepEqual(selected(),['X']);press('r',{repeat:true});assert.deepEqual(selected(),['X']);
 press('a');assert.equal(selected().length,6);app.getState().selectedAtomIds.clear();press('w');assert.equal(selected().length,0);
 app.getState().selectedAtomIds=new Set(['A']);nodes.get('dataText').focus();assert.ok(!press('r',{target:nodes.get('dataText')}).defaultPrevented);assert.deepEqual(selected(),['A']);
 doc.activeElement=null;assert.ok(!press('e').defaultPrevented);assert.deepEqual(selected(),['A']);canvas.focus();nodes.get('helpDialog').open=true;assert.ok(!press('w').defaultPrevented);nodes.get('helpDialog').open=false;
 assert.ok(!press('e',{isComposing:true}).defaultPrevented);assert.ok(!press('e',{altKey:true}).defaultPrevented);
});
test('bond shortcuts rotate and translate the ordered B fragment rigidly, preserve bonds and undo',()=>{
 const {MV,canvas,nodes}=boot(),app=MV.App,s=shortcutMolecule(MV.Model);app.setState(s,true);canvas.focus();
 const original=JSON.stringify(s.atoms),bonds=JSON.stringify(s.bonds),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10),atom=id=>app.getState().atoms.find(a=>a.id===id),press=key=>canvas.fire('keydown',{key});
 const theta=5*Math.PI/180;
 press(']');near(atom('C').y,Math.cos(theta));near(atom('C').z,Math.sin(theta));near(atom('D').y,-Math.sin(theta));near(atom('B').x,1.5);near(atom('A').x,0);near(atom('X').x,8);
 near(MV.Geometry.distance(atom('C'),atom('D')),Math.SQRT2);assert.equal(JSON.stringify(app.getState().bonds),bonds);
 press('[');near(atom('C').z,0);
 press('.');for(const id of ['B','C','D'])near(atom(id).x,1.6);near(atom('F').x,-1);press(',');near(atom('B').x,1.5);
 press('<');near(atom('B').x,1.4);nodes.get('btnUndo').click();near(atom('B').x,1.5);nodes.get('btnRedo').click();near(atom('B').x,1.4);press('>');near(atom('B').x,1.5);
 assert.deepEqual([...app.getState().selectedAtomIds],['A','B']);assert.equal(JSON.stringify(app.getState().bonds),bonds);
 app.setState(shortcutMolecule(MV.Model),true);app.getState().selectedAtomIds=new Set(['B','A']);press('.');near(atom('A').x,-.1);near(atom('F').x,-1.1);near(atom('B').x,1.5);near(atom('C').x,1.5);
 nodes.get('btnUndo').click();assert.equal(JSON.stringify(app.getState().atoms),original);
});
test('held bond keys repeat with one undo snapshot, full redo and separate releases',()=>{
 const {MV,canvas,nodes,doc,timers}=boot(),app=MV.App;app.setState(shortcutMolecule(MV.Model),true);canvas.focus();
 const atoms=()=>JSON.stringify(app.getState().atoms),before=atoms(),press=(key,repeat=false,code)=>canvas.fire('keydown',{key,repeat,code}),release=(key,code)=>doc.events.keyup.forEach(f=>f({key,code}));
 press(']');for(let i=1;i<125;i++)press(']',true); // More repetitions than the entire history capacity.
 assert.ok(Math.abs(app.getState().atoms[2].z-Math.sin(625*Math.PI/180))<1e-10);
 assert.equal(timers.size,0,'no autosaved intermediate structure during a hold');
 const rotated=atoms();release(']');assert.equal(timers.size,1);nodes.get('btnUndo').click();assert.equal(atoms(),before);assert.equal(nodes.get('btnUndo').disabled,true);
 nodes.get('btnRedo').click();assert.equal(atoms(),rotated);
 press('.');press('.',true);press('.',true);release('.');const firstMove=atoms();assert.ok(Math.abs(app.getState().atoms[1].x-1.8)<1e-10);
 press('.');press('.',true);release('.');const secondMove=atoms();nodes.get('btnUndo').click();assert.equal(atoms(),firstMove);nodes.get('btnUndo').click();assert.equal(atoms(),rotated);
 nodes.get('btnRedo').click();nodes.get('btnRedo').click();assert.equal(atoms(),secondMove);
 // Release uses the physical key code even if Shift changed the printed key.
 press('>',false,'Period');press('>',true,'Period');release('.','Period');const released=atoms();press('>',true,'Period');assert.equal(atoms(),released);
});

test('held bond edits stop on lost focus, other actions and rejection without merging histories',()=>{
 const {MV,canvas,nodes,doc,win}=boot(),app=MV.App,press=(key,extra={})=>canvas.fire('keydown',{key,...extra}),fire=(target,type,e={})=>target.events[type].forEach(f=>f(e)),atoms=()=>JSON.stringify(app.getState().atoms);
 for(const stop of [()=>fire(doc,'focusout'),()=>fire(win,'blur'),()=>{doc.hidden=true;fire(doc,'visibilitychange');doc.hidden=false;},()=>fire(doc,'pointerdown'),()=>{nodes.get('helpDialog').open=true;press('.', {repeat:true});nodes.get('helpDialog').open=false;},()=>press('r')]){
   app.setState(shortcutMolecule(MV.Model),true);canvas.focus();const before=atoms();press('.');press('.',{repeat:true});const after=atoms();stop();press('.',{repeat:true});assert.equal(atoms(),after);nodes.get('btnUndo').click();assert.equal(atoms(),before);
 }
 app.setState(shortcutMolecule(MV.Model),true);canvas.focus();const before=atoms();press('.');press('.',{repeat:true});press('z',{ctrlKey:true});assert.equal(atoms(),before);press('.',{repeat:true});assert.equal(atoms(),before);
 press(']');press(']',{repeat:true});const rotated=atoms();press('.');press('.',{repeat:true});nodes.get('btnUndo').click();assert.equal(atoms(),rotated);nodes.get('btnUndo').click();assert.equal(atoms(),before);
 const short=shortcutMolecule(MV.Model);short.atoms[1].x=.25;app.setState(short,true);press(',');const lastValid=atoms();press(',',{repeat:true});assert.equal(atoms(),lastValid);assert.match(nodes.get('statusBadge').textContent,/0.1 Å以下/);press(',',{repeat:true});assert.equal(atoms(),lastValid);nodes.get('btnUndo').click();assert.equal(app.getState().atoms[1].x,.25);
});

test('bond shortcuts reject rings, missing bonds, zero axes, collapsed distances, periodic cuts and stale drafts atomically',()=>{
 const {MV,canvas,nodes}=boot(),app=MV.App;
 const reject=(change,key,pattern)=>{const s=shortcutMolecule(MV.Model);change(s);app.setState(s,true);canvas.focus();const before=JSON.stringify(s),undo=nodes.get('btnUndo').disabled;canvas.fire('keydown',{key});assert.equal(JSON.stringify(app.getState()),before);assert.equal(nodes.get('btnUndo').disabled,undo);assert.match(nodes.get('statusBadge').textContent,pattern);};
 reject(s=>s.bonds.push(MV.Model.createBond({atom1:'C',atom2:'A'})),']',/環内/);
 reject(s=>s.selectedAtomIds=new Set(['A','X']),'.',/結合がありません/);
 reject(s=>s.selectedAtomIds=new Set(['A']),'.',/2原子/);
 reject(s=>s.atoms[1].x=0,']',/方向/);
 reject(s=>s.atoms[1].x=.15,',',/0.1 Å以下/);
 reject(s=>{s.metadata.cell=MV.Periodic.cell([[5,0,0],[0,5,0],[0,0,5]]);s.atoms[1].x=4.5;},'.',/周期境界/);
 const s=shortcutMolecule(MV.Model);app.setState(s,true);nodes.get('dataText').value='C 3 0 0';nodes.get('dataText').fire('input');canvas.focus();const before=JSON.stringify(s);canvas.fire('keydown',{key:']'});assert.equal(JSON.stringify(s),before);assert.match(nodes.get('statusBadge').textContent,/編集中/);
});

test('text editor imports multi-record SDF and CIF as complete documents and preserves failed drafts',()=>{
 const {MV,nodes}=boot(),app=MV.App,box=nodes.get('dataText');const molecule=MV.IO.parseXYZToState('C 0 0 0\nO 1.2 0 0');molecule.bonds[0].order=2;molecule.bonds[0].source='manual';
 const sdf=MV.IO.stateToSDFText(molecule);box.value=sdf+sdf;box.fire('input');nodes.get('dataApply').click();assert.equal(app.getState().metadata.trajectory.length,2);assert.equal(app.getState().bonds[0].order,2);nodes.get('btnUndo').click();assert.equal(app.getState().atoms.length,3);nodes.get('dataReset').click();
 box.value='data_cell\n_cell_length_a 5\n_cell_length_b 5\n_cell_length_c 5\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nC .2 .4 .6\n';box.fire('input');nodes.get('dataApply').click();assert.equal(app.getState().atoms.length,1);assert.ok(app.getState().metadata.cell);assert.match(box.value,/TV /);
 const before=JSON.stringify(app.getState());box.value='data_bad\nloop_\n_atom_site_fract_x\n.2';box.fire('input');nodes.get('dataApply').click();assert.equal(JSON.stringify(app.getState()),before);assert.match(box.value,/data_bad/);
});


test('AFIR fragments follow canvas selection, pairs reject duplicates, edit/undo/project retain IDs',()=>{
 const {MV,nodes,canvas}=boot(true),app=MV.App;
 nodes.get('btnAFIR').click();assert.equal(nodes.get('afirPanel').hidden,false);assert.equal(nodes.get('multiSelect').checked,true);
 const positions=app.renderer().projectedAtoms;
 // Exercise actual atom picking through the canvas pointer handlers.
 const pick=p=>{canvas.fire('pointerdown',{pointerId:23,clientX:p.x,clientY:p.y,button:0});canvas.fire('pointerup',{pointerId:23,clientX:p.x,clientY:p.y,button:0});};
 pick(positions[0]);assert.equal(app.getState().selectedAtomIds.size,1);
 nodes.get('afirName').value='O group';nodes.get('afirAddFragment').click();
 assert.equal(app.getState().metadata.afir.fragments[0].atomIds[0],app.getState().atoms[0].id);
 assert.equal(app.getState().selectedAtomIds.size,0);
 assert.equal(nodes.get('afirA').value,'f1');assert.equal(nodes.get('afirB').value,'f1');
 pick(app.renderer().projectedAtoms[1]);nodes.get('afirName').value='H group';nodes.get('afirAddFragment').click();
 // Registering the second fragment must replace the browser's old f1/f1 default.
 assert.equal(nodes.get('afirA').value,'f1');assert.equal(nodes.get('afirB').value,'f2');
 nodes.get('afirMode').value='attract';nodes.get('afirGamma').value='100';nodes.get('afirAddPair').click();
 assert.equal(app.getState().metadata.afir.pairs.length,1);assert.equal(nodes.get('afirCheck').disabled,false);
 assert.match(nodes.get('afirPairStatus').textContent,/ペアを追加しました/);
 nodes.get('afirCheck').click();assert.match(nodes.get('afirStatus').textContent,/人工項のみ評価/);
 nodes.get('afirAddPair').click();assert.equal(app.getState().metadata.afir.pairs.length,1);assert.match(nodes.get('afirStatus').textContent,/重複/);
 assert.match(nodes.get('afirPairStatus').textContent,/追加できません:.*重複/);
 nodes.get('afirSteps').value='10000';nodes.get('afirFmax').value='0.00001';nodes.get('afirMove').value='0.02';
 nodes.get('afirCheck').click();assert.equal(app.getState().metadata.afir.maxSteps,10000);assert.equal(app.getState().metadata.afir.fmax,.00001);
 nodes.get('btnUndo').click(); // restore settings so the next undo removes the pair
 assert.equal(nodes.get('afirRun').disabled,true); // no physical engine is silently substituted
 const serialized=MV.IO.stateToProjectText(app.getState()),restored=MV.IO.parseProject(serialized);
 assert.equal(JSON.stringify(restored.metadata.afir),JSON.stringify(app.getState().metadata.afir));
 nodes.get('btnUndo').click();assert.equal(app.getState().metadata.afir.pairs.length,0);
 nodes.get('btnRedo').click();assert.equal(app.getState().metadata.afir.pairs.length,1);
 app.change('delete selected atom',s=>{s.atoms=s.atoms.slice(1);});assert.equal(nodes.get('afirCheck').disabled,true);assert.match(nodes.get('afirPreview').textContent,/原子ID/);
 nodes.get('btnUndo').click();assert.equal(nodes.get('afirCheck').disabled,false);
 nodes.get('afirClose').click();assert.equal(nodes.get('afirPanel').hidden,true);assert.equal(app.getState().viewSettings.afirOverlay,false);
});

test('AFIR pair failures are visible beside the button and preserve the input; distinct choices survive redraw',()=>{
 const {MV,nodes}=boot(true),app=MV.App;
 for(const [i,label] of [[0,'O'],[1,'H'],[0,'same O']]){
  const s=app.getState();s.selectedAtomIds=new Set([s.atoms[i].id]);app.setState(s,true);
  nodes.get('afirName').value=label;nodes.get('afirAddFragment').click();
 }
 nodes.get('afirMode').value='attract';nodes.get('afirGamma').value='100';
 nodes.get('afirA').value='f1';nodes.get('afirB').value='f1';
 const original=JSON.stringify(app.getState());nodes.get('afirAddPair').click();
 assert.match(nodes.get('afirPairStatus').textContent,/原子団AとBが同じ/);assert.equal(JSON.stringify(app.getState()),original);
 nodes.get('afirB').value='f3';nodes.get('afirB').fire('change');nodes.get('afirAddPair').click();
 assert.match(nodes.get('afirPairStatus').textContent,/原子が重ならない/);assert.equal(JSON.stringify(app.getState()),original);
 nodes.get('afirB').value='f2';nodes.get('afirGamma').value='';nodes.get('afirAddPair').click();
 assert.match(nodes.get('afirPairStatus').textContent,/数値を入力/);assert.equal(JSON.stringify(app.getState()),original);
 nodes.get('afirGamma').value='40';nodes.get('afirA').value='f2';nodes.get('afirB').value='f3';nodes.get('afirAddPair').click();
 assert.equal(app.getState().metadata.afir.pairs.length,1);assert.equal(app.getState().metadata.afir.pairs[0].gamma,40);
 assert.equal(nodes.get('afirA').value,'f2');assert.equal(nodes.get('afirB').value,'f3');
 assert.equal(nodes.get('afirRun').disabled,true);
 MV.AFIRRunner={available:()=>true};MV.AFIRUI.sync();assert.equal(nodes.get('afirRun').disabled,false);
});


test('editing a registered AFIR gamma retains its input node and focus across updates and undo',()=>{
 const {MV,nodes,doc}=boot(true),app=MV.App;
 app.change('prepare AFIR pair',s=>{s.metadata.afir={...MV.AFIR.defaults(),fragments:[
  {id:'a',label:'A',atomIds:[s.atoms[0].id]},{id:'b',label:'B',atomIds:[s.atoms[1].id]}],pairs:[{a:'a',b:'b',mode:'attract',gamma:100}]};});
 const input=nodes.get('afirPairs').children[0].children[1].children[0];input.focus();
 for(const value of ['101','102','100.5']){
  input.value=value;input.fire('change');
  assert.equal(nodes.get('afirPairs').children[0].children[1].children[0],input);
  assert.equal(doc.activeElement,input);assert.equal(app.getState().metadata.afir.pairs[0].gamma,Number(value));
 }
 nodes.get('btnUndo').click();assert.equal(Number(input.value),102);
});

test('malformed imported AFIR settings cannot break the editor and can be reset with undo',()=>{
 const {MV,nodes}=boot(true);MV.App.change('import invalid AFIR',s=>{s.metadata.afir={schema:'bad',fragments:{bad:true},pairs:[]};});
 assert.match(nodes.get('afirStatus').textContent,/形式が不正/);assert.equal(nodes.get('afirRun').disabled,true);
 nodes.get('btnAFIR').click();assert.equal(nodes.get('afirPanel').hidden,false);
 nodes.get('afirReset').click();assert.equal(MV.App.getState().metadata.afir.schema,'molecule-afir/1');
 nodes.get('btnUndo').click();assert.equal(MV.App.getState().metadata.afir.schema,'bad');assert.equal(nodes.get('afirRun').disabled,true);
});

test('energy plot focus previews coordinates without changing input, export or undo; playback and plot stay synchronized',()=>{
 const {MV,nodes}=boot(false,true),app=MV.App,profile=MV.EnergyProfile,original=app.getState(),base=MV.Periodic.snapshot(original);
 const before=MV.IO.stateToXYZText(original),images=[0,1,2].map(dx=>original.atoms.map(a=>[a.x+dx,a.y,a.z]));
 profile.set({title:'test',kind:'afir',energies:[-3,-2,-4],biasEnergies:[1,2,3],positions:i=>images[i],base:()=>base});
 assert.equal(nodes.get('afirLive').checked,true);assert.equal(nodes.get('engineLive').checked,true);
 assert.equal(app.renderer().state,original);
 const points=nodes.get('energyProfile').children.filter(e=>e.attrs.role==='button');
 points[1].fire('focus');assert.equal(app.renderer().state.atoms[0].x,1);assert.equal(MV.IO.parseXYZToState(nodes.get('dataText').value).atoms[0].x,1);assert.equal(app.getState(),original);
 assert.equal(MV.IO.stateToXYZText(app.getState()),before);assert.equal(app.renderer().previewOnly,true);
 assert.match(nodes.get('profileValue').textContent,/人工項 = 2.000000/);
 nodes.get('profileRestore').click();assert.equal(app.renderer().state,original);assert.equal(app.renderer().previewOnly,false);
 const frames=images.map(pos=>{const s=MV.Model.createState(base);s.atoms.forEach((a,i)=>[a.x,a.y,a.z]=pos[i]);MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);});
 app.change('apply',()=>{const s=MV.Model.createState(frames[0]);s.metadata.trajectory=frames;s.metadata.frameIndex=0;return s;});
 profile.bindTrajectory(frames);MV.Studio.play();
 assert.equal(app.getState().metadata.frameIndex,1);assert.equal(app.renderer().state.atoms[0].x,1);assert.equal(nodes.get('profileRange').value,1);
 MV.Studio.stop();nodes.get('profileRange').value='2';nodes.get('profileRange').fire('input');
 assert.equal(app.getState().metadata.frameIndex,2);assert.equal(app.renderer().state.atoms[0].x,2);assert.equal(MV.IO.parseXYZToState(nodes.get('dataText').value).atoms[0].x,2);
 nodes.get('btnUndo').click();assert.equal(MV.IO.stateToXYZText(app.getState()),before);
});
test('coordinate panel follows preview frames and preserves a draft, format and input document',()=>{
 const {MV,nodes}=boot(false,true),app=MV.App,profile=MV.EnergyProfile,box=nodes.get('dataText');
 const before=MV.IO.stateToProjectText(app.getState()),base=MV.Periodic.snapshot(app.getState());
 nodes.get('coordinateFormat').value='xyz';nodes.get('xyzHeader').checked=true;nodes.get('xyzHeader').fire('change');
 const draft=box.value.replace('O 0.0000000000','O 4.0000000000');box.value=draft;box.fire('input');
 const source={title:'coordinate synchronization',kind:'path',energies:[0,1,0],base:()=>base,positions:i=>base.atoms.map(a=>[a.x+i,a.y,a.z])};
 profile.set(source);profile.select(1);
 assert.equal(box.readOnly,true);assert.equal(nodes.get('dataApply').disabled,true);assert.equal(nodes.get('btnDataFile').disabled,true);
 assert.equal(MV.IO.parseXYZToState(box.value).atoms[0].x,1);assert.match(nodes.get('xyzEditStatus').textContent,/未適用の編集は保持/);
 profile.select(2);assert.equal(MV.IO.parseXYZToState(box.value).atoms[0].x,2);
 nodes.get('coordinateFormat').value='mol3000';nodes.get('coordinateFormat').fire('change');assert.match(box.value,/V3000/);
 assert.equal(MV.IO.stateToProjectText(app.getState()),before);
 profile.restore();assert.equal(box.readOnly,false);assert.equal(nodes.get('dataApply').disabled,false);
 assert.equal(box.value,draft);assert.equal(nodes.get('coordinateFormat').value,'xyz');assert.equal(nodes.get('xyzHeader').checked,true);assert.equal(nodes.get('xyzHeader').disabled,false);
 nodes.get('dataReset').click();profile.select(1);nodes.get('profileFollow').checked=true;nodes.get('dataReset').click();
 assert.equal(nodes.get('profileFollow').checked,false);
 assert.equal(box.readOnly,false);assert.equal(MV.IO.parseXYZToState(box.value).atoms[0].x,0);
 assert.equal(MV.IO.stateToProjectText(app.getState()),before);
});

test('current structure exports and calculation handoff use the displayed node with undo and draft protection',()=>{
 const {MV,nodes}=boot(false,true),app=MV.App,original=MV.IO.stateToProjectText(app.getState()),base=MV.Periodic.snapshot(app.getState());
 const source={title:'current frame',kind:'path',energies:[0,1,0],base:()=>base,positions:i=>base.atoms.map(a=>[a.x+i,a.y,a.z])};
 MV.EnergyProfile.set(source);MV.EnergyProfile.select(2);nodes.get('profileFollow').checked=true;
 nodes.get('btnExport').click();assert.equal(MV.IO.parseXYZToState(nodes.get('exportText').value).atoms[0].x,2);
 assert.equal(nodes.get('profileFollow').checked,false);assert.equal(MV.IO.stateToProjectText(app.getState()),original);
 app.useDisplayedStructure();assert.equal(app.getState().atoms[0].x,2);assert.equal(app.renderer().previewOnly,false);
 assert.equal(app.getState().metadata.trajectory,undefined);assert.equal(app.getState().atoms[0].id,base.atoms[0].id);
 nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),original);
 nodes.get('dataText').value+=' ';nodes.get('dataText').fire('input');MV.EnergyProfile.select(1);
 assert.throws(()=>app.useDisplayedStructure(),/未適用/);assert.equal(MV.IO.stateToProjectText(app.getState()),original);
});

test('long profiles retain peaks, bound DOM size, and allow selection of all 10001 frames',()=>{
 const {MV,nodes}=boot(false,true),s=MV.App.getState(),base=MV.Periodic.snapshot(s),energies=Array(10001).fill(0);
 energies[1234]=50;energies[4321]=-20;const sampled=MV.EnergyProfile.sample(energies);
 assert.ok(sampled.length<=402);assert.ok(sampled.includes(1234));assert.ok(sampled.includes(4321));
 MV.EnergyProfile.set({title:'long',kind:'afir',energies,base:()=>base,positions:i=>s.atoms.map(a=>[a.x+i/10000,a.y,a.z])});
 assert.ok(nodes.get('energyProfile').children.length<20);assert.equal(nodes.get('profileRange').max,10000);
 nodes.get('profileRange').value='10000';nodes.get('profileRange').fire('input');
 assert.equal(MV.App.renderer().state.atoms[0].x,1);assert.equal(MV.App.getState().atoms[0].x,0);
});
test('profile visibility preserves results and hovering never selects a frame or reopens a hidden plot',()=>{
 const {MV,nodes}=boot(false,true),p=MV.EnergyProfile,s=MV.App.getState(),base=MV.Periodic.snapshot(s),toggle=nodes.get('profileToggle');
 assert.equal(toggle.disabled,true);
 const result={title:'result',kind:'afir',energies:[0,1,2],base:()=>base,positions:i=>s.atoms.map(a=>[a.x+i,a.y,a.z])};
 p.begin(()=>{});p.set(result,true);assert.equal(toggle.disabled,false);assert.equal(toggle.attrs['aria-expanded'],'true');
 nodes.get('energyProfile').fire('pointermove',{clientX:0});nodes.get('energyProfile').children.find(e=>e.attrs.role==='button').fire('pointerenter');
 nodes.get('profileRange').fire('pointermove',{clientX:0});assert.equal(nodes.get('profileRange').value,2);assert.equal(p.following(),true);
 toggle.click();assert.equal(nodes.get('profilePanel').hidden,true);assert.equal(MV.App.renderer().state,s);assert.equal(p.following(),false);
 // A preview response already in flight, then completion, must respect the hide action.
 p.set(result,true);p.finish();assert.equal(nodes.get('profilePanel').hidden,true);assert.equal(MV.App.renderer().state,s);
 toggle.click();assert.equal(nodes.get('profilePanel').hidden,false);assert.equal(nodes.get('profileRange').value,2);assert.equal(MV.App.renderer().state.atoms[0].x,2);
 nodes.get('profileHide').click();assert.equal(toggle.attrs['aria-expanded'],'false');assert.equal(toggle.disabled,false);
 p.reset();assert.equal(toggle.disabled,true);
});
test('optimization previews infer bonds; stored frames preserve their calculated topology and manual bonds',()=>{
 const {MV,nodes}=boot(false,true),app=MV.App,p=MV.EnergyProfile;
 const original=MV.IO.parseXYZToState('C 0 0 0\nC 3 0 0\nC 0 4 0\nC 1.4 4 0');
 original.bonds[0].source='manual';original.bonds[0].order=2;
 app.setState(original,true);const base=MV.Periodic.snapshot(original),saved=MV.IO.stateToProjectText(original);
 const images=[3,1.4,3].map(x=>original.atoms.map((a,i)=>[i===1?x:a.x,a.y,a.z]));
 const result={title:'bond change',kind:'afir',energies:[0,1,0],base:()=>base,positions:i=>images[i]};
 const check=count=>{const s=app.renderer().state;assert.equal(s.bonds.length,count);assert.equal(s.bonds.find(b=>b.source==='manual').order,2);assert.deepEqual(Array.from(s.atoms,a=>a.id),Array.from(original.atoms,a=>a.id));};
 p.set(result);p.select(1);check(2);p.select(2);check(1);
 p.set({...result,focusIndex:1},true);check(2);
 assert.equal(MV.IO.stateToProjectText(app.getState()),saved);nodes.get('profileRestore').click();check(1);
 // Result application computes each frame once; navigation preserves later manual edits.
 const frames=images.map(pos=>{const s=MV.Model.createState(base);s.atoms.forEach((a,i)=>[a.x,a.y,a.z]=pos[i]);MV.Bonding.refreshInferredBonds(s);return MV.Periodic.snapshot(s);});
 app.change('trajectory',()=>{const s=MV.Model.createState(base);s.metadata.trajectory=frames;return s;});p.bindTrajectory(frames);
 MV.Studio.play();check(2);MV.Studio.stop();nodes.get('profileRange').value='2';nodes.get('profileRange').fire('input');check(1);
 MV.Studio.frame(1);check(2);nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),saved);
});
test('live profile can stop following, restores input on edit, and never mismatches missing historical coordinates',()=>{
 const {MV,nodes}=boot(false,true),s=MV.App.getState(),base=MV.Periodic.snapshot(s),p=MV.EnergyProfile;let cancelled=0;
 p.begin(()=>cancelled++);assert.equal(p.following(),true);
 p.set({title:'live',kind:'afir',energies:[0,1],positions:i=>i===1?s.atoms.map(a=>[a.x+2,a.y,a.z]):null,base:()=>base},true);
 assert.equal(MV.App.renderer().state.atoms[0].x,2);
 p.select(0);assert.equal(MV.App.renderer().state,s);assert.match(nodes.get('profileValue').textContent,/最新構造のみ/);
 p.select(1);MV.App.change('edit',v=>{v.atoms[0].x=3;});assert.equal(MV.App.renderer().state,MV.App.getState());assert.equal(p.following(),false);
 nodes.get('profileCancel').click();assert.equal(cancelled,1);p.finish();assert.equal(nodes.get('profileLiveControls').hidden,true);
});
test('live path selection keeps its bead number while energies and coordinates update, including completion',()=>{
 const {MV,nodes}=boot(false,true),p=MV.EnergyProfile,s=MV.App.getState(),base=MV.Periodic.snapshot(s),saved=MV.IO.stateToProjectText(s);
 const update=step=>p.set({title:'NEB '+step,kind:'path',focusIndex:2,energies:[0,1,2,1,0].map(e=>e+step),base:()=>base,positions:i=>s.atoms.map(a=>[a.x+i+step/10,a.y,a.z])},true);
 const points=()=>nodes.get('energyProfile').children.filter(e=>e.attrs.role==='button');
 p.begin(()=>{});update(0);assert.equal(nodes.get('profileRange').value,2);
 points()[1].fire('focus');assert.equal(p.following(),true);update(1);
 assert.equal(nodes.get('profileRange').value,1);assert.equal(MV.App.renderer().state.atoms[0].x,1.1);assert.match(nodes.get('profileValue').textContent,/E = 2.000000/);
 assert.match(points()[3].attrs['aria-label'],/ΔE 1.000000/);
 nodes.get('profileRange').value='3';nodes.get('profileRange').fire('input');assert.equal(p.following(),true);update(2);
 assert.equal(nodes.get('profileRange').value,3);assert.equal(MV.App.renderer().state.atoms[0].x,3.2);
 update(3);p.finish();assert.equal(nodes.get('profileRange').value,3);assert.equal(MV.App.renderer().state.atoms[0].x,3.3);
 assert.equal(MV.IO.stateToProjectText(MV.App.getState()),saved);
 p.reset();p.begin(()=>{});update(0);assert.equal(nodes.get('profileRange').value,2,'new jobs use their initial focus');
 // Explicit pause remains effective even if a preview was already in flight.
 nodes.get('profileFollow').checked=false;nodes.get('profileFollow').fire('change');update(1);
 assert.equal(p.following(),false);assert.equal(MV.App.renderer().state,s);
 nodes.get('profileFollow').checked=true;update(2);assert.equal(MV.App.renderer().state.atoms[0].x,2.2);
});
test('selecting an optimization history step still pauses tail-following',()=>{
 const {MV,nodes}=boot(false,true),p=MV.EnergyProfile,s=MV.App.getState();p.begin(()=>{});
 p.set({title:'history',kind:'afir',energies:[0,1],base:()=>MV.Periodic.snapshot(s),positions:i=>s.atoms.map(a=>[a.x+i,a.y,a.z])},true);
 nodes.get('energyProfile').children.find(e=>e.attrs.role==='button').fire('click');assert.equal(p.following(),false);
});
test('dialogs dismiss only for a primary click begun and ended on the backdrop',()=>{
 const {nodes}=boot();
 for(const dialog of [...nodes.values()].filter(e=>e.tagName==='DIALOG')){
  dialog.getBoundingClientRect=()=>({left:100,right:500,top:100,bottom:500});
  const down=(x,y,extra={})=>dialog.fire('pointerdown',{clientX:x,clientY:y,button:0,...extra});
  const click=(x,y)=>dialog.fire('click',{clientX:x,clientY:y});
  dialog.showModal();down(120,120);click(120,120);assert.equal(dialog.open,true,'dialog padding is not backdrop');
  down(120,120);click(10,10);assert.equal(dialog.open,true,'drag from inside');
  down(10,10);click(120,120);assert.equal(dialog.open,true,'drag from outside');
  down(10,10,{button:2});click(10,10);assert.equal(dialog.open,true,'secondary button');
  down(10,10);dialog.fire('pointercancel');click(10,10);assert.equal(dialog.open,true,'cancelled gesture');
  down(10,10);click(10,10);assert.equal(dialog.open,false,dialog.id);
 }
});
test('trajectory extraction UI rejects invalid counts and preserves the editor and its save contents',()=>{
 const {MV,nodes}=boot(false,true),before=MV.IO.stateToProjectText(MV.App.getState());
 const source={title:'test',name:'水の反応経路',kind:'optimize',symbols:['H'],images:[0,.1,.2,.3,1,2,3,4,6,8,10].map(x=>[[x,0,0]])};
 MV.TrajectoryUI.open(source);
 assert.equal(nodes.get('trajectoryDialog').open,true);
 assert.equal(nodes.get('trajectoryDisplay').hidden,true);assert.equal(nodes.get('trajectoryName').value,'水の反応経路');
 nodes.get('trajectoryShowAll').click();assert.equal(nodes.get('trajectoryText').value,MV.Trajectory.xyz(source,Array.from({length:11},(_,i)=>i)));
 nodes.get('trajectoryCount').value='6';nodes.get('trajectoryCount').fire('input');
 assert.equal(nodes.get('trajectoryDisplay').hidden,true);assert.equal(nodes.get('trajectoryText').value,'');
 assert.match(nodes.get('trajectorySelection').textContent,/1, 3, 5, 7, 9, 11/);
 nodes.get('trajectoryMethod').value='distance';nodes.get('trajectoryMethod').fire('change');
 assert.match(nodes.get('trajectorySelection').textContent,/1, 6, 8, 9, 10, 11/);
 const selection=nodes.get('trajectorySelection').textContent;
 nodes.get('trajectoryFormat').value='lup';nodes.get('trajectoryFormat').fire('change');
 assert.equal(nodes.get('trajectorySaveAll').textContent,'全構造をinfile保存');assert.equal(nodes.get('trajectorySaveSelected').textContent,'抽出した構造列をinfile保存');
 assert.equal(nodes.get('trajectorySelection').textContent,selection);assert.equal(nodes.get('trajectoryCellNotice').hidden,true);
 assert.equal(nodes.get('trajectoryFilename').textContent,'水の反応経路_infile.log');
 nodes.get('trajectoryShowSelected').click();assert.equal(nodes.get('trajectoryDisplay').hidden,false);assert.equal(nodes.get('trajectoryText').value,MV.Trajectory.lup(source,[0,5,7,8,9,10]));
 nodes.get('trajectoryName').value='水/経路';nodes.get('trajectoryName').fire('input');assert.equal(nodes.get('trajectoryFilename').textContent,'水_経路_infile.log');assert.notEqual(nodes.get('trajectoryText').value,'');
 for(const value of ['','1','12','2.5']){nodes.get('trajectoryCount').value=value;nodes.get('trajectoryCount').fire('input');assert.equal(nodes.get('trajectorySaveSelected').disabled,true);assert.equal(nodes.get('trajectoryShowSelected').disabled,true);assert.equal(nodes.get('trajectoryText').value,'');}
 nodes.get('trajectoryShowAll').click();assert.equal(nodes.get('trajectoryText').value,MV.Trajectory.lup(source,Array.from({length:11},(_,i)=>i)));
 nodes.get('trajectoryFormat').value='xyz';nodes.get('trajectoryFormat').fire('change');assert.equal(nodes.get('trajectoryDisplay').hidden,true);assert.equal(nodes.get('trajectoryText').value,'');
 assert.equal(MV.IO.stateToProjectText(MV.App.getState()),before);
 MV.TrajectoryUI.open({title:'single',kind:'optimize',symbols:['H'],images:[[[0,0,0]]]});
 assert.equal(nodes.get('trajectoryCount').value,1);assert.equal(nodes.get('trajectorySaveSelected').disabled,false);
 assert.equal(nodes.get('trajectoryFormat').value,'xyz');assert.equal(nodes.get('trajectorySaveAll').textContent,'全構造をXYZ保存');
 MV.TrajectoryUI.open({title:'periodic NEB',kind:'neb',symbols:['H'],images:[[[0,0,0]],[[1,0,0]]],cell:{vectors:[[9,0,0],[0,9,0],[0,0,9]],pbc:[true,false,false]}});
 nodes.get('trajectoryFormat').value='lup';nodes.get('trajectoryFormat').fire('change');assert.equal(nodes.get('trajectoryCellNotice').hidden,false);
 nodes.get('trajectoryFormat').value='xyz';nodes.get('trajectoryFormat').fire('change');assert.equal(nodes.get('trajectoryCellNotice').hidden,true);
 assert.equal(MV.IO.stateToProjectText(MV.App.getState()),before);
});

test('AFIR extraction offers physical peak controls and transfers exact frames, IDs, charge and energies with undo',()=>{
 const {MV,nodes}=boot(false,true),app=MV.App,base=MV.Periodic.snapshot(app.getState()),before=MV.IO.stateToProjectText(app.getState());
 // Stub only viewport scrolling, not frame application or profile synchronization.
 nodes.get('viewer').scrollIntoView=()=>{};
 let nebOpened=0;MV.EngineUI={isBusy:()=>false,prepareNEB:()=>nebOpened++};
 const energies=[0,1,0,2,0,4,0,2,0],source={title:'AFIR',kind:'afir',symbols:base.atoms.map(a=>a.element),atomIds:base.atoms.map(a=>a.id),images:energies.map((_,i)=>base.atoms.map(a=>[a.x+i*.1,a.y,a.z])),energies,biasEnergies:energies.map(()=>10),base:()=>base,charge:-1,multiplicity:2};
 MV.TrajectoryUI.open(source);assert.equal(nodes.get('trajectoryCount').min,3);
 nodes.get('trajectoryCount').value=2;nodes.get('trajectoryCount').fire('input');assert.equal(nodes.get('trajectoryNEB').disabled,true);assert.match(nodes.get('trajectorySelection').textContent,/3ノード/);
 nodes.get('trajectoryCount').value=4;nodes.get('trajectorySmooth').value=1;nodes.get('trajectorySmooth').fire('input');assert.match(nodes.get('trajectorySelection').textContent,/1, 4, 6, 9/);
 nodes.get('trajectoryShowSelected').click();const text=nodes.get('trajectoryText').value;assert.match(text,/source_frame=6\/9/);
 nodes.get('trajectorySmooth').value=2;nodes.get('trajectorySmooth').fire('input');assert.equal(nodes.get('trajectoryApply').disabled,true);assert.equal(nodes.get('trajectoryText').value,'');
 nodes.get('trajectorySmooth').value=1;nodes.get('trajectorySmooth').fire('input');
 nodes.get('dataText').value='unfinished';nodes.get('dataText').fire('input');nodes.get('trajectoryNEB').click();assert.equal(nebOpened,0);assert.equal(MV.IO.stateToProjectText(app.getState()),before);assert.equal(nodes.get('dataText').value,'unfinished');
 nodes.get('dataReset').click();MV.EngineUI.isBusy=()=>true;nodes.get('trajectoryNEB').click();assert.equal(nebOpened,0);assert.match(nodes.get('trajectoryMessage').textContent,/実行中/);MV.EngineUI.isBusy=()=>false;
 nodes.get('trajectoryNEB').click();assert.equal(nebOpened,1);assert.equal(nodes.get('trajectoryDialog').open,false);
 const frames=app.getState().metadata.trajectory;assert.deepEqual(Array.from(frames,f=>f.metadata.trajectoryExtraction.sourceFrame),[0,3,5,8]);
 for(let k=0;k<frames.length;k++){
  const f=frames[k],i=[0,3,5,8][k];assert.equal(f.metadata.totalCharge,-1);assert.equal(f.metadata.multiplicity,2);assert.equal(f.metadata.afirCalculation.physicalEnergyEV,energies[i]);
  assert.equal(JSON.stringify(f.atoms.map(a=>a.id)),JSON.stringify(source.atomIds));assert.equal(JSON.stringify(f.atoms.map(a=>[a.x,a.y,a.z])),JSON.stringify(source.images[i]));
 }
 MV.Studio.frame(2);assert.match(nodes.get('profileValue').textContent,/E = 4.000000 eV/);
 assert.equal(JSON.stringify(app.renderer().state.atoms.map(a=>[a.x,a.y,a.z])),JSON.stringify(source.images[5]));
 const saved=MV.IO.parseProject(MV.IO.stateToProjectText(app.getState()));assert.equal(saved.metadata.trajectory.length,4);
 nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),before);
 MV.TrajectoryUI.open(source);nodes.get('trajectoryCount').value=4;nodes.get('trajectoryCount').fire('input');nodes.get('trajectoryApply').click();assert.match(nodes.get('framePlay').textContent,/停止/);assert.equal(app.getState().metadata.trajectory.length,4);
});

test('normal-mode rows, arrows and animation stay transient; explicit displacement is undoable and stale-safe',()=>{
 const {MV,nodes,timers}=boot(false,true,true),app=MV.App,base=MV.Periodic.snapshot(app.getState()),original=JSON.stringify(app.getState().atoms);
 MV.EngineUI={isBusy:()=>false};
 const n=base.atoms.length,v={schema:'molecule-vibrations/1',status:'completed',symbols:base.atoms.map(a=>a.element),positions:base.atoms.map(a=>[a.x,a.y,a.z]),frequenciesCM:Array(3*n).fill(100),quantaMEV:Array(3*n).fill(12.4),imaginary:Array(3*n).fill(false),modes:Array.from({length:3*n},()=>base.atoms.map((_,i)=>[i?-.5:1,0,0])),settings:{imaginaryThreshold:20},significantImaginaryCount:1,units:{frequency:'cm^-1',quantum:'meV'}};
 v.imaginary[0]=true;MV.VibrationUI.set(v,MV.Model.createState(base),'analytic test');MV.VibrationUI.show();
 assert.equal(nodes.get('vibrationRows').children.length,3*n);assert.equal(nodes.get('vibrationRows').children[0].className,'mv-imaginary');
 assert.equal(app.renderer().previewOnly,true);assert.ok(app.renderer().projectedModeArrows.length>0);assert.equal(app.renderer().vibrationVectors.color,'#c62828');
 const beforeScale=JSON.stringify(app.renderer().state.atoms);nodes.get('vibrationVectorScale').value='2';nodes.get('vibrationVectorScale').fire('input');
 assert.equal(app.renderer().vibrationVectors.vectors[0][0],2);assert.equal(app.renderer().vibrationVectors.vectors[1][0],-1);assert.equal(JSON.stringify(app.renderer().state.atoms),beforeScale);assert.equal(nodes.get('vibrationAmplitude').value,'0.15');
 nodes.get('vibrationRows').children[1].click();assert.equal(app.renderer().vibrationVectors.color,'#176cb0');assert.equal(JSON.stringify(app.getState().atoms),original);
 nodes.get('vibrationPlay').click();assert.match(nodes.get('vibrationPlay').textContent,/停止/);assert.equal(JSON.stringify(app.getState().atoms),original);
 nodes.get('vibrationAmplitude').value='.04';nodes.get('vibrationAmplitude').fire('input');nodes.get('vibrationPlus').click();
 assert.ok(Math.abs(app.getState().atoms[0].x-base.atoms[0].x-.04)<1e-12);assert.equal(app.getState().atoms[0].id,base.atoms[0].id);assert.equal(app.renderer().previewOnly,false);
 nodes.get('btnUndo').click();assert.equal(JSON.stringify(app.getState().atoms),original);
 app.change('unrelated edit',s=>{s.atoms[0].x+=1;});nodes.get('vibrationPlus').click();assert.match(nodes.get('vibrationMessage').textContent,/変更されています/);
 assert.equal(app.getState().atoms[0].x,base.atoms[0].x+1);
 assert.throws(()=>MV.VibrationUI.validate({...v,positions:[[0,0,0]]},v.symbols,v.positions));assert.throws(()=>MV.VibrationUI.vectors(v.modes[0],0));
 MV.VibrationUI.show();app.setState(app.getState(),true);assert.equal(app.renderer().vibrationVectors,null);assert.equal(app.renderer().previewOnly,false);
});

test('path insertion retains existing nodes, endpoints and IDs and interpolates only requested intervals',()=>{
 const {MV}=boot(false,true,true),base=MV.Periodic.snapshot(MV.App.getState());
 const frames=[0,.2,.8,1].map(x=>{const s=MV.Model.createState(base);s.atoms.forEach(a=>a.x+=x);s.metadata.externalCalculation={energyEV:x};return MV.Periodic.snapshot(s);});
 const before=JSON.stringify(frames),out=MV.PathRefinement.refine(frames,1,2,2);
 assert.equal(out.length,6);assert.equal(JSON.stringify(frames),before);
 for(const [a,b] of [[0,0],[1,1],[2,4],[3,5]])assert.equal(JSON.stringify(out[b]),JSON.stringify(frames[a]));
 assert.ok(Math.abs(out[2].atoms[0].x-.4)<1e-12);assert.ok(Math.abs(out[3].atoms[0].x-.6)<1e-12);
 assert.equal(out[2].metadata.externalCalculation,undefined);assert.deepEqual(out[2].atoms.map(a=>a.id),frames[0].atoms.map(a=>a.id));
 for(const args of [[1,1,1],[0,4,1],[0,3,33],[0,2,0]])assert.throws(()=>MV.PathRefinement.refine(frames,...args));
 const swapped=frames.map(f=>JSON.parse(JSON.stringify(f)));swapped[1].atoms[0].x=swapped[0].atoms[1].x;swapped[1].atoms[0].y=0;swapped[1].atoms[1].x=0;swapped[1].atoms[1].y=0;
 assert.throws(()=>MV.PathRefinement.refine(swapped,0,1,1),/衝突/);
});
test('manual coordinate editing and frame navigation never infer new bonds; explicit inference remains available',()=>{
 const {MV,nodes}=boot(false,true),app=MV.App;
 app.setState(MV.IO.parseXYZToState('C 0 0 0\nC 3 0 0'),true);
 const box=nodes.get('dataText');box.value='C 0 0 0\nC 1.4 0 0';box.fire('input');nodes.get('dataApply').click();
 assert.equal(app.getState().bonds.length,0);assert.equal(app.getState().atoms[1].x,1.4);
 nodes.get('btnReinferBonds').click();assert.equal(app.getState().bonds.length,1);
 const bonds=JSON.stringify(app.getState().bonds);
 app.getState().selectedAtomIds=new Set(app.getState().atoms.map(a=>a.id));nodes.get('targetDistance').value='4';nodes.get('btnApplyDistance').click();
 assert.equal(JSON.stringify(app.getState().bonds),bonds);
 const frames=[MV.Periodic.snapshot(app.getState()),MV.Periodic.snapshot(app.getState())];app.getState().metadata.trajectory=frames;
 MV.Studio.frame(1);MV.Studio.frame(0);assert.equal(JSON.stringify(app.getState().bonds),bonds);
 nodes.get('btnReinferBonds').click();assert.equal(app.getState().bonds.length,0);
});

test('fixed atom panel stores stable selections, flushes the visible draft and restores through undo',()=>{
 const {MV,nodes}=boot(false,false,false,null,true),app=MV.App;
 app.getState().selectedAtomIds=new Set([app.getState().atoms[0].id]);app.setState(app.getState(),true);
 nodes.get('constraintAddSelected').click();assert.deepEqual(Array.from(MV.Constraints.indices(app.getState())),[0]);
 nodes.get('constraintAtoms').value='1, 3';nodes.get('constraintAtoms').fire('input');
 app.getState().selectedAtomIds.clear();app.setState(app.getState(),true);assert.equal(nodes.get('constraintAtoms').value,'1, 3');
 MV.ConstraintUI.flush();assert.deepEqual(Array.from(MV.Constraints.indices(app.getState())),[0,2]);
 const project=MV.IO.stateToProjectText(app.getState());assert.match(project,/molecule-fixed-atoms/);
 nodes.get('btnUndo').click();assert.deepEqual(Array.from(MV.Constraints.indices(app.getState())),[0]);nodes.get('btnRedo').click();assert.deepEqual(Array.from(MV.Constraints.indices(app.getState())),[0,2]);
 nodes.get('constraintAtoms').value='99';nodes.get('constraintAtoms').fire('input');assert.throws(()=>MV.ConstraintUI.flush(),/原子番号/);assert.deepEqual(Array.from(MV.Constraints.indices(app.getState())),[0,2]);
 nodes.get('constraintClear').click();assert.deepEqual(Array.from(MV.Constraints.indices(app.getState())),[]);
 const ids=app.getState().atoms.map(a=>a.id);app.change('fragment',s=>{s.metadata.afir={fragments:[{id:'f',label:'group',atomIds:ids.slice(1)}]};});nodes.get('constraintGroup').value='f';nodes.get('constraintAddGroup').click();assert.deepEqual(Array.from(MV.Constraints.indices(app.getState())),[1,2]);
 app.getState().selectedAtomIds=new Set([ids[1]]);nodes.get('btnDeleteSel').click();assert.throws(()=>MV.Constraints.indices(app.getState()),/削除済み/);assert.match(nodes.get('constraintSummary').textContent,/削除済み/);
});

function fragmentEvent(env,type,text='',target=env.canvas){
 const data=new Map([['text/plain',text]]),event={type,target,clipboardData:{getData:t=>data.get(t)||'',setData:(t,v)=>data.set(t,v)},preventDefault(){this.defaultPrevented=true;}};
 for(const fn of env.doc.events[type]||[])fn(event);return {event,text:data.get('text/plain')};
}
const flushClipboard=()=>new Promise(resolve=>setImmediate(resolve));
test('native group clipboard adds selected internal bonds, one undo/redo and leaves text editors alone',()=>{
 const env=boot(),{MV,nodes,canvas,doc}=env,app=MV.App,s=app.getState();s.selectedAtomIds=new Set(s.atoms.slice(0,2).map(a=>a.id));app.setState(s,true);canvas.focus();
 const before=MV.IO.stateToProjectText(s),copy=fragmentEvent(env,'copy');assert.equal(copy.event.defaultPrevented,true);assert.match(copy.text,/V3000/);assert.equal(MV.IO.stateToProjectText(app.getState()),before);
 fragmentEvent(env,'paste',copy.text);const pasted=MV.IO.stateToProjectText(app.getState());assert.equal(app.getState().atoms.length,5);assert.equal(app.getState().bonds.length,3);assert.equal(app.getState().selectedAtomIds.size,2);assert.equal(nodes.get('toolMove').attrs['aria-pressed'],'true');assert.equal(doc.activeElement,canvas);
 nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),before);nodes.get('btnRedo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),pasted);
 const editor=nodes.get('dataText');editor.focus();assert.equal(fragmentEvent(env,'paste',copy.text,editor).event.defaultPrevented,undefined);assert.equal(fragmentEvent(env,'copy','',editor).event.defaultPrevented,undefined);assert.equal(MV.IO.stateToProjectText(app.getState()),pasted);
 canvas.focus();nodes.get('helpDialog').open=true;assert.equal(fragmentEvent(env,'paste',copy.text).event.defaultPrevented,undefined);nodes.get('helpDialog').open=false;
 fragmentEvent(env,'paste','bad clipboard');assert.equal(MV.IO.stateToProjectText(app.getState()),pasted);nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),before);
});
test('clipboard buttons fall back on denial, survive new document, and prefer actual OS clipboard when available',async()=>{
 const env=boot(),{MV,nodes,navigator}=env,app=MV.App,s=app.getState();s.selectedAtomIds=new Set(s.atoms.map(a=>a.id));app.setState(s,true);
 navigator.clipboard.writeText=async()=>{throw Error('denied');};nodes.get('btnCopySelection').click();await flushClipboard();assert.match(nodes.get('statusBadge').textContent,/ページ内/);
 nodes.get('btnNew').click();navigator.clipboard.readText=async()=>{throw Error('denied');};nodes.get('btnPasteSelection').click();await flushClipboard();assert.equal(app.getState().atoms.length,3);assert.equal(app.getState().atoms[0].x,0);assert.equal(app.getState().bonds.length,2);
 navigator.clipboard.readText=async()=> 'He 0 0 0';nodes.get('btnPasteSelection').click();await flushClipboard();assert.equal(app.getState().atoms.length,4);assert.equal(app.getState().atoms[3].element,'He');
 navigator.clipboard.readText=async()=> '';nodes.get('btnPasteSelection').click();await flushClipboard();assert.equal(app.getState().atoms.length,4);assert.match(nodes.get('statusBadge').textContent,/クリップボード/);
 nodes.get('btnUndo').click();assert.equal(app.getState().atoms.length,3);nodes.get('btnUndo').click();assert.equal(app.getState().atoms.length,0);
});
test('paste protects coordinate drafts, running calculations and changes during asynchronous clipboard access',async()=>{
 const env=boot(),{MV,nodes,navigator,canvas}=env,app=MV.App,s=app.getState();s.selectedAtomIds.add(s.atoms[0].id);app.setState(s,true);canvas.focus();const copy=fragmentEvent(env,'copy').text,before=MV.IO.stateToProjectText(s);
 nodes.get('dataText').value='C 0 0 0';nodes.get('dataText').fire('input');fragmentEvent(env,'paste',copy);assert.equal(MV.IO.stateToProjectText(app.getState()),before);assert.equal(nodes.get('dataText').value,'C 0 0 0');assert.match(nodes.get('statusBadge').textContent,/未適用/);
 nodes.get('dataReset').click();MV.EngineUI={isBusy:()=>true};fragmentEvent(env,'paste',copy);assert.match(nodes.get('statusBadge').textContent,/計算/);assert.equal(MV.IO.stateToProjectText(app.getState()),before);MV.EngineUI={isBusy:()=>false};
 let resolve;navigator.clipboard.readText=()=>new Promise(r=>resolve=r);nodes.get('btnPasteSelection').click();nodes.get('btnNew').click();resolve(copy);await flushClipboard();assert.equal(app.getState().atoms.length,0);assert.match(nodes.get('statusBadge').textContent,/待機中に構造/);
 nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),before);
});
test('copy and paste use displayed calculation geometry; paste adopts it in one undo step',()=>{
 const env=boot(false,true),{MV,nodes,canvas}=env,app=MV.App,s=app.getState();s.selectedAtomIds.add(s.atoms[0].id);app.setState(s,true);const before=MV.IO.stateToProjectText(s),base=MV.Periodic.snapshot(s);
 MV.EnergyProfile.set({title:'copy displayed',kind:'path',energies:[0,1],base:()=>base,positions:i=>base.atoms.map(a=>[a.x+2*i,a.y,a.z])});MV.EnergyProfile.select(1);canvas.focus();
 const copy=fragmentEvent(env,'copy').text;assert.equal(MV.IO.parseMolToState(copy).atoms[0].x,2);assert.equal(MV.IO.stateToProjectText(app.getState()),before);
 fragmentEvent(env,'paste',copy);assert.equal(app.getState().atoms.length,4);assert.equal(app.getState().atoms[0].x,2);assert.equal(app.renderer().previewOnly,false);assert.equal(app.getState().metadata.trajectory,undefined);
 nodes.get('btnUndo').click();assert.equal(MV.IO.stateToProjectText(app.getState()),before);
});
