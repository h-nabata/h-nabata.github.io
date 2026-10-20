const test=require('node:test'),assert=require('node:assert/strict'),A=require('../structure-analysis.js');
const reference=[[0,0,0],[1,0,0],[0,2,0],[0,0,3]],symbols=['C','H','N','O'];
const moved=reference.map(([x,y,z])=>[4-y,2+x,z-9]);
const det=r=>r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])-r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])+r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]);
test('proper rigid fit removes arbitrary rotation/translation without mutation',()=>{
 const before=JSON.stringify([reference,moved]);const r=A.align(reference,moved,{referenceSymbols:symbols,mobileSymbols:symbols});assert.ok(r.rmsd<1e-12);assert.ok(Math.abs(det(r.rotation)-1)<1e-12);assert.equal(JSON.stringify([reference,moved]),before);
});
test('mirror images retain a nonzero RMSD; reflections never eliminate chirality',()=>{
 const mirror=reference.map(([x,y,z])=>[-x,y,z]),r=A.align(reference,mirror);assert.ok(r.rmsd>.3);assert.ok(Math.abs(det(r.rotation)-1)<1e-12);
});
test('stable IDs allow explicit reordering but do not guess chemically equivalent atom permutations',()=>{
 const order=[2,0,3,1],r=A.align(reference,order.map(i=>moved[i]),{referenceSymbols:symbols,mobileSymbols:order.map(i=>symbols[i]),referenceIds:['a','b','c','d'],mobileIds:order.map(i=>['a','b','c','d'][i])});assert.ok(r.rmsd<1e-12);assert.equal(r.correspondence,'stableIds');
 assert.throws(()=>A.align(reference,order.map(i=>moved[i]),{referenceSymbols:symbols,mobileSymbols:order.map(i=>symbols[i])}),/対応/);
});
test('heavy atom fitting ignores H only in objective, retains its displacement and complete transformed structure',()=>{
 const altered=moved.map(p=>p.slice());altered[1][0]+=1;
 const r=A.align(reference,altered,{referenceSymbols:symbols,mobileSymbols:symbols,selection:'heavy'});assert.ok(r.rmsd<1e-12);assert.ok(Math.abs(r.allAtomRMSD-.5)<1e-12);assert.equal(r.positions.length,4);assert.throws(()=>A.align([[0,0,0]],[[0,0,0]],{selection:'heavy',referenceSymbols:['H']}));
});
test('single atoms, collinear and symmetric fits remain finite and proper',()=>{
 for(const p of [[[1,2,3]],[[0,0,0],[1,0,0],[2,0,0]],[[1,1,0],[-1,1,0],[-1,-1,0],[1,-1,0]]]){
  const r=A.align(p,p.map(([x,y,z])=>[-y+7,x-3,z+4]));assert.ok(r.rmsd<1e-10);assert.ok(Math.abs(det(r.rotation)-1)<1e-12);
 }
});
test('leader clustering selects lowest energy only within matching known conditions',()=>{
 const changed=reference.map(p=>p.slice());changed[3][2]=4;
 const r=A.deduplicate([reference,moved,changed,reference],{symbols,energies:[-1,-2,-3,-9],conditionKeys:['same','same','same','other'],threshold:.05});
 assert.equal(r.clusters.length,3);assert.equal(r.clusters[0].representative,1);assert.deepEqual(r.clusters[0].members,[1,0]);assert.ok(r.representatives.includes(3));
 const unknown=A.deduplicate([reference,moved],{symbols,energies:[-1,-2]});assert.equal(unknown.representatives[0],0);assert.equal(unknown.clusters[0].energyComparable,false);
 const unverified=A.deduplicate([reference,moved],{symbols,energies:[-1,-2],conditionKeys:['unknown:0','unknown:0'],energyComparable:[false,false]});assert.equal(unverified.representatives[0],0);
});
test('leader clusters do not claim transitive neighbors are all close to representative',()=>{
 const p=d=>[[0,0,0],[1+d,0,0]];
 const r=A.deduplicate([p(0),p(.15),p(.30)],{threshold:.1});assert.equal(r.clusters.length,2);assert.deepEqual(r.clusters[0].members,[0,1]);
});
test('invalid coordinates, identities, thresholds and mismatched frames are rejected',()=>{
 for(const pair of [[[],[]],[[[NaN,0,0]],[[0,0,0]]],[reference,[[0,0,0]]]])assert.throws(()=>A.align(...pair));
 assert.throws(()=>A.align(reference,moved,{indices:[0,0]}));assert.throws(()=>A.deduplicate([reference],{threshold:-1}));assert.throws(()=>A.deduplicate([reference],{energies:[0,1]}));
});
