// Usage: node molecule-visualizer/tests/benchmark_performance.cjs [baseline-directory]
// Local helper timings; not end-to-end quantum/ML inference speedups.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{performance}=require('node:perf_hooks'),assert=require('node:assert/strict');
const current=path.resolve(__dirname,'..'),baseline=process.argv[2]&&path.resolve(process.argv[2]);
function load(dir){const ctx=vm.createContext({window:{},console});for(const name of ['model','bonding','io','periodic'])vm.runInContext(fs.readFileSync(fs.existsSync(path.join(dir,name+'.js'))?path.join(dir,name+'.js'):path.join(current,name+'.js'),'utf8'),ctx);return ctx.window.MoleculeVisualizer;}
function time(fn){fn();const samples=[];for(let i=0;i<5;i++){const start=performance.now();fn();samples.push(performance.now()-start);}return samples.sort((a,b)=>a-b)[2];}
function atoms(n){return Array.from({length:n},(_,i)=>({id:'a'+i,element:i%4?'C':'H',x:(i%20)*1.3,y:(Math.floor(i/20)%20)*1.3,z:Math.floor(i/400)*1.3}));}
const fast=load(current),old=baseline?load(baseline):null,rows=[];
for(const [name,n,cell] of [['gas500',500,null],['gas2000',2000,null],['periodic500',500,{vectors:[[29,0,0],[0,29,0],[0,0,29]],pbc:[true,true,true]}],['skew500',500,{vectors:[[29,0,0],[10,29,0],[4,3,29]],pbc:[true,true,true]}]]){
 const input=atoms(n),key=b=>b.map(b=>[b.atom1,b.atom2,b.type].join(':')).join('|');
 if(old)assert.equal(key(fast.Bonding.inferBonds(input,cell)),key(old.Bonding.inferBonds(input,cell)));
 const after=time(()=>fast.Bonding.inferBonds(input,cell)),before=old?time(()=>old.Bonding.inferBonds(input,cell)):null;
 rows.push({name,beforeMS:before,afterMS:after,speedup:before&&before/after});
}
const input={atoms:atoms(300).map(a=>({...a,element:'C',x:a.x*1.8,y:a.y*1.8,z:a.z*1.8})),bonds:[],metadata:{}},options={maxSteps:20,timeLimit:120000};
const relax=require(path.join(current,'relax.js')),run=()=>relax(input,fast.Bonding.COVALENT_RADII,fast.Periodic.minimumImage,options);
const after=time(run);let before=null,maxDifference=null;
if(baseline){
 const reference=require(path.join(baseline,'relax.js')),runOld=()=>reference(input,old.Bonding.COVALENT_RADII,old.Periodic.minimumImage,options);
 before=time(runOld);const a=run(),b=runOld();assert.equal(a.steps,b.steps);const ref=b.coordinates.flat();maxDifference=Math.max(...a.coordinates.flat().map((x,i)=>Math.abs(x-ref[i])));assert.ok(maxDifference<1e-10);
}
rows.push({name:'geometric-relax300-20steps',beforeMS:before,afterMS:after,speedup:before&&before/after,maxCoordinateDifference:maxDifference});
console.log(JSON.stringify({runtime:process.version,rows},null,2));
