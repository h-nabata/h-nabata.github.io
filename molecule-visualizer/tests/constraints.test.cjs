const test=require('node:test'),assert=require('node:assert/strict'),C=require('../constraints.js');
const state=()=>({atoms:[{id:'a',element:'O'},{id:'b',element:'H'},{id:'c',element:'H'}],metadata:{}});
test('fixed atom IDs survive reordering; parser supports lists and inclusive ranges',()=>{
 const s=state();assert.deepEqual(C.parse('1, 2-3 1',s.atoms),['a','b','c']);
 C.attach(s,[0,2]);s.atoms.reverse();assert.deepEqual(C.indices(s),[0,2]);
 for(const input of ['0','4','3-2','1.5','1-99999999','a'])assert.throws(()=>C.parse(input,s.atoms));
 s.atoms.pop();assert.throws(()=>C.indices(s),/削除済み/);s.metadata.constraints.enabled=false;assert.deepEqual(C.indices(s),[]);
});
test('fixed job requests reject all-fixed, mismatched batches and unsupported old services',()=>{
 const s=state();C.attach(s,[0]);const data={mode:'optimize',symbols:['O','H','H']};
 assert.deepEqual(C.forJob(s,data,{fixedAtoms:true}),[0]);assert.throws(()=>C.forJob(s,data,{}),/bridge.py/);
 for(const mode of ['ts','cineb','vibrations'])assert.throws(()=>C.forJob(s,{...data,mode}),/専用/);
 assert.throws(()=>C.forJob(s,{...data,vibrations:{}}),/専用/);assert.throws(()=>C.forJob(s,{...data,symbols:['H','O','H']}),/File-order/);
 C.attach(s,[0,1,2]);assert.throws(()=>C.indices(s),/全原子/);
});
test('result acceptance rejects moved fixed atoms, omitted constraints and corrupted intermediate frames',()=>{
 const data={fixedAtoms:[0],images:[[[0,0,0],[1,0,0]]]},r={fixedAtoms:[0],images:[[[0,0,0],[.9,0,0]]],trajectory:{images:[[[0,0,0],[1,0,0]],[[0,0,0],[.9,0,0]]]}};
 C.validateResult(r,data);
 for(const mutate of [r=>r.fixedAtoms=[],r=>r.images[0][0][0]=1e-15,r=>r.trajectory.images[0][0][2]=.01]){const bad=structuredClone(r);mutate(bad);assert.throws(()=>C.validateResult(bad,data));}
});
