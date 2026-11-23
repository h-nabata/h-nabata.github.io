// Exercise the real path form/request boundary without a browser or compute engine.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const currentBridgeVersion=fs.readFileSync(path.join(__dirname,'../local-engine/bridge.py'),'utf8').match(/^VERSION = '([^']+)'/m)[1];
async function boot(version=currentBridgeVersion){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),nodes=new Map();
 class Element{
  constructor(id=''){this.id=id;this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.children=[];this.events={};this.textContent='';this.firstChild={textContent:id};}
  set value(v){this._value=String(v);}get value(){return this._value;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}closest(){return this;}replaceChildren(...children){this.children=children;}append(...children){this.children.push(...children);}setAttribute(){}showModal(){this.open=true;}close(){this.open=false;}click(){return Promise.all((this.events.click||[]).map(fn=>fn()));}
 }
 for(const m of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const node=new Element(m[3]);node.value=m[2].match(/value="([^"]*)"/)?.[1]||'';node.checked=/\bchecked\b/.test(m[2]);nodes.set(node.id,node);}
 for(const m of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g))nodes.get(m[1]).value=m[2].match(/<option\b[^>]*value="([^"]*)"/)?.[1]||'';
 const document={getElementById:id=>nodes.get(id),createElement:()=>new Element()},window={document};
 const info={version,engine:'tblite',method:'GFN2-xTB',engineVersion:'fixture',modes:['evaluate','optimize','cineb','lup'],lup:true,pathOptimizers:{cineb:['fire'],lup:['fire','lbfgs']},maxImages:100,maxSteps:10000,vibrations:true,adaptiveNEB:true,pathSplit:true};
 if(version===currentBridgeVersion){info.pathEndpointModes=['fixed','relax'];info.pathSymmetryTypes=['mirror'];}
 const ctx=vm.createContext({window,document,location:{hostname:'example.test'},URL,AbortController,setTimeout,clearTimeout,console,fetch:async()=>({ok:true,json:async()=>info})});
 for(const f of ['model','optimization','bonding','geometry','io','molfile','periodic','constraints','structure-analysis','trajectory','research-ui','engine-ui','path-refinement'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../'+f+'.js'),'utf8'),ctx,{filename:f+'.js'});
 const M=window.MoleculeVisualizer;let state=M.Model.createState({atoms:[{id:'o',element:'O',x:0,y:0,z:0},{id:'h1',element:'H',x:.96,y:0,z:0},{id:'h2',element:'H',x:-.24,y:.93,z:0}]});
 state.metadata.pathNodeId='n0';state.metadata.trajectory=[0,.1,.2].map((shift,i)=>{const f=M.Periodic.snapshot(state);f.atoms[1].x+=shift;f.metadata.pathNodeId='n'+i;return f;});state.metadata.frameIndex=0;
 M.App={getState:()=>state,getDisplayedState:()=>state,useDisplayedStructure(){},freezeDisplayedStructure(){},change(_label,fn){state=fn(state)||state;}};M.EnergyProfile={reset(){}};M.Studio={stop(){}};M.App.setStatus=()=>{};
 // Row editors are unrelated here; their existing browser contracts cover init.
 M.ResearchUI.init=()=>{};M.EngineUI.init();nodes.get('engineURL').value='http://127.0.0.1:8766';nodes.get('engineToken').value='fixture-only';await nodes.get('engineConnect').click();assert.ok(M.EngineUI.getConnection());
 return {M,nodes,info,select(mode){nodes.get('engineMode').value=mode;M.EngineUI.settings();}};
}
test('browser connects to the currently distributed bridge version',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../local-engine/bridge.py'),'utf8');
 const version=source.match(/^VERSION = '([^']+)'/m)?.[1];assert.ok(version);
 assert.ok(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').includes(`bridge.py?v=${version}`),'download link must invalidate the old bridge cache');
 const {M}=await boot(version);assert.equal(M.EngineUI.getConnection().info.version,version);
});
test('LUP path form keeps CI-NEB defaults and sends current unsaved method settings without a spring',async()=>{
 const {M,nodes,select}=await boot();M.EngineUI.prepareNEB();assert.equal(nodes.get('engineMode').value,'cineb');assert.equal(nodes.get('engineSteps').value,'100');
 select('lup');assert.equal(nodes.get('enginePathOptimizer').value,'auto');assert.equal(nodes.get('engineScope').value,'all');assert.equal(nodes.get('engineScope').disabled,true);assert.equal(nodes.get('engineSpringLabel').hidden,true);assert.equal(nodes.get('engineClimbLabel').hidden,false);assert.equal(nodes.get('engineLUPSettings').hidden,false);assert.equal(nodes.get('engineAdaptiveSettings').hidden,false);
 for(const [id,value] of Object.entries({engineSteps:'72',engineFmax:'.025',engineMove:'.02',engineClimb:'7',enginePathOptimizer:'lbfgs',lupRedistributeEvery:'3',lupRedistributionTolerance:'.0007',engineSpring:'invalid-but-hidden'}))nodes.get(id).value=value;
 nodes.get('adaptiveEnabled').checked=true;nodes.get('adaptiveMaxImages').value='7';nodes.get('pathSplitEnabled').checked=true;
 const {data}=M.EngineUI.input();assert.equal(data.mode,'lup');assert.equal(data.images.length,3);assert.equal(data.maxSteps,72);assert.equal(data.fmax,.025);assert.equal(data.maxMove,.02);assert.equal(data.climbAfter,7);assert.equal(data.optimizer,'lbfgs');assert.equal(data.spring,undefined);assert.equal(JSON.stringify(data.lup),JSON.stringify({redistributeEvery:3,redistributionTolerance:.0007}));assert.equal(data.adaptiveNEB.maxImages,7);assert.equal(data.pathSplit.enabled,true);assert.equal(JSON.stringify(data.nodeIds),'["n0","n1","n2"]');
 select('cineb');assert.equal(nodes.get('engineSteps').value,'100');assert.equal(nodes.get('engineSpringLabel').hidden,false);assert.equal(nodes.get('engineLUPSettings').hidden,true);M.EngineUI.prepareNEB();assert.equal(nodes.get('engineMode').value,'cineb');
});
test('LUP refuses invalid redistribution, missing capability, too few images and mismatched endpoints',async()=>{
 const {M,nodes,info,select}=await boot('1.9.0');select('lup');nodes.get('engineEndpointMode').value='fixed';nodes.get('lupRedistributeEvery').value='0';assert.throws(()=>M.EngineUI.input(),/1〜100/);nodes.get('lupRedistributeEvery').value='5';nodes.get('lupRedistributionTolerance').value='0';assert.throws(()=>M.EngineUI.input(),/0.00001/);nodes.get('lupRedistributionTolerance').value='.001';
 const j=M.EngineUI.input(),r={mode:'lup',symbols:j.data.symbols,cell:j.data.cell,images:structuredClone(j.data.images),energies:[0,.2,0],effectiveFmax:.01,imageFmax:[0,.01,0],units:{energy:'eV',length:'angstrom'}};M.EngineUI.validateResult(r,j);r.images[0][0][0]+=.1;assert.throws(()=>M.EngineUI.validateResult(r,j),/端点/);
 info.modes=info.modes.filter(x=>x!=='lup');assert.throws(()=>M.EngineUI.input(),/LUP系/);info.modes.push('lup');info.pathOptimizers.lup=['fire'];nodes.get('enginePathOptimizer').value='lbfgs';assert.throws(()=>M.EngineUI.input(),/アルゴリズム/);nodes.get('enginePathOptimizer').value='fire';M.App.getState().metadata.trajectory.length=2;assert.throws(()=>M.EngineUI.input(),/3〜100/);
});
test('LUP history restores its optimizer, redistribution and path scope across reopen',async()=>{
 const {M,nodes,select}=await boot();select('lup');nodes.get('engineSteps').value='61';nodes.get('enginePathOptimizer').value='lbfgs';nodes.get('lupRedistributeEvery').value='9';nodes.get('lupRedistributionTolerance').value='.0008';const {data}=M.EngineUI.input();select('optimize');M.EngineUI.restoreJob({id:'a'.repeat(32),data},true);M.EngineUI.open();assert.equal(nodes.get('engineMode').value,'lup');assert.equal(nodes.get('engineScope').value,'all');assert.equal(Number(nodes.get('engineSteps').value),61);assert.equal(nodes.get('enginePathOptimizer').value,'lbfgs');assert.equal(Number(nodes.get('lupRedistributeEvery').value),9);assert.equal(Number(nodes.get('lupRedistributionTolerance').value),.0008);assert.equal(M.EngineUI.input().data.lup.redistributionTolerance,.0008);
});

test('manual node insertion keeps LUP mode and existing node identities',async()=>{
 const {M,nodes}=await boot(),frames=M.EngineUI.frames(M.App.getState(),'all');
 const refined=M.PathRefinement.refine(frames,0,2,1);assert.equal(refined.length,5);assert.equal(JSON.stringify([refined[0],refined[2],refined[4]].map(f=>f.metadata.pathNodeId)),'["n0","n1","n2"]');assert.equal(new Set(refined.map(f=>f.metadata.pathNodeId)).size,5);
 M.PathRefinement.init();M.PathRefinement.open(frames,'lup');assert.match(nodes.get('refineNEB').textContent,/LUP系/);await nodes.get('refineNEB').click();assert.equal(nodes.get('engineMode').value,'lup');assert.equal(M.App.getState().metadata.trajectory.length,5);assert.equal(new Set(M.EngineUI.input().data.nodeIds).size,5);
 M.PathRefinement.open();assert.match(nodes.get('refineNEB').textContent,/CI-NEB/);
});

test('DS-AFIR submits the two selected endpoints and current fields, preserves their order across reopen and restore',async()=>{
 const {M,nodes,info}=await boot('1.17.0');
 info.modes.push('dsafir');
 M.EngineUI.prepareMethod('dsafir');
 assert.equal(nodes.get('dsafirStart').value,'0');
 assert.equal(nodes.get('dsafirEnd').value,'2');
 for(const [id,value] of Object.entries({dsafirStart:2,dsafirEnd:1,engineSteps:82,dsafirDelta:.85,dsafirStep:.035,dsafirThreshold:.11}))nodes.get(id).value=value;
 M.EngineUI.open();
 const {data}=M.EngineUI.input(),frames=M.App.getState().metadata.trajectory;
 assert.equal(data.mode,'dsafir');assert.equal(data.maxSteps,82);
 assert.equal(JSON.stringify(data.dsafir),JSON.stringify({delta:.85,stepSize:.035,threshold:.11}));
 assert.deepEqual(Array.from(data.images,image=>image[1][0]),[frames[2].atoms[1].x,frames[1].atoms[1].x]);
 assert.equal(data.spring,undefined);assert.equal(data.maxMove,undefined);
 M.EngineUI.restoreJob({id:'c'.repeat(32),data},true);
 M.EngineUI.open();assert.equal(nodes.get('dsafirStart').value,'0');assert.equal(nodes.get('dsafirEnd').value,'1');
 assert.equal(JSON.stringify(M.EngineUI.input().data),JSON.stringify(data));
 nodes.get('dsafirEnd').value='0';assert.throws(()=>M.EngineUI.input(),/異なる構造/);
 nodes.get('dsafirEnd').value='1';nodes.get('dsafirDelta').value='';assert.throws(()=>M.EngineUI.input(),/0.0001/);
 nodes.get('dsafirDelta').value=1;info.modes=info.modes.filter(m=>m!=='dsafir');assert.throws(()=>M.EngineUI.input(),/bridge/);
});

test('DS-AFIR profiles separate unfinished branches, validate the measured gap and retain the atom identity of A',async()=>{
 const {M,info}=await boot('1.17.0');info.modes.push('dsafir');
 M.EngineUI.prepareMethod('dsafir');
 const j=M.EngineUI.input(),d=j.data,images=JSON.parse(JSON.stringify(d.images));
 const gap=Math.sqrt(images[0].reduce((sum,a,i)=>sum+a.reduce((v,x,k)=>v+(x-images[1][i][k])**2,0),0));
 const dsafir={...d.dsafir,joinIndex:0,connected:false,gap};
 const r={mode:'dsafir',converged:false,reason:'step_limit',symbols:d.symbols,atomIds:d.atomIds,cell:d.cell,images,energies:[0,1],imageFmax:[.01,.02],steps:0,dsafir,units:{energy:'eV',length:'angstrom'}};
 let view;M.EnergyProfile.set=next=>{view=next;};
 M.EngineUI.validateResult(r,j);M.EngineUI.showProfile(r,j);
 assert.equal(view.breakAfter,0);assert.equal(view.exportXYZ,null);assert.match(view.legend,/未接続/);
 assert.throws(()=>M.EngineUI.resultSource(r,j),/未接続/);
 assert.throws(()=>M.EngineUI.validateResult({...r,dsafir:{...dsafir,gap:gap+.01}},j),/距離/);
 d.dsafir.threshold=gap+.01;r.dsafir={...dsafir,threshold:d.dsafir.threshold,connected:true};r.reason='connected';r.converged=true;
 M.EngineUI.validateResult(r,j);M.EngineUI.showProfile(r,j);assert.equal(view.breakAfter,undefined);assert.equal(typeof view.exportXYZ,'function');
 const source=M.EngineUI.resultSource(r,j);
 assert.equal(source.base(1),j.frames[0]);assert.deepEqual(source.atomIds,d.atomIds);
});

test('choosing DS-AFIR before importing the endpoints keeps the selected method',async()=>{
 const {M,nodes}=await boot('1.17.0'),original=M.App.getState(),frames=original.metadata.trajectory;
 M.App.change('single structure',()=>M.Model.createState(frames[0]));
 M.EngineUI.prepareMethod('dsafir');assert.equal(nodes.get('dsafirEnd').disabled,true);
 M.App.change('open both endpoints',()=>original);M.EngineUI.open();
 assert.equal(nodes.get('engineMode').value,'dsafir');assert.equal(nodes.get('dsafirEnd').disabled,false);
 assert.equal(nodes.get('dsafirEnd').value,'2');
});

test('plot sampling keeps the last point of A and the first of B in different segments',()=>{
 const window={MoleculeVisualizer:{}},ctx=vm.createContext({window});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../energy-profile.js'),'utf8'),ctx);
 const values=Array.from({length:2500},(_,i)=>Math.sin(i*.01));
 const [left,right]=window.MoleculeVisualizer.EnergyProfile.sampleSegments(values,923);
 assert.equal(left[0],0);assert.equal(left.at(-1),923);assert.equal(right[0],924);assert.equal(right.at(-1),2499);
 assert.ok(left.length+right.length<1000);
});

async function connectedDSPath(){
 const setup=await boot(),{M,nodes,info}=setup;
 info.modes.push('dsafir','neb');
 M.EnergyProfile.set=()=>{};
 M.ResearchUI.showResult=()=>{};
 M.EngineUI.prepareMethod('dsafir');
 nodes.get('engineCharge').value='1';
 nodes.get('engineMultiplicity').value='2';
 const j=M.EngineUI.input(),d=j.data;
 const images=Array.from({length:12},(_,i)=>d.images[0].map((xyz,a)=>xyz.map((v,k)=>v+(d.images[1][a][k]-v)*i/11)));
 const energies=[0,.1,.3,1.4,.3,0,.14,.3,.8,.35,.2,0],gap=images[6][1][0]-images[5][1][0];
 const r={mode:'dsafir',engine:info.engine,method:info.method,converged:true,reason:'connected',
   dsafir:{...d.dsafir,gap,joinIndex:5,connected:true},symbols:d.symbols,atomIds:d.atomIds,
   images,cell:null,steps:10,evaluations:12,energies,imageFmax:images.map(()=>.01),
   units:{length:'angstrom',energy:'eV'}};
 M.EngineUI.showResult(r,j);
 return {...setup,r,j};
}

test('connected DS-AFIR result stages the selected path solver, original electronic conditions and only evaluated nodes',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const modeOptions=html.match(/<select\b[^>]*id="engineMode"[^>]*>([\s\S]*?)<\/select>/)[1];
 for(const mode of ['cineb','neb','lup']){
  assert.ok(modeOptions.includes('value="'+mode+'"'),'solver must exist in the real HTML select');
  const {M,nodes,r}=await connectedDSPath();
  assert.equal(nodes.get('dsafirRelaxation').hidden,false);
  assert.equal(nodes.get('dsafirRelaxCount').value,'12');
  nodes.get('dsafirRelaxMode').value=mode;
  assert.equal(nodes.get('dsafirRelaxEndpoints').value,'relax');
  if(mode==='lup')nodes.get('dsafirRelaxEndpoints').value='fixed';
  nodes.get('dsafirRelaxCount').value='5';
  nodes.get('engineCharge').value='0';nodes.get('engineMultiplicity').value='1';
  await nodes.get('dsafirRelaxPrepare').click();
  assert.equal(nodes.get('engineMode').value,mode,nodes.get('dsafirRelaxHelp').textContent);
  assert.equal(nodes.get('engineScope').value,'all');
  const job=M.EngineUI.input(),d=job.data,indices=job.frames.map(f=>f.metadata.externalCalculation.pathFrame);
  assert.equal(d.charge,1);assert.equal(d.multiplicity,2);
  assert.deepEqual(Array.from(d.atomIds),['o','h1','h2']);
  assert.equal(d.images.length,5);assert.equal(indices[0],0);assert.equal(indices.at(-1),11);
  assert.ok(indices.includes(3));
  assert.equal(JSON.stringify(d.images),JSON.stringify(indices.map(i=>r.images[i])));
  assert.equal(d.endpointMode,{cineb:'relax',lup:'fixed',neb:undefined}[mode]);
  assert.equal(d.dsafir,undefined);assert.equal(d.afir,undefined);
 }
});

test('DS-AFIR handoff rejects stale coordinates, incompatible surfaces and a completed path without internal nodes',async()=>{
 const {M,nodes,info,j,r}=await connectedDSPath(),before=M.App.getState();
 nodes.get('xyzEditStatus').textContent='編集中';
 await nodes.get('dsafirRelaxPrepare').click();
 assert.match(nodes.get('dsafirRelaxHelp').textContent,/入力が変更/);assert.equal(M.App.getState(),before);
 nodes.get('xyzEditStatus').textContent='';
 info.method='GFN1-xTB';await nodes.get('dsafirRelaxPrepare').click();
 assert.match(nodes.get('dsafirRelaxHelp').textContent,/同じ計算エンジン/);assert.equal(M.App.getState(),before);
 info.method=r.method;
 const gap=before.metadata.trajectory[2].atoms[1].x-before.metadata.trajectory[0].atoms[1].x;
 j.data.dsafir.threshold=gap+.001;
 M.EngineUI.showResult({...r,images:j.data.images,energies:[0,.04],imageFmax:[.01,.01],steps:0,
   evaluations:2,dsafir:{...j.data.dsafir,joinIndex:0,gap,connected:true}},j);
 assert.ok(nodes.get('dsafirRelaxPrepare').disabled);assert.match(nodes.get('dsafirRelaxHelp').textContent,/中間構造/);
 M.EngineUI.showResult({...r,images:j.data.images,energies:[0,.04],imageFmax:[.01,.01],steps:0,
   converged:false,reason:'step_limit',dsafir:{...j.data.dsafir,threshold:.12,joinIndex:0,gap,connected:false}},
   {...j,data:{...j.data,dsafir:{...j.data.dsafir,threshold:.12}}});
 assert.ok(nodes.get('dsafirRelaxPrepare').disabled);assert.match(nodes.get('dsafirRelaxHelp').textContent,/未接続/);
});

test('DS-AFIR to LUP restores the source solvent and device even if a different draft was selected',async()=>{
 const {M,nodes,r,j,info}=await connectedDSPath();
 info.engine='uma';info.uma={model:'fixture-uma',precision:'float64'};
 info.devices=[{id:'cpu'},{id:'cuda:0'}];info.anysolv={enabled:true,models:['model_compact'],solvents:['water','acetone']};
 const solvation={model:'model_compact',solvent:'acetone',device:'cpu'};
 Object.assign(j.data,{umaDevice:'cuda:0',solvation});
 Object.assign(r,{engine:'uma',method:'fixture-uma with solvent',provenance:{
   uma:{model:'fixture-uma',device:'cuda:0',inference:{base_precision_dtype:'float64'}},
   anysolv:{...solvation}},energyComponents:{uma:r.energies.slice(),solvation:r.energies.map(()=>0)}});
 M.EngineUI.showResult(r,j);
 nodes.get('engineAnySolv').checked=false;nodes.get('engineSolvent').value='water';nodes.get('engineUMADevice').value='cpu';
 nodes.get('dsafirRelaxMode').value='lup';await nodes.get('dsafirRelaxPrepare').click();
 const data=M.EngineUI.input().data;
 assert.equal(data.mode,'lup');assert.equal(data.umaDevice,'cuda:0');
 assert.equal(JSON.stringify(data.solvation),JSON.stringify(solvation));
});

test('explicitly switching PES re-evaluates the same geometries, charge and spin with current solvent settings',async()=>{
 const {M,nodes,r,info}=await connectedDSPath(),before=M.App.getState();
 info.engine='uma';info.uma={model:'fixture-uma',precision:'float64',device:'cpu'};
 info.anysolv={enabled:true,models:['model_compact'],solvents:['water']};info.devices=[{id:'cpu'}];
 nodes.get('engineUMADevice').value='cpu';nodes.get('engineAnySolv').checked=true;
 nodes.get('engineAnySolvModel').value='model_compact';nodes.get('engineAnySolvDevice').value='cpu';nodes.get('engineSolvent').value='water';
 await nodes.get('dsafirRelaxPrepare').click();
 assert.match(nodes.get('dsafirRelaxHelp').textContent,/同じ計算エンジン/);assert.equal(M.App.getState(),before);
 nodes.get('dsafirRelaxPotential').value='current';await nodes.get('dsafirRelaxPrepare').click();
 const {data,frames}=M.EngineUI.input();
 assert.equal(data.mode,'cineb');assert.equal(data.charge,1);assert.equal(data.multiplicity,2);
 assert.deepEqual(Array.from(data.atomIds),['o','h1','h2']);assert.equal(JSON.stringify(data.images),JSON.stringify(r.images));
 assert.equal(data.solvation.solvent,'water');assert.equal(data.solvation.model,'model_compact');assert.equal(data.umaDevice,'cpu');
 for(const [k,frame] of frames.entries()){
   assert.equal(frame.metadata.externalCalculation,undefined);assert.equal(frame.metadata.trajectoryExtraction.sourceMethod,r.method);
   assert.equal(frame.metadata.trajectoryExtraction.sourceFrame,k);
 }
});

test('same UMA and solvent support a recovered result when its previous GPU is unavailable',async()=>{
 const {M,nodes,r,j,info}=await connectedDSPath();
 info.engine='uma';info.uma={model:'fixture-uma',precision:'float64',device:'cpu'};
 info.devices=[{id:'cpu'}];info.anysolv={enabled:true,models:['model_compact'],solvents:['acetone'],device:'cpu'};
 const solvation={model:'model_compact',solvent:'acetone',device:'cuda:1'};
 Object.assign(j.data,{umaDevice:'cuda:1',solvation});
 Object.assign(r,{engine:'uma',method:'fixture-uma + acetone',provenance:{
   uma:{model:'fixture-uma',device:'cuda:1',inference:{base_precision_dtype:'float64'}},
   anysolv:{...solvation,checkpointSHA256:'a'.repeat(64)}},
   energyComponents:{uma:r.energies.slice(),solvation:r.energies.map(()=>0)}});
 M.EngineUI.restoreJob({id:'a'.repeat(32),data:j.data,result:r});
 info.anysolv.checkpointSHA256={model_compact:'b'.repeat(64)};
 await nodes.get('dsafirRelaxPrepare').click();assert.match(nodes.get('dsafirRelaxHelp').textContent,/同じ計算エンジン/);
 info.anysolv.checkpointSHA256.model_compact=r.provenance.anysolv.checkpointSHA256;
 await nodes.get('dsafirRelaxPrepare').click();
 assert.match(nodes.get('engineMessage').textContent,/cuda:1 → cpu/);
 const data=M.EngineUI.input().data;
 assert.equal(data.umaDevice,'cpu');assert.equal(data.solvation.device,'cpu');assert.equal(data.solvation.solvent,'acetone');
});

test('clamps an implicit llmlip thread count from result provenance to the new service budget',async()=>{
 const {M,nodes,r,j,info}=await connectedDSPath();
 const sha='e'.repeat(64),selection={model:'fixture',head:'omol',dtype:'float64'};
 info.engine='llmlip';info.llmlip={models:[{id:'fixture',sha256:sha,available:true,architecture:'uma-v1',heads:['omol'],dtypes:['float64'],species:['H','O']}],threads:6,workers:2};
 j.data.llmlip=selection;r.engine='llmlip';r.provenance={llmlip:{...selection,modelSHA256:sha,threads:8,device:'cpu',backend:'direct'}};
 let staged;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../llmlip-ui.js'),'utf8'),{window:{MoleculeVisualizer:M}});
 Object.assign(M.LLMLIPUI,{summary:()=>'',restore(data){staged=data.llmlip;}});
 M.EngineUI.showResult(r,j);
 await nodes.get('dsafirRelaxPrepare').click();
 assert.equal(staged.threads,6);assert.equal(staged.model,'fixture');assert.match(nodes.get('engineMessage').textContent,/8 → 6スレッド/);
});

test('new climbing jobs request relaxed endpoints and fixed jobs reproduce the saved policy',async()=>{
 const {M,nodes,select}=await boot();
 for(const mode of ['cineb','lup']){
  select(mode);
  assert.equal(M.EngineUI.input().data.endpointMode,'relax');
  nodes.get('engineEndpointMode').value='fixed';
  const {data}=M.EngineUI.input();
  assert.equal(data.endpointMode,'fixed');
  nodes.get('engineEndpointMode').value='relax';
  M.EngineUI.restoreJob({id:'f'.repeat(32),data},true);
  assert.equal(M.EngineUI.input().data.endpointMode,'fixed');
  // Unversioned historic inputs had fixed endpoints even on today's bridge.
  delete data.endpointMode;
  nodes.get('engineEndpointMode').value='relax';
  M.EngineUI.restoreJob({id:'f'.repeat(32),data},true);
  assert.equal(M.EngineUI.input().data.endpointMode,'fixed');
 }
 select('evaluate');
 assert.equal(M.EngineUI.input().data.endpointMode,undefined);
});

test('an older bridge can only perform fixed-endpoint jobs',async()=>{
 const {M,nodes,select}=await boot('1.17.0');
 for(const mode of ['cineb','lup']){
  select(mode);
  nodes.get('engineEndpointMode').value='relax';
  assert.throws(()=>M.EngineUI.input(), /bridge/);
  nodes.get('engineEndpointMode').value='fixed';
  assert.equal(M.EngineUI.input().data.endpointMode,undefined);
 }
});

test('DS-AFIR rejects unsupported endpoint relaxation before changing the workspace',async()=>{
 const {M,nodes,info}=await connectedDSPath(),before=M.App.getState();
 delete info.pathEndpointModes;
 nodes.get('dsafirRelaxMode').value='cineb';
 nodes.get('dsafirRelaxEndpoints').value='relax';
 await nodes.get('dsafirRelaxPrepare').click();
 assert.match(nodes.get('dsafirRelaxHelp').textContent,/bridge/);
 assert.equal(M.App.getState(),before);
 nodes.get('dsafirRelaxEndpoints').value='fixed';
 await nodes.get('dsafirRelaxPrepare').click();
 assert.equal(nodes.get('engineMode').value,'cineb');
 assert.equal(M.EngineUI.input().data.endpointMode,undefined);
});

test('relaxed climbing results may move endpoints only when the saved policy allows it',async()=>{
 const {M,select}=await boot();
 select('cineb');
 const j=M.EngineUI.input(),d=j.data;
 const result={mode:'cineb',endpointMode:'relax',symbols:d.symbols,cell:d.cell,
  images:structuredClone(d.images),energies:[0,1,0],effectiveFmax:.01,imageFmax:[.01,.01,.01],
  climbingImage:1,converged:true,units:{energy:'eV',length:'angstrom'},
  diagnostics:{endpointPhysicalFmax:[.01,.01],climbingPhysicalFmax:.01,climbingBracketed:true}};
 result.images[0][1][0]+=.03;
 result.images.at(-1)[1][0]-=.02;
 M.EngineUI.validateResult(result,j);
 for(const diagnostics of [
  {...result.diagnostics,endpointPhysicalFmax:[.01,.5]},
  {...result.diagnostics,climbingPhysicalFmax:.5},
  {...result.diagnostics,climbingBracketed:false}
 ])assert.throws(()=>M.EngineUI.validateResult({...result,diagnostics},j),/収束/);
 assert.throws(()=>M.EngineUI.validateResult({...result,endpointMode:'fixed'},j),/端点/);
 assert.throws(()=>M.EngineUI.validateResult({...result,endpointMode:'fixed'},{...j,data:{...d,endpointMode:'fixed'}}),/端点/);
});

test('path mirror pairs use displayed atom numbers and persist when restoring or refining a path',async()=>{
 const {M,nodes,select}=await boot(),spec={type:'mirror',pairs:[[1,2]]};
 for(const mode of ['neb','cineb','lup']){
  select(mode);
  assert.equal(nodes.get('enginePathSymmetry').hidden,false);
  assert.equal(M.EngineUI.input().data.pathSymmetry,undefined);
 }
 nodes.get('engineMirror').checked=true;
 nodes.get('engineMirrorPairs').value='２ － ３';
 const {data,frames}=M.EngineUI.input();
 assert.deepEqual(structuredClone(data.pathSymmetry),spec);
 for(const mode of ['optimize','evaluate','perpendicular']){
  select(mode);
  assert.equal(nodes.get('enginePathSymmetry').hidden,true);
  assert.equal(M.EngineUI.input().data.pathSymmetry,undefined);
 }
 M.EngineUI.restoreJob({id:'b'.repeat(32),data},true);
 assert.equal(nodes.get('engineMirrorPairs').value,'2-3');
 assert.equal(nodes.get('engineMirrorFields').hidden,false);
 M.EngineUI.restoreInput({...data,pathSymmetry:undefined});
 assert.equal(nodes.get('engineMirror').checked,false);
 M.PathRefinement.init();
 M.PathRefinement.open(frames,'lup',spec);
 await nodes.get('refineNEB').click();
 assert.deepEqual(structuredClone(M.EngineUI.input().data.pathSymmetry),spec);
 M.EngineUI.prepareNEB('cineb',null);
 assert.equal(M.EngineUI.input().data.pathSymmetry,undefined);
});

test('a requested reflection is rejected for invalid atom pairs and unsupported bridges',async()=>{
 const {M,nodes,select,info}=await boot();
 select('cineb');
 nodes.get('engineMirror').checked=true;
 for(const [value,reason] of [['',/形式/],['H2-H3',/形式/],['0-3',/範囲外/],['2-4',/範囲外/],
                             ['2-2',/重複/],['2-3 3-2',/重複/],['1-3',/元素/]]){
  nodes.get('engineMirrorPairs').value=value;
  assert.throws(()=>M.EngineUI.input(),reason);
 }
 nodes.get('engineMirrorPairs').value='2-3';
 delete info.pathSymmetryTypes;
 M.EngineUI.settings();
 assert.match(nodes.get('engineMirrorCapability').textContent,/更新/);
 assert.throws(()=>M.EngineUI.input(),/1\.19\.0/);
});

test('mirror CI convergence checks allowed forces while retaining full-force diagnostics',async()=>{
 const {M,nodes,select}=await boot();
 select('cineb');
 nodes.get('engineMirror').checked=true;
 nodes.get('engineMirrorPairs').value='2-3';
 const j=M.EngineUI.input(),d=j.data;
 const result={mode:'cineb',endpointMode:'relax',pathSymmetry:d.pathSymmetry,symbols:d.symbols,cell:d.cell,
  images:structuredClone(d.images),energies:[0,1,0],effectiveFmax:.01,imageFmax:[.01,.01,.01],
  climbingImage:1,converged:true,units:{energy:'eV',length:'angstrom'},
  diagnostics:{endpointPhysicalFmax:[.4,.5],climbingPhysicalFmax:.4,climbingBracketed:true,
    endpointAllowedFmax:[.01,.01],climbingAllowedFmax:.01,symmetryRemovedFmax:.48,symmetryResidual:1e-9}};
 M.EngineUI.validateResult(result,j);
 assert.throws(()=>M.EngineUI.validateResult({...result,pathSymmetry:undefined},j),/鏡映条件/);
 assert.throws(()=>M.EngineUI.validateResult({...result,pathSymmetry:{...d.pathSymmetry,maxInitialCorrection:.75}},j),/鏡映条件/);
 assert.throws(()=>M.EngineUI.validateResult({...result,initialSymmetryCorrection:.2},j),/補正量/);
 for(const [key,value] of [['symmetryResidual',.05],['symmetryRemovedFmax',undefined],['climbingAllowedFmax',.5],
                           ['endpointAllowedFmax',[.1,.5]],['endpointAllowedFmax',undefined]]){
  assert.throws(()=>M.EngineUI.validateResult({...result,diagnostics:{...result.diagnostics,[key]:value}},j),/鏡映|収束/);
 }
});

test('energy/force inconsistency remains visible on saved paths and does not block their use',async()=>{
 const {M,nodes,select}=await boot();
 M.EnergyProfile.set=()=>{};
 M.ResearchUI.showResult=()=>{};
 select('neb');
 const j=M.EngineUI.input(),d=j.data;
 const r={mode:'neb',symbols:d.symbols,cell:d.cell,images:d.images,nodeIds:['n0','n1','n2'],
  energies:[0,1,0],imageFmax:[0,.2,0],effectiveFmax:.2,reason:'step_limit',converged:false,
  steps:4,evaluations:15,units:{energy:'eV',length:'angstrom'},
  pathConsistencyWarning:{nodeId:'n1',step:3,maxDisplacementAngstrom:.035,
   energyChangeEV:.45,predictedEnergyChangeEV:-.005,errorEV:.455}};
 M.EngineUI.restoreJob({id:'a'.repeat(32),data:d,result:r});
 assert.equal(nodes.get('enginePathWarning').hidden,false);
 assert.match(nodes.get('enginePathWarningDetail').textContent,/ステップ3のノード2/);
 assert.match(nodes.get('enginePathWarningDetail').textContent,/0.4550 eV/);
 assert.match(nodes.get('enginePathWarningDetail').textContent,/0.0350 Å/);
 assert.match(nodes.get('engineMessage').textContent,/エネルギー変化と力/);
 assert.equal(nodes.get('engineApply').disabled,false);
 M.EngineUI.showResult({...r,pathConsistencyWarning:undefined},j);
 assert.equal(nodes.get('enginePathWarning').hidden,true);
});

test('initial mirror correction is optional, bounded and reproduced in saved path settings',async()=>{
 const {M,nodes,select}=await boot(),limit=nodes.get('engineMirrorLimit');
 select('cineb');
 nodes.get('engineMirror').checked=true;
 nodes.get('engineMirrorPairs').value='2-3';
 assert.equal(M.EngineUI.input().data.pathSymmetry.maxInitialCorrection,undefined);
 for(const value of ['',-.01,2.001,'NaN']){
  limit.value=value;
  assert.throws(()=>M.EngineUI.input(),/補正上限/);
 }
 for(const value of [0,.75,2]){
  limit.value=value;
  const {data}=M.EngineUI.input();
  assert.equal(data.pathSymmetry.maxInitialCorrection,value);
  limit.value=.05;
  M.EngineUI.restoreInput(data);
  assert.equal(Number(limit.value),value);
  assert.equal(nodes.get('engineMirrorOptions').open,true);
  assert.match(nodes.get('engineMirrorOptionsLabel').textContent,new RegExp(String(value)));
 }
 const {data}=M.EngineUI.input();
 delete data.pathSymmetry.maxInitialCorrection;
 M.EngineUI.restoreInput(data);
 assert.equal(Number(limit.value),.05);
 assert.equal(nodes.get('engineMirrorOptions').open,false);
 assert.equal(M.EngineUI.input().data.pathSymmetry.maxInitialCorrection,undefined);
});

test('unrestricted path relaxation sends the selected whole-band optimizer and displacement, across modes and history',async()=>{
 const {M,nodes,info,select}=await boot();
 info.modes.push('neb');
 for(const mode of ['neb','cineb','lup'])info.pathOptimizers[mode]=['band-lbfgs','fire',...(mode==='lup'?['lbfgs']:[])];
 for(const mode of ['neb','cineb','lup']){
  select(mode);
  nodes.get('enginePathOptimizer').value='band-lbfgs';
  nodes.get('engineMove').value='.013';
  const data=M.EngineUI.input().data;
  assert.equal(data.optimizer,'band-lbfgs');assert.equal(data.maxMove,.013);
  assert.equal(data.pathSymmetry,undefined);assert.equal(data.fixedAtoms,undefined);
  assert.equal(nodes.get('enginePathOptimizerLabel').hidden,false);
  M.EngineUI.restoreInput({...data,optimizer:undefined});
  assert.equal(nodes.get('enginePathOptimizer').value,mode==='lup'?'lbfgs':'fire');
  M.EngineUI.restoreInput(data);
  assert.equal(M.EngineUI.input().data.optimizer,'band-lbfgs');
 }
 select('optimize');
 assert.equal(nodes.get('enginePathOptimizerLabel').hidden,true);
 assert.notEqual(M.EngineUI.input().data.optimizer,'band-lbfgs');
 select('cineb');
 assert.equal(nodes.get('enginePathOptimizer').value,'band-lbfgs');
 assert.equal(Number(nodes.get('engineMove').value),.013);
 info.pathOptimizers.cineb=['fire'];
 assert.throws(()=>M.EngineUI.input(),/経路アルゴリズム/);
 assert.equal(nodes.get('enginePathOptimizer').value,'band-lbfgs');
 M.EngineUI.restoreInput({mode:'cineb',optimizer:'band-lbfgs',endpointMode:'fixed'});
 assert.throws(()=>M.EngineUI.input(),/経路アルゴリズム/);
});
