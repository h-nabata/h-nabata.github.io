const test=require('node:test'),assert=require('node:assert/strict'),O=require('../optimization.js'),T=require('../trajectory.js');
const cell=(a=4,b=5,c=6)=>({vectors:[[a,0,0],[.2*b,b,0],[.1*c,.2*c,c]],pbc:[true,true,true]});
test('cell modes enforce their exact degrees of freedom and finite cells',()=>{
 const data={cell:cell(),cellOptimization:{mode:'isotropic'}};
 O.checkCell(cell(4.4,5.5,6.6),data);assert.throws(()=>O.checkCell(cell(4.4,5.6,6.6),data));
 O.checkCell(cell(4.4,5.6,6.6),{...data,cellOptimization:{mode:'fixed_angles'}});
 O.checkCell(cell(4,5,7),{...data,cellOptimization:{mode:'c'}});assert.throws(()=>O.checkCell(cell(4,6,7),{...data,cellOptimization:{mode:'c'}}));
 const bent=cell(4,5,7);bent.vectors[2][0]+=.3;O.checkCell(bent,{...data,cellOptimization:{mode:'c_vector'}});assert.throws(()=>O.checkCell(bent,{...data,cellOptimization:{mode:'c'}}));
 const invalid=cell();invalid.vectors[2]=invalid.vectors[0];assert.equal(O.validCell(invalid),false);
});
test('stable IDs restore directional/rigid/coordinate constraints and reject deleted atoms',()=>{
 const state={atoms:['a','b','c'].map(id=>({id})),metadata:{}},data={mode:'optimize',fixedComponents:[{atom:0,axes:[false,false,true]}],rigidGroups:[[1,2]],internalConstraints:[{type:'angle',atoms:[0,1,2],value:120}]};
 O.attach(state,data);state.atoms.reverse();const wire={mode:'optimize'};O.forJob(state,wire,{advancedOptimization:true});assert.equal(wire.fixedComponents[0].atom,2);assert.deepEqual(wire.rigidGroups,[[1,0]]);assert.deepEqual(state.metadata.optimization.coordinates[0].atomIds,['a','b','c']);
 state.atoms.pop();assert.throws(()=>O.forJob(state,wire,{advancedOptimization:true}),/削除/);
});
test('result verification rejects moved fixed components and deformed rigid groups',()=>{
 const data={images:[[[0,0,0],[1,0,0]]],fixedComponents:[{atom:0,axes:[false,false,true]}],rigidGroups:[[0,1]]};
 O.checkPositions([[[1,1,0],[1,2,0]]],data);assert.throws(()=>O.checkPositions([[[1,1,.1],[1,2,.1]]],data));assert.throws(()=>O.checkPositions([[[1,1,0],[1,3,0]]],data));
});
test('variable-cell trajectories export the lattice for each frame and reject missing cells',()=>{
 const source={kind:'optimize',symbols:['He'],images:[[[0,0,0]],[[.1,0,0]]],energies:[0,-1],cell:cell(),cells:[cell(),cell(4,5,7)]};
 const xyz=T.xyz(source,[0,1]);assert.equal((xyz.match(/Lattice=/g)||[]).length,2);assert.ok(xyz.includes('7.000000')||xyz.includes('7"')||xyz.includes('1.4 7'));
 assert.throws(()=>T.validate({...source,cells:[cell()]}));
});
