// Exercise the real path form/request boundary without a browser or compute engine.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
async function boot(){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),nodes=new Map();
 class Element{
  constructor(id=''){this.id=id;this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.children=[];this.events={};this.textContent='';this.firstChild={textContent:id};}
  set value(v){this._value=String(v);}get value(){return this._value;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}closest(){return this;}replaceChildren(...children){this.children=children;}append(...children){this.children.push(...children);}setAttribute(){}showModal(){this.open=true;}close(){this.open=false;}click(){return Promise.all((this.events.click||[]).map(fn=>fn()));}
 }
 for(const m of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const node=new Element(m[3]);node.value=m[2].match(/value="([^"]*)"/)?.[1]||'';node.checked=/\bchecked\b/.test(m[2]);nodes.set(node.id,node);}
 for(const m of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g))nodes.get(m[1]).value=m[2].match(/<option\b[^>]*value="([^"]*)"/)?.[1]||'';
 const document={getElementById:id=>nodes.get(id),createElement:()=>new Element()},window={document};
 const info={version:'1.9.0',engine:'tblite',method:'GFN2-xTB',engineVersion:'fixture',modes:['evaluate','optimize','cineb','lup'],lup:true,pathOptimizers:{cineb:['fire'],lup:['fire','lbfgs']},maxImages:100,maxSteps:10000,vibrations:true,adaptiveNEB:true,pathSplit:true};
 const ctx=vm.createContext({window,document,location:{hostname:'example.test'},URL,AbortController,setTimeout,clearTimeout,console,fetch:async()=>({ok:true,json:async()=>info})});
 for(const f of ['model','optimization','bonding','geometry','io','molfile','periodic','constraints','research-ui','engine-ui','path-refinement'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../'+f+'.js'),'utf8'),ctx,{filename:f+'.js'});
 const M=window.MoleculeVisualizer;let state=M.Model.createState({atoms:[{id:'o',element:'O',x:0,y:0,z:0},{id:'h1',element:'H',x:.96,y:0,z:0},{id:'h2',element:'H',x:-.24,y:.93,z:0}]});
 state.metadata.pathNodeId='n0';state.metadata.trajectory=[0,.1,.2].map((shift,i)=>{const f=M.Periodic.snapshot(state);f.atoms[1].x+=shift;f.metadata.pathNodeId='n'+i;return f;});state.metadata.frameIndex=0;
 M.App={getState:()=>state,getDisplayedState:()=>state,useDisplayedStructure(){},freezeDisplayedStructure(){},change(_label,fn){state=fn(state)||state;}};M.EnergyProfile={reset(){}};M.Studio={stop(){}};M.App.setStatus=()=>{};
 // Row editors are unrelated here; their existing browser contracts cover init.
 M.ResearchUI.init=()=>{};M.EngineUI.init();nodes.get('engineURL').value='http://127.0.0.1:8766';nodes.get('engineToken').value='fixture-only';await nodes.get('engineConnect').click();assert.ok(M.EngineUI.getConnection());
 return {M,nodes,info,select(mode){nodes.get('engineMode').value=mode;M.EngineUI.settings();}};
}
test('LUP path form keeps CI-NEB defaults and sends current unsaved method settings without a spring',async()=>{
 const {M,nodes,select}=await boot();M.EngineUI.prepareNEB();assert.equal(nodes.get('engineMode').value,'cineb');assert.equal(nodes.get('engineSteps').value,'100');
 select('lup');assert.equal(nodes.get('lupOptimizer').value,'lbfgs');assert.equal(nodes.get('engineScope').value,'all');assert.equal(nodes.get('engineScope').disabled,true);assert.equal(nodes.get('engineSpringLabel').hidden,true);assert.equal(nodes.get('engineClimbLabel').hidden,false);assert.equal(nodes.get('engineLUPSettings').hidden,false);assert.equal(nodes.get('engineAdaptiveSettings').hidden,false);
 for(const [id,value] of Object.entries({engineSteps:'72',engineFmax:'.025',engineMove:'.02',engineClimb:'7',lupOptimizer:'lbfgs',lupRedistributeEvery:'3',lupRedistributionTolerance:'.0007',engineSpring:'invalid-but-hidden'}))nodes.get(id).value=value;
 nodes.get('adaptiveEnabled').checked=true;nodes.get('adaptiveMaxImages').value='7';nodes.get('pathSplitEnabled').checked=true;
 const {data}=M.EngineUI.input();assert.equal(data.mode,'lup');assert.equal(data.images.length,3);assert.equal(data.maxSteps,72);assert.equal(data.fmax,.025);assert.equal(data.maxMove,.02);assert.equal(data.climbAfter,7);assert.equal(data.optimizer,'lbfgs');assert.equal(data.spring,undefined);assert.equal(JSON.stringify(data.lup),JSON.stringify({redistributeEvery:3,redistributionTolerance:.0007}));assert.equal(data.adaptiveNEB.maxImages,7);assert.equal(data.pathSplit.enabled,true);assert.equal(JSON.stringify(data.nodeIds),'["n0","n1","n2"]');
 select('cineb');assert.equal(nodes.get('engineSteps').value,'100');assert.equal(nodes.get('engineSpringLabel').hidden,false);assert.equal(nodes.get('engineLUPSettings').hidden,true);M.EngineUI.prepareNEB();assert.equal(nodes.get('engineMode').value,'cineb');
});
test('LUP refuses invalid redistribution, missing capability, too few images and mismatched endpoints',async()=>{
 const {M,nodes,info,select}=await boot();select('lup');nodes.get('lupRedistributeEvery').value='0';assert.throws(()=>M.EngineUI.input(),/1〜100/);nodes.get('lupRedistributeEvery').value='5';nodes.get('lupRedistributionTolerance').value='0';assert.throws(()=>M.EngineUI.input(),/0.00001/);nodes.get('lupRedistributionTolerance').value='.001';
 const j=M.EngineUI.input(),r={mode:'lup',symbols:j.data.symbols,cell:j.data.cell,images:structuredClone(j.data.images),energies:[0,.2,0],effectiveFmax:.01,imageFmax:[0,.01,0],units:{energy:'eV',length:'angstrom'}};M.EngineUI.validateResult(r,j);r.images[0][0][0]+=.1;assert.throws(()=>M.EngineUI.validateResult(r,j),/端点/);
 info.modes=info.modes.filter(x=>x!=='lup');assert.throws(()=>M.EngineUI.input(),/LUP系/);info.modes.push('lup');info.pathOptimizers.lup=['fire'];nodes.get('lupOptimizer').value='lbfgs';assert.throws(()=>M.EngineUI.input(),/アルゴリズム/);nodes.get('lupOptimizer').value='fire';M.App.getState().metadata.trajectory.length=2;assert.throws(()=>M.EngineUI.input(),/3〜100/);
});
test('LUP history restores its optimizer, redistribution and path scope across reopen',async()=>{
 const {M,nodes,select}=await boot();select('lup');nodes.get('engineSteps').value='61';nodes.get('lupOptimizer').value='lbfgs';nodes.get('lupRedistributeEvery').value='9';nodes.get('lupRedistributionTolerance').value='.0008';const {data}=M.EngineUI.input();select('optimize');M.EngineUI.restoreJob({id:'a'.repeat(32),data},true);M.EngineUI.open();assert.equal(nodes.get('engineMode').value,'lup');assert.equal(nodes.get('engineScope').value,'all');assert.equal(Number(nodes.get('engineSteps').value),61);assert.equal(nodes.get('lupOptimizer').value,'lbfgs');assert.equal(Number(nodes.get('lupRedistributeEvery').value),9);assert.equal(Number(nodes.get('lupRedistributionTolerance').value),.0008);assert.equal(M.EngineUI.input().data.lup.redistributionTolerance,.0008);
});

test('manual node insertion keeps LUP mode and existing node identities',async()=>{
 const {M,nodes}=await boot(),frames=M.EngineUI.frames(M.App.getState(),'all');
 const refined=M.PathRefinement.refine(frames,0,2,1);assert.equal(refined.length,5);assert.equal(JSON.stringify([refined[0],refined[2],refined[4]].map(f=>f.metadata.pathNodeId)),'["n0","n1","n2"]');assert.equal(new Set(refined.map(f=>f.metadata.pathNodeId)).size,5);
 M.PathRefinement.init();M.PathRefinement.open(frames,'lup');assert.match(nodes.get('refineNEB').textContent,/LUP系/);await nodes.get('refineNEB').click();assert.equal(nodes.get('engineMode').value,'lup');assert.equal(M.App.getState().metadata.trajectory.length,5);assert.equal(new Set(M.EngineUI.input().data.nodeIds).size,5);
 M.PathRefinement.open();assert.match(nodes.get('refineNEB').textContent,/CI-NEB/);
});
