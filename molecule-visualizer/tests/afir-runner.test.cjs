const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const A=require('../afir.js');
function boot(){const MV={AFIR:A},ctx={window:{MoleculeVisualizer:MV},document:{getElementById(){return {};}},URL,AbortController,setTimeout,clearTimeout};vm.createContext(ctx);for(const f of ['trajectory.js','engine-ui.js','afir-runner.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);return MV;}
function sample(){
 const atoms=[{id:'left',element:'H',x:0,y:0,z:0},{id:'right',element:'H',x:2,y:0,z:0}];
 const config={...A.defaults(),fragments:[{id:'a',label:'A',atomIds:['left']},{id:'b',label:'B',atomIds:['right']}],pairs:[{a:'a',b:'b',mode:'attract',gamma:100}]},bias=A.evaluate(atoms,config).energyEV;
 const j={original:{atoms,bonds:[],metadata:{}},config};
 const r={schema:'molecule-afir-trajectory/1',validation:'biased-trajectory-not-ts',atomIds:['left','right'],symbols:['H','H'],cell:null,charge:0,multiplicity:1,units:{energy:'eV',length:'angstrom',force:'eV/angstrom'},conditionId:'unit-test-only',reason:'step_limit',converged:false,images:[[[0,0,0],[2,0,0]]],steps:0,evaluations:1,energies:[0],biasEnergies:[bias],biasedEnergies:[bias],forces:[[[0,0,0],[0,0,0]]],imageFmax:[A.alphaFromGamma(100)],physicalFmax:[0],effectiveFmax:A.alphaFromGamma(100)};
 return {j,r};
}
test('AFIR transport permits loopback only; no background connection on load',()=>{
 const MV=boot();assert.equal(MV.AFIRRunner.available(),false);
 assert.equal(MV.EngineUI.endpoint('http://127.0.0.1:8766'),'http://127.0.0.1:8766');
 for(const url of ['https://example.com','https://localhost.example.com','http://127.0.0.1@evil.example','http://localhost:8766/api','http://localhost/?token=x','file:///tmp/x'])assert.throws(()=>MV.EngineUI.endpoint(url));
});
test('result acceptance independently checks all IDs, biases, budgets and convergence',()=>{
 const MV=boot(),{j,r}=sample();MV.AFIRRunner.validateResult(r,j);
 for(const modify of [v=>v.atomIds.reverse(),v=>v.biasEnergies[0]++,v=>v.converged=true,v=>v.charge=1,v=>v.steps=2,v=>v.images[0][1][0]=3,v=>v.forces[0][0][0]=NaN,v=>v.units.force='hartree/bohr']){const bad=structuredClone(r);modify(bad);assert.throws(()=>MV.AFIRRunner.validateResult(bad,j));}
});
test('10000-step jobs retain the budget in transport and old bridges get an update instruction',async()=>{
 const MV=boot(),{j}=sample(),calls=[],link={url:'http://127.0.0.1:8766',info:{modes:['afir']}};
 MV.EngineUI.getConnection=()=>link;
 MV.EngineUI.request=async(c,path,body)=>{calls.push({path,body});return body?{id:'a'.repeat(32)}:{status:'cancelled'};};
 await assert.rejects(()=>MV.AFIRRunner.run(j,()=>{}),/bridge.py 1\.1\.1/);assert.equal(calls.length,0);
 link.info.maxAFIRSteps=10000;await MV.AFIRRunner.run(j,()=>{});
 assert.equal(calls[0].body.maxSteps,10000);assert.equal(calls[0].body.afir.maxSteps,10000);
});
test('optimization history acceptance rejects mismatched endpoints, step counts, energies and incomplete new-bridge results',()=>{
 const MV=boot(),j={frames:[{}],data:{mode:'optimize',maxSteps:2,symbols:['He'],cell:null,images:[[[0,0,0]]]},connection:{info:{optimizationTrajectory:1}}};
 const r={mode:'optimize',steps:2,symbols:['He'],cell:null,units:{energy:'eV',length:'angstrom'},images:[[[.2,0,0]]],energies:[2],effectiveFmax:1,imageFmax:[1],trajectory:{images:[[[0,0,0]],[[.1,0,0]],[[.2,0,0]]],energies:[0,1,2]}};
 MV.EngineUI.validateResult(r,j);
 for(const edit of [v=>delete v.trajectory,v=>v.steps=3,v=>v.trajectory.images[0][0][0]=1,v=>v.trajectory.images[2][0][0]=3,v=>v.trajectory.energies[2]=4,v=>delete v.trajectory.energies,v=>v.trajectory.images[1][0][0]=NaN]){
   const bad=structuredClone(r);edit(bad);assert.throws(()=>MV.EngineUI.validateResult(bad,j));
 }
 const legacy=structuredClone(r);delete legacy.trajectory;MV.EngineUI.validateResult(legacy,{...j,connection:{info:{}}});
});
