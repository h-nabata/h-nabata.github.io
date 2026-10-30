// node --expose-gc tests/benchmark_resource_memory.cjs BASELINE_DIRECTORY
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{performance}=require('node:perf_hooks');
const current=path.resolve(__dirname,'..');
function run(dir){const c=vm.createContext({window:{}});for(const file of ['model.js','history.js'])vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),c);const M=c.window.MoleculeVisualizer;
 const atoms=Array.from({length:200},(_,i)=>({id:'a'+i,element:'C',x:i%10,y:Math.floor(i/10),z:Math.sin(i)}));
 const trajectory=Array.from({length:200},(_,f)=>({atoms:atoms.map(a=>({...a,z:a.z+f*.001})),bonds:[],metadata:{energy:f*.01}}));
 const state=M.Model.createState({atoms,bonds:[],metadata:{trajectory,frameIndex:0}}),history=new M.History(120);
 global.gc();const before=process.memoryUsage().heapUsed,times=[];
 for(let i=0;i<20;i++){const start=performance.now();history.push('edit',state);times.push(performance.now()-start);}
 global.gc();const heap=(process.memoryUsage().heapUsed-before)/1e6;
 return {firstPushMS:times[0],medianSubsequentPushMS:times.slice(1).sort((a,b)=>a-b)[9],additionalHeapMB:heap,undoEntries:history.undoStack.length};
}
console.log(JSON.stringify({node:process.version,atoms:200,frames:200,before:run(process.argv[2]),after:run(current)},null,2));
