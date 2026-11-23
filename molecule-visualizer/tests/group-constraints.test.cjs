const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../group-constraints.js');
const w={};vm.runInNewContext(fs.readFileSync(require.resolve('../geometry.js'),'utf8'),{window:w});const mass=w.MoleculeVisualizer.Geometry.atomicMass;
const state=()=>({atoms:[{id:'o',element:'O',x:0,y:0,z:0},{id:'h',element:'H',x:1,y:0,z:0},{id:'d',element:'H',x:3,y:0,z:0,mol:{props:{MASS:'2'}}},{id:'x',element:'H',x:4,y:0,z:0}],metadata:{groupConstraints:{...C.defaults(),enabled:true,groups:[{id:'g1',label:'A',enabled:true,atomIds:['o','h']},{id:'g2',label:'B',enabled:true,atomIds:['d','x']}]}}});
const data=s=>({mode:'optimize',symbols:s.atoms.map(a=>a.element),images:[s.atoms.map(a=>[a.x,a.y,a.z])],cell:null});
const wire=(s=state(),patch={},info={groupConstraints:true})=>C.forJob(s,{...data(s),...patch},info,mass);
test('group IDs survive reordering and subsets are explicit; masses respect explicit inputs',()=>{
 const s=state(),c=wire(s);assert.deepEqual(c.groups,[[0,1],[2,3]]);assert.equal(c.masses[2],2);
 s.atoms.reverse();assert.deepEqual(wire(s).groups,[[3,2],[1,0]]);
 s.metadata.groupConstraints.groups[0].enabled=false;assert.deepEqual(wire(s).groups,[[1,0]]);
 assert.equal(mass({element:'H',xyzExtras:{mass:{values:['2.014101778']}}}),2.014101778);
 for(const v of ['',0,-1,NaN,Infinity,500])assert.throws(()=>mass({element:'H',xyzExtras:{mass:{values:[v]}}}));
});
test('overlap, deleted members, bad projects, unsupported services and calculations fail before sending',()=>{
 const s=state();s.metadata.groupConstraints.enabled=false;assert.equal(wire(s,{mode:'ts'},{}),null);
 s.metadata.groupConstraints.enabled=true;
 for(const mode of ['evaluate','ts','irc','cineb','lup','vibrations'])assert.throws(()=>wire(s,{mode}),/専用/);
 assert.throws(()=>wire(s,{vibrations:{}}),/専用/);assert.throws(()=>wire(s,{},{}),/bridge.py/);
 assert.throws(()=>wire(s,{cell:{pbc:[true,false,false]}}),/bridge.py/);
 assert.throws(()=>wire(s,{symbols:['H','H','H','O']}),/File-order/);
 s.metadata.groupConstraints.groups[1].atomIds.push('h');assert.throws(()=>wire(s),/重複/);s.metadata.groupConstraints.groups[1].atomIds.pop();
 s.atoms.pop();assert.throws(()=>wire(s),/削除済み/);
 s.metadata.groupConstraints.groups=[];assert.throws(()=>wire(s),/1個以上/);
 s.metadata.groupConstraints.mode='distance';assert.throws(()=>C.config(s),/不正/);
});
test('relative centers allow common translation and mass-balanced deformations, not independent drift',()=>{
 const s=state(),d=data(s);d.groupConstraints=wire(s);const c=d.groupConstraints;
 const p=structuredClone(d.images[0]);p.forEach(v=>v[0]+=2);
 p[0][1]+=.1;p[1][1]-=.1*c.masses[0]/c.masses[1];
 C.checkPositions([p],d);
 const r={images:[p],groupConstraints:{...c,referenceCenters:C.centers(d.images[0],c)},trajectory:{images:[d.images[0],p]}};
 C.validateResult(r,d);
 for(const change of [r=>r.images[0][2][0]+=.01,r=>r.groupConstraints.masses[0]=12,r=>r.groupConstraints.groups.reverse(),r=>r.groupConstraints.referenceCenters[0][0]=NaN,r=>delete r.groupConstraints]){const bad=structuredClone(r);change(bad);assert.throws(()=>C.validateResult(bad,d));}
 const bad=structuredClone(r);bad.trajectory.images[0][0][1]=.1;assert.throws(()=>C.validateResult(bad,d));
});
test('single group and absolute mode pin centers; attach restores indices as stable IDs',()=>{
 const s=state(),d=data(s);d.groupConstraints=wire(s);d.groupConstraints.mode='absolute';
 const p=structuredClone(d.images[0]);p.forEach(v=>v[0]+=1);assert.throws(()=>C.checkPositions([p],d));
 d.groupConstraints.mode='relative';d.groupConstraints.groups=[d.groupConstraints.groups[0]];assert.throws(()=>C.checkPositions([p],d));
 C.attach(s,d.groupConstraints);assert.deepEqual(s.metadata.groupConstraints.groups[0].atomIds,['o','h']);
 const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(wire(restored).groups,[[0,1]]);
});
test('periodic jobs record the selected input images and reject a result with another convention',()=>{
 const s=state(),cell={vectors:[[5,0,0],[1,6,0],[0,0,17]],pbc:[true,true,false]},d={...data(s),cell};
 const info={groupConstraints:true,advancedOptimization:true,periodicGroupImages:'input-cartesian'};
 d.groupConstraints=wire(s,{cell},info);
 assert.equal(d.groupConstraints.imageConvention,'input-cartesian');
 const r={images:d.images,groupConstraints:{...d.groupConstraints,referenceCenters:C.centers(d.images[0],d.groupConstraints)}};
 C.validateResult(r,d);delete r.groupConstraints.imageConvention;assert.throws(()=>C.validateResult(r,d),/条件/);
 const O=require('../optimization.js');s.metadata.optimization={rigidGroups:[{atomIds:['o','x']}]};
 assert.throws(()=>O.forJob(s,d,{advancedOptimization:true}),/bridge.py/);
 O.forJob(s,d,info);assert.equal(d.rigidGroupImages,'input-cartesian');
 assert.throws(()=>O.validateResult({...r,cell},d),/周期像/);
 O.validateResult({...r,cell,rigidGroupImages:d.rigidGroupImages},d);
});
test('compact-group preparation gathers only selected atoms onto the closest image to the first file atom',()=>{
 const P=require('../periodic.js'),cell=P.cell([[4,0,0],[2,5,0],[0,0,15]],[true,true,false]);
 const s=state();s.metadata.cell=cell;s.selectedAtomIds=new Set(['d','o','h']);
 Object.assign(s.atoms[0],{x:0,y:.25,z:18});
 Object.assign(s.atoms[1],{x:6.25,y:5,z:-13});
 Object.assign(s.atoms[2],{x:.5,y:.5,z:19});
 const original=structuredClone(s.atoms);
 assert.equal(C.gatherSelectedImages(s,P.prepareMinimumImage),1);
 assert.deepEqual(s.atoms[1],{...original[1],x:.25,y:0});
 for(const i of [0,2,3])assert.deepEqual(s.atoms[i],original[i]);
 assert.equal(C.gatherSelectedImages(s,P.prepareMinimumImage),0);
 assert.throws(()=>C.gatherSelectedImages({...s,selectedAtomIds:new Set(['o'])},P.prepareMinimumImage),/2個/);
});
