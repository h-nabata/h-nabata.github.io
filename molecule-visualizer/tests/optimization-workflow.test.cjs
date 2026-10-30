const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(kind='reaction',options={}){
 const nodes=new Map();class Element{constructor(){this.value='';this.disabled=false;this.textContent='';this.children=[];}replaceChildren(){this.children=[];}append(...items){this.children.push(...items);}}
 const $=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const values={workflowRecipe:kind,engineTSMethod:'sella-prfo',engineTrust:'.04',engineVibrationDelta:'.01',engineVibrationNfree:'2',engineVibrationThreshold:'50',ircStepSize:'.1',workflowCount:'2',workflowSeed:'1',workflowRmsd:'.1'};for(const [id,value] of Object.entries(values))$(id).value=value;
 const clone=x=>JSON.parse(JSON.stringify(x)),p=[[0,0,0],[1,0,0]],original={atoms:p.map((v,i)=>({id:'a'+i,element:'H',x:v[0],y:0,z:0})),metadata:{}},data={mode:kind==='minimum'||kind==='conformers'?'optimize':kind==='string'?'lup':'cineb',symbols:['H','H'],atomIds:['a0','a1'],cell:null,images:['minimum','conformers'].includes(kind)?[p]:[p,p.map(v=>v.map(x=>x+.1)),p.map(v=>v.map(x=>x+.2))],charge:0,multiplicity:1,maxSteps:20,fmax:.01,maxMove:.04,optimizer:'fire',climbAfter:3,spring:.1};
 if(options.modelF)data.modelF=clone(options.modelF);
 const jobs=[],shown=[],connection={info:{modes:['optimize','vibrations','cineb','lup','ts','irc'],sellaVersion:'test',vibrations:true}};
 const M={Model:{createState:clone},Periodic:{snapshot:clone},App:{getState:()=>original},OptimizationUI:{sync(){}},StructureAnalysis:require('../structure-analysis.js'),EngineUI:{isBusy:()=>false,getConnection:()=>connection,input:()=>({data,original}),showSettings(){},showResult:(r,j)=>shown.push(j),validateResult:r=>{assert.ok(r.images.length);},request:async(_c,url,body)=>{if(url==='/api/jobs'){jobs.push(clone(body));return{id:jobs.length.toString(16).padStart(32,'0')};}return {};},pollJob:async j=>{
  if(options.onPoll)await options.onPoll(j,$,M);
  const r={images:clone(j.data.images),energies:j.data.images.map((_,i)=>i===1?10:0),converged:options.converged!==false,reason:'test'};if(j.data.mode==='vibrations')r.vibrations={status:'completed',significantImaginaryCount:options.imaginary??(kind==='minimum'?0:1)};
  return{status:'completed',result:r};}}};
 const ctx=vm.createContext({window:{MoleculeVisualizer:M},document:{getElementById:$,createElement:()=>new Element()},setTimeout,clearTimeout,console,Worker:class{postMessage(){queueMicrotask(()=>this.onmessage({data:{result:{state:{...original,metadata:{trajectory:[original,clone(original)]}},message:'public fixture'}}}));}terminate(){}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../workflow-ui.js'),'utf8'),ctx);return{M,jobs,shown,$};
}
test('reaction recipe chains peak → TS → Hessian → IRC using the initial stage settings',async()=>{
 const modelF={model:'amf',surface:'upper',alphaKJMol:41.25,multiplicities:[1,3]};
 const {M,jobs,$}=setup('reaction',{modelF,onPoll:async(j,$)=>{$('engineTrust').value='.2';$('ircStepSize').value='.4';}});await M.WorkflowUI.run();
 assert.deepEqual(jobs.map(j=>j.mode),['cineb','ts','vibrations','irc']);assert.deepEqual(jobs[1].images,[jobs[0].images[1]]);assert.equal(jobs[1].trustRadius,.04);assert.equal(jobs[3].irc.stepSize,.1);jobs.forEach(j=>assert.deepEqual(j.modelF,modelF));assert.match($('workflowMessage').textContent,/完了/);assert.equal(M.WorkflowUI.isBusy(),false);
});
test('wrong imaginary count and user cancellation stop subsequent workflow jobs',async()=>{
 const first=setup('string',{imaginary:2});await first.M.WorkflowUI.run();assert.deepEqual(first.jobs.map(j=>j.mode),['lup','ts','vibrations']);assert.match(first.$('workflowMessage').textContent,/停止/);
 let cancelled=false;const second=setup('minimum',{onPoll:async(_j,_$,M)=>{if(!cancelled){cancelled=true;await M.WorkflowUI.cancel();}}});await second.M.WorkflowUI.run();assert.equal(second.jobs.length,1);assert.match(second.$('workflowMessage').textContent,/中止/);
});
test('conformer workflow minimizes each generated frame then keeps one identical representative',async()=>{
 const {M,jobs,$}=setup('conformers');await M.WorkflowUI.run();assert.deepEqual(jobs.map(j=>j.mode),['optimize','optimize']);assert.match($('workflowMessage').textContent,/2配座 → 1代表構造/);
});
