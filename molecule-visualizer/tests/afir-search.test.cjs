// Analytic numerical tests only. This potential is NOT a molecular engine.
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../afir.js'),S=require('../afir-search.js');
const atoms=[{id:'left',element:'H',x:-1,y:0,z:0},{id:'right',element:'H',x:1,y:0,z:0}];
const settings=()=>({...A.defaults(),fragments:[{id:'a',label:'A',atomIds:['left']},{id:'b',label:'B',atomIds:['right']}],pairs:[{a:'a',b:'b',mode:'attract',gamma:40}],fmax:.0001,maxSteps:350});
function harmonic(){return {name:'ANALYTIC TEST ONLY',method:'radial harmonic k=2,r0=2',conditionId:'analytic-test-1',units:{energy:'eV',force:'eV/angstrom',length:'angstrom'},async evaluate(req){const [a,b]=req.positions,d=b.map((v,k)=>v-a[k]),r=Math.hypot(...d),f=d.map(v=>2*(r-2)*v/r);return {energyEV:(r-2)**2,forcesEV_A:[f,f.map(v=>-v)],atomIds:req.atomIds,conditionId:'analytic-test-1',converged:true};}};}
test('AFIR optimizer reaches independent analytic minimum of E+alpha*r; physical energies stay separate',async()=>{
 const c=settings(),before=JSON.stringify(atoms),r=await S.optimize({atoms,config:c,potential:harmonic()});
 assert.equal(r.converged,true);assert.equal(JSON.stringify(atoms),before);assert.deepEqual(r.atomIds,['left','right']);
 const final=r.images.at(-1),distance=final[1][0]-final[0][0];assert.ok(Math.abs(distance-(2-A.alphaFromGamma(40)/2))<1e-4);
 assert.equal(r.images.length,r.steps+1);assert.equal(r.energies[0],0);assert.ok(r.energies.at(-1)>0);assert.ok(r.biasedEnergies.at(-1)<r.biasedEnergies[0]);
 assert.equal(r.validation,'biased-trajectory-not-ts');r.energies.forEach((e,i)=>assert.ok(Math.abs(e+r.biasEnergies[i]-r.biasedEnergies[i])<1e-12));
});
test('aborted and step-limited jobs retain evaluated frames without claiming convergence',async()=>{
 const controller=new AbortController(),limited=await S.optimize({atoms,config:{...settings(),maxSteps:1},potential:harmonic()});assert.equal(limited.reason,'step_limit');assert.equal(limited.images.length,2);
 const cancelled=await S.optimize({atoms,config:settings(),potential:harmonic(),signal:controller.signal,onProgress:p=>{if(p.step===3)controller.abort();}});assert.equal(cancelled.reason,'cancelled');assert.equal(cancelled.converged,false);assert.equal(cancelled.images.length,4);
});
test('energy provider must preserve IDs, conditions, units, SCF convergence and finite forces',async()=>{
 for(const modify of [v=>({...v,atomIds:['right','left']}),v=>({...v,conditionId:'changed'}),v=>({...v,converged:false}),v=>({...v,forcesEV_A:[[NaN,0,0],[0,0,0]]})]){
  const p=harmonic(),evaluate=p.evaluate;p.evaluate=async req=>modify(await evaluate(req));await assert.rejects(()=>S.optimize({atoms,config:settings(),potential:p}));
 }
 const p=harmonic();p.units.force='hartree/bohr';await assert.rejects(()=>S.optimize({atoms,config:settings(),potential:p}),/単位/);
 await assert.rejects(()=>S.optimize({atoms,config:settings(),potential:null}),/物理ポテンシャル/);
});
