const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../afir.js');
const atoms=[{id:'h1',element:'H',x:0,y:0,z:0},{id:'h2',element:'H',x:2,y:0,z:0},{id:'o1',element:'O',x:.5,y:2,z:.3},{id:'c1',element:'C',x:2.8,y:1,z:-.2}];
function config(){return {...A.defaults(),fragments:[{id:'a',label:'A',atomIds:['h1']},{id:'b',label:'B',atomIds:['h2']}],pairs:[{a:'a',b:'b',mode:'attract',gamma:100}]};}
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('AFIR accepts the 10000-step default and rejects budgets outside 1..10000',()=>{
  const c=config();assert.equal(c.maxSteps,10000);A.validate(atoms,c);
  for(const maxSteps of [1,500,1000,10000])A.validate(atoms,{...c,maxSteps});
  for(const maxSteps of [0,10001,1.5])assert.throws(()=>A.validate(atoms,{...c,maxSteps}),/最大ステップ数/);
});
test('Ar conversion: independent published equation, known values, zero is explicitly off',()=>{
  const direct=g=>g*A.KJMOL_TO_EV/((2**(-1/6)-(1+Math.sqrt(1+g/1.0061))**(-1/6))*3.8164);
  for(const g of [1,40,100,500,1000])close(A.alphaFromGamma(g),direct(g),1e-12);
  close(A.alphaFromGamma(100),1.231377945352612,2e-7);assert.equal(A.alphaFromGamma(0),0);
  assert.ok(Number.isFinite(A.alphaFromGamma(1e-10)));for(const g of [-1,1001,NaN,Infinity,'100',true])assert.throws(()=>A.alphaFromGamma(g));
});
test('two single-atom fragments: bias alpha*r and force direction are analytic',()=>{
  const c=config(),b=A.evaluate(atoms,c),a=A.alphaFromGamma(100);close(b.energyEV,2*a);close(b.forcesEV_A[0][0],a);close(b.forcesEV_A[1][0],-a);assert.deepEqual(b.forcesEV_A[2],[0,0,0]);
  c.pairs[0].mode='repel';close(A.evaluate(atoms,c).forcesEV_A[0][0],-a);
  c.pairs[0].gamma=0;close(A.evaluate(atoms,c).energyEV,0);
});
test('weighted multi-atom, multi-pair bias matches energy finite differences; net force and torque vanish',()=>{
  const c=config();c.fragments.push({id:'c',label:'C',atomIds:['o1','c1']});c.pairs.push({a:'b',b:'c',mode:'repel',gamma:40});c.pairs.push({a:'a',b:'c',mode:'attract',gamma:80});
  const b=A.evaluate(atoms,c),h=1e-5;for(let i=0;i<4;i++)for(const [k,axis] of ['x','y','z'].entries()){const p=structuredClone(atoms),m=structuredClone(atoms);p[i][axis]+=h;m[i][axis]-=h;close(b.forcesEV_A[i][k],-(A.evaluate(p,c).energyEV-A.evaluate(m,c).energyEV)/(2*h),1e-8);}
  for(let k=0;k<3;k++)close(b.forcesEV_A.reduce((n,f)=>n+f[k],0),0);
  const torque=[0,0,0];atoms.forEach((a,i)=>{const f=b.forcesEV_A[i];torque[0]+=a.y*f[2]-a.z*f[1];torque[1]+=a.z*f[0]-a.x*f[2];torque[2]+=a.x*f[1]-a.y*f[0];});torque.forEach(v=>close(v,0));
  const transformed=atoms.map(a=>({...a,x:10-a.y,y:a.x-5,z:a.z+2}));close(A.evaluate(transformed,c).energyEV,b.energyEV);
});
test('ID resolution survives reorder and export has explicit 1-based correspondence',()=>{
  const c=config(),original=A.evaluate(atoms,c),reordered=[atoms[3],atoms[1],atoms[0],atoms[2]];
  close(A.evaluate(reordered,c).energyEV,original.energyEV);
  const out=A.exportInput({atoms:reordered,metadata:{}},c);assert.deepEqual(out.atomIds,['c1','h2','h1','o1']);assert.deepEqual(out.pythonConfig.fragments.F1.indices,[3]);assert.deepEqual(out.pythonConfig.fragments.F2.indices,[2]);assert.match(out.xyz,/^4\n/);assert.equal(out.config.schema,'molecule-afir/1');
});
test('overlap, pair reversal, aliased duplicate pairs, stale IDs and invalid cells fail closed',()=>{
  let c=config();c.pairs.push({a:'b',b:'a',mode:'repel',gamma:10});assert.throws(()=>A.validate(atoms,c),/重複/);
  c=config();c.fragments.push({id:'alias',label:'same A',atomIds:['h1']});c.pairs.push({a:'alias',b:'b',mode:'attract',gamma:10});assert.throws(()=>A.validate(atoms,c),/重複/);
  c=config();c.fragments[1].atomIds.push('h1');assert.throws(()=>A.validate(atoms,c),/重ならない/);
  c=config();c.fragments[1].atomIds=['deleted'];assert.throws(()=>A.validate(atoms,c),/原子ID/);
  assert.throws(()=>A.validate(atoms,config(),{pbc:[true,false,false]}),/セル/);
  const duplicate=structuredClone(atoms);duplicate[1].id=duplicate[0].id;assert.throws(()=>A.validate(duplicate,config()),/原子ID/);
  const collision=structuredClone(atoms);collision[1].x=.01;assert.throws(()=>A.evaluate(collision,config()),/衝突/);
  assert.throws(()=>A.validate(atoms.map(a=>({...a,element:'Bk'})),config()),/未定義/);
});

test('periodic fragment bias uses skew minimum images, energy gradients and exported cell',()=>{
  const cell={vectors:[[8,0,0],[2,6,0],[0,0,17]],pbc:[true,true,false]};
  const c=config(),unwrapped=structuredClone(atoms);
  unwrapped[1].x+=cell.vectors[0][0]+cell.vectors[1][0];
  unwrapped[1].y+=cell.vectors[1][1];
  const result=A.evaluate(unwrapped,c,cell),ref=A.evaluate(atoms,c,cell);
  close(result.energyEV,ref.energyEV);
  close(result.pairs[0].distanceA,2);
  close(result.forcesEV_A[1][0],ref.forcesEV_A[1][0]);
  unwrapped[1].x+=1e-5;
  const plus=A.evaluate(unwrapped,c,cell).energyEV;
  unwrapped[1].x-=2e-5;
  const minus=A.evaluate(unwrapped,c,cell).energyEV;
  close(-(plus-minus)/2e-5,result.forcesEV_A[1][0]);
  unwrapped[1].z+=17;
  assert.ok(A.evaluate(unwrapped,c,cell).pairs[0].distanceA>17);
  const exported=A.exportInput({atoms,metadata:{cell}},c);
  assert.deepEqual(exported.cell,cell);
  assert.match(exported.xyz,/pbc="T T F"/);
});

test('active-region proposals use true skew-slab images, the bond graph, and mobile partners',()=>{
  const cell={vectors:[[3,0,0],[2.8,1,0],[0,0,9]],pbc:[true,true,false]};
  const state={metadata:{cell},atoms:[
    {id:'a',element:'Pt',x:0,y:0,z:0},
    {id:'b',element:'O',x:2.842,y:.49,z:0},
    {id:'c',element:'H',x:0,y:0,z:.8},
    {id:'d',element:'Pt',x:0,y:0,z:.9},
    {id:'e',element:'O',x:0,y:0,z:8.5}
  ],bonds:[{atom1:'a',atom2:'b',type:'coordination_candidate'},{atom1:'a',atom2:'c',type:'hydrogen'}]};
  const fixed=[0,3],active=['a'];
  const bonded=A.nearbyPairs(state,active,fixed,1,'repel');
  assert.deepEqual(bonded.map(p=>[p.i,p.j,p.mode]),[[0,1,'repel']]);
  close(bonded[0].distance,Math.hypot(.042,-.51));
  assert.deepEqual(A.nearbyPairs(state,active,fixed,1,'attract'),[{i:0,j:2,mode:'attract',distance:.8}]);
  state.atoms[1].x+=3;
  close(A.nearbyPairs(state,['a','b'],fixed,1,'repel')[0].distance,bonded[0].distance);
  state.bonds=[];
  assert.deepEqual(A.nearbyPairs(state,active,fixed,1,'attract').map(p=>p.j),[1,2]);
  assert.throws(()=>A.nearbyPairs(state,[],fixed,1,'attract'),/原子を選択/);
});
