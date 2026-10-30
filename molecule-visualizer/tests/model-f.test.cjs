const test=require('node:test'),assert=require('node:assert/strict'),F=require('../model-f.js'),T=require('../trajectory.js');
const settings=(surface='lower',alphaKJMol=30)=>({model:'amf',surface,alphaKJMol,multiplicities:[1,3]});
function fixture(surface='lower'){
 const modelF=settings(surface),rows=[[-1,-.9],[-.95,-.95],[-.9,-1]].map(e=>F.components(...e,modelF));
 const r={modelF,images:rows.map((_,i)=>[[i,0,0]]),energies:rows.map(c=>c[surface+'EV']),surfaceComponents:Object.fromEntries(Object.keys(rows[0]).map(k=>[k,rows.map(r=>r[k])]))};
 return {r,data:{modelF,multiplicity:1}};
}
test('AMF eigenvalues and forces differentiate the Gaussian coupling at and away from crossings',()=>{
 for(const surface of ['lower','upper'])for(const alpha of [.0001,30,10000])for(const t of [-5,-.7,-.1,0,.1,.7,5]){
  const s=settings(surface,alpha),a=alpha/F.K,e=[a*t/2,-a*t/2],c=F.components(...e,s),h=a*1e-5;
  const independent=v=>{const u=a/2*Math.exp(-(((v[0]-v[1])/a)**2));return (v[0]+v[1])/2+(surface==='lower'?-1:1)*Math.sqrt((v[0]-v[1])**2+4*u*u)/2;};
  assert.ok(Math.abs(c[surface+'EV']-independent(e))<1e-12);
  for(let i=0;i<2;i++){const plus=[...e],minus=[...e];plus[i]+=h;minus[i]-=h;assert.ok(Math.abs(c['weight'+(i+1)]-(independent(plus)-independent(minus))/(2*h))<2e-8);}
  assert.equal(c.weight1+c.weight2,1);
 }
 const c=F.components(-10,-10,settings());assert.ok(Math.abs(c.couplingEV*F.K-15)<1e-12);assert.ok(Math.abs((c.upperEV-c.lowerEV)*F.K-30)<1e-12);
 assert.equal(F.components(-1000000,-999999,settings('lower',1e-300)).lowerEV,-1000000);
 assert.equal(F.components(-2,-1,settings('upper',0)).upperEV,-1);
});
test('ModelF inputs reject wrong capabilities, state identity, invalid alpha and thermochemistry',()=>{
 const {data}=fixture();F.validateInput(data,{modelF:{version:1}});
 for(const info of [{},{modelF:{version:2}}])assert.throws(()=>F.validateInput(data,info),/bridge/);
 for(const edit of [d=>d.multiplicity=3,d=>d.modelF.multiplicities=[1,1],d=>d.modelF.alphaKJMol=NaN,d=>d.modelF.alphaKJMol=-1,d=>d.modelF.surface='seam',d=>d.thermochemistry={}]){const d=structuredClone(data);edit(d);assert.throws(()=>F.validateInput(d,{modelF:{version:1}}));}
});
test('ModelF acceptance checks both state energies, selected branch, derivatives and every history frame',()=>{
 for(const surface of ['lower','upper']){const {r,data}=fixture(surface);F.validateResult(r,data);
  for(const edit of [r=>r.energies[1]+=.1,r=>r.surfaceComponents.gapEV[1]=.1,r=>r.surfaceComponents.weight1[1]=.3,r=>r.modelF.surface=surface==='lower'?'upper':'lower',r=>r.modelF.alphaKJMol=10,r=>delete r.surfaceComponents.state2EV,r=>r.surfaceComponents.upperEV.pop(),r=>r.surfaceComponents.couplingEV[1]=NaN]){const bad=structuredClone(r);edit(bad);assert.throws(()=>F.validateResult(bad,data));}
  const history=structuredClone(r);history.trajectory=structuredClone(r);history.trajectory.surfaceComponents.state1EV[0]=1;assert.throws(()=>F.validateResult(history,data));assert.throws(()=>F.validateResult(r,{}));
 }
});
test('ModelF AnySolv validation checks state-specific corrections, not their nonlinear sum',()=>{
 const {r,data}=fixture();data.solvation={};for(const n of [1,2]){r.surfaceComponents[`state${n}UmaEV`]=r.surfaceComponents[`state${n}EV`].map(e=>e+.2);r.surfaceComponents[`state${n}SolvationEV`]=r.energies.map(()=>-.2);}F.validateResult(r,data);r.surfaceComponents.state2SolvationEV[1]=0;assert.throws(()=>F.validateResult(r,data));
});
test('CSV and project metadata retain raw surfaces and XYZ comments identify the selected model',()=>{
 const {r,data}=fixture(),state={metadata:{externalCalculation:{}}};F.attach(state,data,r,1);assert.deepEqual(state.metadata.modelF,data.modelF);assert.deepEqual(state.metadata.externalCalculation.surfaceComponents,F.row(r,1));
 const csv=F.csv(r,data).trim().split('\n');assert.equal(csv.length,4);assert.ok(csv[0].includes('couplingEV'));assert.equal(csv[1].split(',')[5],String(r.energies[0]));
 const source={...r,symbols:['He'],kind:'path'};const xyz=T.xyz(source,[0,2]);assert.match(xyz,/modelF=amf surface=lower alpha_kJ_mol=30 multiplicities="1 3"/);assert.match(xyz,/state1EV=/);
 F.attach(state,{});assert.equal(state.metadata.modelF,undefined);assert.equal(state.metadata.externalCalculation.surfaceComponents,undefined);
});
