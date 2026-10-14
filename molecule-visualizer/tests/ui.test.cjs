// Browser-independent integration checks; a visual browser pass is still required.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function boot(afir=false){
 const nodes=new Map(),doc={activeElement:null,events:{},addEventListener(t,f){(this.events[t]??=[]).push(f);}};
 class El{
  constructor(id=''){this.id=id;this.value='';this.children=[];this.events={};this.dataset={};this.attrs={};this.style={};this.checked=false;this.open=false;this.classList={toggle(){},add(){},remove(){}};this.clientWidth=800;this.clientHeight=500;this.tagName='DIV';}
  appendChild(x){this.children.push(x);return x;}append(...xs){xs.forEach(x=>this.appendChild(x));}removeChild(x){this.children=this.children.filter(c=>c!==x);}replaceChildren(...xs){this.children=xs;if(xs[0]?.value)this.value=xs[0].value;}
  set innerHTML(v){this.children=[];}get innerHTML(){return '';}
  setAttribute(k,v){this.attrs[k]=v;}addEventListener(t,f){(this.events[t]??=[]).push(f);}getBoundingClientRect(){return {width:800,height:500,left:0,top:0};}setPointerCapture(){}focus(){doc.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;}contains(){return false;}
  getContext(){return new Proxy({createRadialGradient(){return {addColorStop(){}};}},{get:(o,k)=>o[k]||(()=>{})});}
  toDataURL(){return 'data:image/png;base64,';}fire(type,extra={}){const e={type,target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},stopImmediatePropagation(){},...extra};for(const f of this.events[type]||[])f(e);return e;}click(){this.fire('click');}
 }
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 for(const m of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const e=new El(m[3]);e.tagName=m[1].toUpperCase();e.value=m[2].match(/value="([^"]*)"/)?.[1]||'';e.dataset.tab=m[2].match(/data-tab="([^"]*)"/)?.[1];nodes.set(m[3],e);}
 for(const [k,v] of Object.entries({bondOrder:'1',bondType:'covalent',styleSelect:'stickball',addMode:'custom',fragPlace:'offset',fragScale:'1',fragAnchorIndex:'1',fragBondDistance:'1.45',fragBondOrder:'1'}))nodes.get(k).value=v;
 const app=new El();doc.getElementById=id=>nodes.get(id)||null;doc.createElement=()=>new El();doc.body=new El();
 const tables={'#atomTable tbody':new El(),'#bondTable tbody':new El()};
 doc.querySelector=q=>tables[q]||((q==='.mv-app'||q==='.mv-inspector')?app:q==='dialog[open]'?[...nodes.values()].find(x=>x.open):null);
 doc.querySelectorAll=q=>q==='[data-tab]'?[...nodes.values()].filter(x=>x.dataset.tab):[];
 const timers=new Map();let seq=0;const win={document:doc,devicePixelRatio:1,addEventListener(){}};
 const ctx={window:win,document:doc,navigator:{clipboard:{writeText:async()=>{}}},localStorage:{getItem(){return null;},setItem(){}},setTimeout(f){timers.set(++seq,f);return seq;},clearTimeout(i){timers.delete(i);},Blob,URL,console};
 vm.createContext(ctx);for(const f of ['model','bonding','geometry','io','molfile','periodic','formats','history','renderer3dmol','ui'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);
 if(afir)for(const f of ['afir','afir-ui'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);win.MoleculeVisualizer.App.init();if(afir)win.MoleculeVisualizer.AFIRUI.init();return {MV:win.MoleculeVisualizer,nodes,doc,canvas:nodes.get('viewer').children[0]};
}
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
test('trackball reaches roll and inverted orientations without changing coordinates; inverse stays stable',()=>{
 const {MV,canvas,nodes}=boot(),r=MV.App.renderer(),before=JSON.stringify(MV.App.getState().atoms);
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`),drag=(x,y,u,v)=>{canvas.fire('pointerdown',{pointerId:21,button:0,clientX:x,clientY:y});canvas.fire('pointermove',{pointerId:21,clientX:u,clientY:v});canvas.fire('pointerup',{pointerId:21,clientX:u,clientY:v});};
 nodes.get('btnViewXY').click();drag(650,250,400,0);let p=r.rotate({x:1,y:0,z:0});near(p.x,0);near(p.y,1);near(p.z,0);p=r.rotate({x:0,y:0,z:1});near(p.z,1); // 90-degree roll: unreachable in the old two-angle camera.
 nodes.get('btnViewXY').click();drag(400,250,400+Math.PI/.008,250);p=r.rotate({x:0,y:0,z:1});near(p.z,-1); // Complete inversion, crossing the old poles.
 drag(400,250,400,100);assert.ok(Math.abs(r.rotate({x:0,y:0,z:1}).y)>.1);
 for(let i=0;i<5000;i++)r.rotateTrackball(400,250,400+80*Math.sin(i),250+70*Math.cos(i));
 near(Math.hypot(...r.orientation),1);const v=[.7,-2.1,3.2],w=r.rotate({x:v[0],y:v[1],z:v[2]});r.viewVectorToWorld([w.x,w.y,w.z]).forEach((x,i)=>near(x,v[i]));
 const delta=r.screenDeltaToWorld(24,-16,false),screen=r.rotate(delta);near(screen.x,24/r.currentScale);near(screen.y,16/r.currentScale);near(screen.z,0);
 const basis=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}].map(v=>r.rotate(v));for(let i=0;i<3;i++)for(let j=0;j<3;j++)near(basis[i].x*basis[j].x+basis[i].y*basis[j].y+basis[i].z*basis[j].z,i===j?1:0);
 assert.equal(JSON.stringify(MV.App.getState().atoms),before);nodes.get('btnViewXY').click();near(r.rotate({x:1,y:2,z:3}).y,2);
 r.rotateTrackball(175,250,625,250);near(Math.hypot(...r.orientation),1); // Single-event antipodal drag.
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
test('B toggles exactly the selected pair, survives inference, ignores repeat, and supports undo',()=>{
 const {MV,canvas,nodes}=boot(),app=MV.App,s=app.getState();s.selectedAtomIds=new Set(s.atoms.slice(0,2).map(a=>a.id));app.setState(s,true);canvas.focus();
 const count=s.bonds.length;canvas.fire('keydown',{key:'b'});assert.equal(app.getState().bonds.length,count-1);
 MV.Bonding.refreshInferredBonds(app.getState());assert.equal(app.getState().bonds.length,count-1);canvas.fire('keydown',{key:'b',repeat:true});assert.equal(app.getState().bonds.length,count-1);
 canvas.fire('keydown',{key:'b'});assert.equal(app.getState().bonds.length,count);nodes.get('btnUndo').click();assert.equal(app.getState().bonds.length,count-1);nodes.get('btnUndo').click();assert.equal(app.getState().bonds.length,count);
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
 canvas.fire('keydown',{key:']',repeat:true});near(atom('C').z,Math.sin(theta));press('[');near(atom('C').z,0);
 press('.');for(const id of ['B','C','D'])near(atom(id).x,1.6);near(atom('F').x,-1);press(',');near(atom('B').x,1.5);
 press('<');near(atom('B').x,1.4);nodes.get('btnUndo').click();near(atom('B').x,1.5);nodes.get('btnRedo').click();near(atom('B').x,1.4);press('>');near(atom('B').x,1.5);
 assert.deepEqual([...app.getState().selectedAtomIds],['A','B']);assert.equal(JSON.stringify(app.getState().bonds),bonds);
 app.setState(shortcutMolecule(MV.Model),true);app.getState().selectedAtomIds=new Set(['B','A']);press('.');near(atom('A').x,-.1);near(atom('F').x,-1.1);near(atom('B').x,1.5);near(atom('C').x,1.5);
 nodes.get('btnUndo').click();assert.equal(JSON.stringify(app.getState().atoms),original);
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
 pick(app.renderer().projectedAtoms[1]);nodes.get('afirName').value='H group';nodes.get('afirAddFragment').click();
 nodes.get('afirA').value='f1';nodes.get('afirB').value='f2';nodes.get('afirMode').value='attract';nodes.get('afirGamma').value='100';nodes.get('afirAddPair').click();
 assert.equal(app.getState().metadata.afir.pairs.length,1);assert.equal(nodes.get('afirCheck').disabled,false);
 nodes.get('afirCheck').click();assert.match(nodes.get('afirStatus').textContent,/人工項のみ評価/);
 nodes.get('afirAddPair').click();assert.equal(app.getState().metadata.afir.pairs.length,1);assert.match(nodes.get('afirStatus').textContent,/重複/);
 nodes.get('afirSteps').value='4';nodes.get('afirFmax').value='0.00001';nodes.get('afirMove').value='0.02';
 nodes.get('afirCheck').click();assert.equal(app.getState().metadata.afir.maxSteps,4);assert.equal(app.getState().metadata.afir.fmax,.00001);
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


test('malformed imported AFIR settings cannot break the editor and can be reset with undo',()=>{
 const {MV,nodes}=boot(true);MV.App.change('import invalid AFIR',s=>{s.metadata.afir={schema:'bad',fragments:{bad:true},pairs:[]};});
 assert.match(nodes.get('afirStatus').textContent,/形式が不正/);assert.equal(nodes.get('afirRun').disabled,true);
 nodes.get('btnAFIR').click();assert.equal(nodes.get('afirPanel').hidden,false);
 nodes.get('afirReset').click();assert.equal(MV.App.getState().metadata.afir.schema,'molecule-afir/1');
 nodes.get('btnUndo').click();assert.equal(MV.App.getState().metadata.afir.schema,'bad');assert.equal(nodes.get('afirRun').disabled,true);
});
