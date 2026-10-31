'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function boot(){
 const nodes=new Map();
 class Element {
  constructor(){this.value='';this.events={};this.children=[];this.style={};}
  addEventListener(type,fn){this.events[type]=fn;}setAttribute(){}after(){}append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}click(){return this.events.click?.();}
 }
 const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const document={getElementById:get,querySelector:()=>new Element(),createElement:()=>new Element()};
 const c=vm.createContext({window:{},document,console});
 for(const file of ['model','geometry','bonding','io','periodic','structure-analysis','structure-analysis-ui'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file+'.js'),'utf8'),c);
 const M=c.window.MoleculeVisualizer,state=M.Model.createState({atoms:[{id:'a',element:'C',x:0,y:0,z:0},{id:'b',element:'H',x:1,y:0,z:0},{id:'c',element:'O',x:0,y:2,z:0}],bonds:[{id:'manual',atom1:'a',atom2:'b',order:2,source:'manual'}]}),renderer={renderState(s){this.state=s;}};
 M.App={getState:()=>state,renderer:()=>renderer};M.Studio={stop(){}};M.EngineUI={isBusy:()=>false};
 let builds=0;const infer=M.Bonding.refreshInferredBonds;M.Bonding.refreshInferredBonds=s=>{builds++;return infer(s);};
 M.StructureAnalysisUI.init();get('analysisSource').value='latest';get('analysisAtoms').value='all';get('analysisThreshold').value='.01';
 const points=[[0,0,0],[1,0,0],[0,2,0]],result={mode:'optimize',symbols:['C','H','O'],images:[points],energies:[-1],charge:0,multiplicity:1,cell:null};
 return {M,nodes,get,state,renderer,result,points,builds:()=>builds};
}
test('receiving a long result builds no frames; the size guard runs before coordinate expansion',()=>{
 const {M,result,points,get,builds}=boot(),images=Array(10001).fill(points);
 Object.defineProperty(images,0,{get(){throw Error('unused coordinates must stay untouched');}});
 M.StructureAnalysisUI.setSource({...result,trajectory:{images,energies:Array(10001).fill(-1)}});
 assert.equal(builds(),0);M.StructureAnalysisUI.refresh();assert.match(get('analysisMessage').textContent,/最大500/);assert.equal(builds(),0);
});
test('comparison materializes only selected frames, bounds reuse and snapshots the input template',()=>{
 const {M,state,result,points,get,renderer,builds}=boot();
 const images=Array.from({length:12},(_,i)=>points.map(p=>[p[0]+i,p[1],p[2]]));
 M.StructureAnalysisUI.setSource({...result,trajectory:{images,energies:images.map((_,i)=>-i)}},{original:state});
 state.atoms[0].element='N';state.bonds[0].order=3;M.StructureAnalysisUI.refresh();assert.equal(builds(),0);
 get('analysisReference').value='0';get('analysisMobile').value='1';get('analysisOverlay').click();
 assert.equal(builds(),2);assert.match(get('analysisMessage').textContent,/RMSD = 0\.00000/);
 assert.equal(renderer.state.atoms[0].element,'C');assert.equal(renderer.state.bonds.find(b=>b.id==='manual').order,2);
 renderer.state.atoms[0].x=99;renderer.state.metadata.externalCalculation.energyEV=99;
 get('analysisOverlay').click();assert.equal(builds(),2);assert.equal(renderer.state.atoms[0].x,0);assert.equal(renderer.state.metadata.externalCalculation.energyEV,0);
 for(let i=2;i<12;i++){get('analysisReference').value=String(i-1);get('analysisMobile').value=String(i);get('analysisOverlay').click();}
 assert.equal(builds(),12);get('analysisReference').value='0';get('analysisMobile').value='1';get('analysisOverlay').click();assert.equal(builds(),14);
 assert.deepEqual(images[0],points);
});
test('deduplication uses raw result coordinates and keeps same-condition energy selection',async()=>{
 const {M,result,points,get,builds}=boot();
 M.StructureAnalysisUI.setSource({...result,trajectory:{images:[points,points.map(p=>[p[0]+2,p[1],p[2]])],energies:[-1,-2]}});
 M.StructureAnalysisUI.refresh();await get('analysisCluster').click();
 assert.equal(builds(),0);assert.match(get('analysisMessage').textContent,/2構造 → 1代表/);
 assert.equal(get('analysisRows').children[0].children[1].textContent,2);
 assert.equal(get('analysisRows').children[0].children[5].textContent,'同一条件の最低エネルギー');
});
test('periodic result comparisons are rejected before any frames are built',()=>{
 const {M,result,get,builds}=boot();
 M.StructureAnalysisUI.setSource({...result,cell:{vectors:[[8,0,0],[0,8,0],[0,0,8]],pbc:[true,false,false]}});
 M.StructureAnalysisUI.refresh();assert.match(get('analysisMessage').textContent,/周期セル/);assert.equal(builds(),0);
});
