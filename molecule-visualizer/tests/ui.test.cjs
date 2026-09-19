// Browser-independent integration checks; a visual browser pass is still required.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function boot(){
 const nodes=new Map(),doc={activeElement:null,events:{},addEventListener(t,f){(this.events[t]??=[]).push(f);}};
 class El{
  constructor(id=''){this.id=id;this.value='';this.children=[];this.events={};this.dataset={};this.attrs={};this.style={};this.checked=false;this.open=false;this.classList={toggle(){},add(){},remove(){}};this.clientWidth=800;this.clientHeight=500;this.tagName='DIV';}
  appendChild(x){this.children.push(x);return x;}append(x){this.appendChild(x);}removeChild(x){this.children=this.children.filter(c=>c!==x);}replaceChildren(...xs){this.children=xs;if(xs[0]?.value)this.value=xs[0].value;}
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
 doc.querySelector=q=>tables[q]||(q==='.mv-app'?app:q==='dialog[open]'?[...nodes.values()].find(x=>x.open):null);
 doc.querySelectorAll=q=>q==='[data-tab]'?[...nodes.values()].filter(x=>x.dataset.tab):[];
 const timers=new Map();let seq=0;const win={document:doc,devicePixelRatio:1,addEventListener(){}};
 const ctx={window:win,document:doc,navigator:{clipboard:{writeText:async()=>{}}},localStorage:{getItem(){return null;},setItem(){}},setTimeout(f){timers.set(++seq,f);return seq;},clearTimeout(i){timers.delete(i);},Blob,URL,console};
 vm.createContext(ctx);for(const f of ['model','bonding','geometry','io','molfile','periodic','formats','history','renderer3dmol','ui'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);
 win.MoleculeVisualizer.App.init();return {MV:win.MoleculeVisualizer,nodes,doc,canvas:nodes.get('viewer').children[0]};
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
 const old=JSON.stringify(app.getState().atoms);gesture(2,false,0,0,800,500);assert.equal(app.getState().selectedAtomIds.size,4);assert.equal(JSON.stringify(app.getState().atoms),old);
});
test('right click adds atoms without clearing or toggling selection; cancel does not add',()=>{
 const {MV,canvas}=boot(),r=MV.App.renderer(),s=MV.App.getState();
 s.selectedAtomIds=new Set([s.atoms[0].id]);MV.App.setState(s,true);const p=r.projectedAtoms[1];
 const click=end=>{canvas.fire('pointerdown',{pointerId:11,button:2,clientX:p.x,clientY:p.y});canvas.fire(end,{pointerId:11,button:2,clientX:p.x,clientY:p.y});};
 click('pointercancel');assert.equal(s.selectedAtomIds.size,1);click('pointerup');assert.equal(s.selectedAtomIds.size,2);assert.ok(s.selectedAtomIds.has(s.atoms[0].id));click('pointerup');assert.equal(s.selectedAtomIds.size,2);
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
test('text editor imports multi-record SDF and CIF as complete documents and preserves failed drafts',()=>{
 const {MV,nodes}=boot(),app=MV.App,box=nodes.get('dataText');const molecule=MV.IO.parseXYZToState('C 0 0 0\nO 1.2 0 0');molecule.bonds[0].order=2;molecule.bonds[0].source='manual';
 const sdf=MV.IO.stateToSDFText(molecule);box.value=sdf+sdf;box.fire('input');nodes.get('dataApply').click();assert.equal(app.getState().metadata.trajectory.length,2);assert.equal(app.getState().bonds[0].order,2);nodes.get('btnUndo').click();assert.equal(app.getState().atoms.length,3);nodes.get('dataReset').click();
 box.value='data_cell\n_cell_length_a 5\n_cell_length_b 5\n_cell_length_c 5\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nC .2 .4 .6\n';box.fire('input');nodes.get('dataApply').click();assert.equal(app.getState().atoms.length,1);assert.ok(app.getState().metadata.cell);assert.match(box.value,/TV /);
 const before=JSON.stringify(app.getState());box.value='data_bad\nloop_\n_atom_site_fract_x\n.2';box.fire('input');nodes.get('dataApply').click();assert.equal(JSON.stringify(app.getState()),before);assert.match(box.value,/data_bad/);
});
