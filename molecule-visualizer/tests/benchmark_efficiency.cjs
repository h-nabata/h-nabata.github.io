// node --expose-gc molecule-visualizer/tests/benchmark_efficiency.cjs BASELINE_DIRECTORY
// Public synthetic inputs; helper timings, not chemical inference speedups.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const current=path.resolve(__dirname,'..'),baseline=path.resolve(process.argv[2]);
function load(dir){
 const c=vm.createContext({window:{},console});
 for(const file of ['model','geometry','bonding','io','periodic','measurements','structure-analysis-ui'])vm.runInContext(fs.readFileSync(path.join(dir,file+'.js'),'utf8'),c);
 return c.window.MoleculeVisualizer;
}
function timing(fn){fn();const samples=[];for(let i=0;i<5;i++){const t=performance.now();fn();samples.push(performance.now()-t);}return samples.sort((a,b)=>a-b)[2];}
function run(dir){
 const M=load(dir),atoms=Array.from({length:100},(_,i)=>({id:'a'+i,element:'C',x:i%10*1.4,y:Math.floor(i/10)*1.4,z:0}));
 const state=M.Model.createState({atoms}),images=Array.from({length:1000},(_,i)=>atoms.map(a=>[a.x,a.y,a.z+i*.001]));
 const result={mode:'optimize',symbols:atoms.map(a=>a.element),images:[images.at(-1)],energies:[-1],trajectory:{images,energies:images.map((_,i)=>-i/1000)},charge:0,multiplicity:1,cell:null};
 M.App={getState:()=>state};let builds=0;const infer=M.Bonding.refreshInferredBonds;M.Bonding.refreshInferredBonds=s=>{builds++;return infer(s);};
 global.gc();const memory=process.memoryUsage().heapUsed,start=performance.now();M.StructureAnalysisUI.setSource(result);
 const receiveMS=performance.now()-start;global.gc();const retainedMB=(process.memoryUsage().heapUsed-memory)/1e6;
 const receiveBuilds=builds;
 const large=M.Model.createState({atoms:Array.from({length:5000},(_,i)=>({id:'select'+i,element:'C'}))}),ids=large.atoms.map(a=>a.id).reverse();
 const selectionMS=timing(()=>M.Model.setSelectedAtoms(large,ids));assert.deepEqual([...large.selectedAtomIds],ids);
 const directions=[{x:1,y:0,z:1},{x:-.5,y:.8660254,z:1},{x:-.5,y:-.8660254,z:1}],radii=Array.from({length:8},(_,i)=>[.1+i*.01,.2,.3]);
 const values=radii.map(r=>M.Measurements.enclosingCone(directions,r).value);
 const coneMS=timing(()=>{for(let frame=0;frame<40;frame++)for(const r of radii)M.Measurements.enclosingCone(directions,r);});
 return {receiveResult:{frames:1000,atoms:100,milliseconds:receiveMS,additionalRetainedHeapMB:retainedMB,inferredFrames:receiveBuilds},bulkSelection:{atoms:5000,milliseconds:selectionMS},coneRefresh:{pins:8,refreshes:40,milliseconds:coneMS},values};
}
const before=run(baseline),after=run(current);assert.deepEqual(after.values,before.values);delete before.values;delete after.values;
console.log(JSON.stringify({node:process.version,before,after},null,2));
