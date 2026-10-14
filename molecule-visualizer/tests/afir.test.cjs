const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../afir.js');
const atoms=[{id:'h1',element:'H',x:0,y:0,z:0},{id:'h2',element:'H',x:2,y:0,z:0},{id:'o1',element:'O',x:.5,y:2,z:.3},{id:'c1',element:'C',x:2.8,y:1,z:-.2}];
function config(){return {...A.defaults(),fragments:[{id:'a',label:'A',atomIds:['h1']},{id:'b',label:'B',atomIds:['h2']}],pairs:[{a:'a',b:'b',mode:'attract',gamma:100}]};}
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
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
test('overlap, pair reversal, aliased duplicate pairs, stale IDs and periodic structures fail closed',()=>{
  let c=config();c.pairs.push({a:'b',b:'a',mode:'repel',gamma:10});assert.throws(()=>A.validate(atoms,c),/重複/);
  c=config();c.fragments.push({id:'alias',label:'same A',atomIds:['h1']});c.pairs.push({a:'alias',b:'b',mode:'attract',gamma:10});assert.throws(()=>A.validate(atoms,c),/重複/);
  c=config();c.fragments[1].atomIds.push('h1');assert.throws(()=>A.validate(atoms,c),/重ならない/);
  c=config();c.fragments[1].atomIds=['deleted'];assert.throws(()=>A.validate(atoms,c),/原子ID/);
  assert.throws(()=>A.validate(atoms,config(),{pbc:[true,false,false]}),/非周期/);
  const duplicate=structuredClone(atoms);duplicate[1].id=duplicate[0].id;assert.throws(()=>A.validate(duplicate,config()),/原子ID/);
  const collision=structuredClone(atoms);collision[1].x=.01;assert.throws(()=>A.evaluate(collision,config()),/衝突/);
  assert.throws(()=>A.validate(atoms.map(a=>({...a,element:'Bk'})),config()),/未定義/);
});
