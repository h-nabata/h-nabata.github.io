const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const window={MoleculeVisualizer:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../llmlip-ui.js'),'utf8'),{window});
const api=window.MoleculeVisualizer.LLMLIPUI;
const model={id:'mace',available:true,architecture:'mace-lite-v1',species:['O','H'],heads:['default'],defaultHead:'default',dtypes:['float64','float32'],periodic:'partial',charge:false,spin:false};
const info={llmlip:{models:[model,{id:'bad',available:false}],maxThreads:8,workers:2}};
const data={symbols:['O','H','H'],charge:0,multiplicity:1,mode:'evaluate',llmlip:{model:'mace',head:'default',dtype:'float64',threads:4}};
test('model capability boundary rejects unsupported species, charges and unregistered selections',()=>{
 assert.doesNotThrow(()=>api.validate(data,info));
 for(const change of [{symbols:['O','C','H']},{charge:1,multiplicity:2},{multiplicity:3},{llmlip:{...data.llmlip,model:'bad'}},{llmlip:{...data.llmlip,model:'/etc/passwd'}},{llmlip:{...data.llmlip,head:'wrong'}},{llmlip:{...data.llmlip,threads:1}}])assert.throws(()=>api.validate({...data,...change},info));
});
test('finite differences use f64 and unsupported workflows fail closed',()=>{
 for(const change of [{mode:'ts'},{mode:'irc'},{mode:'vibrations'},{vibrations:{delta:.001}}])assert.throws(()=>api.validate({...data,...change,llmlip:{...data.llmlip,dtype:'float32'}},info));
 for(const change of [{modelF:{}},{cellOptimization:{mode:'full'}}])assert.throws(()=>api.validate({...data,...change},info));
});
test('charge/spin semantics follow the selected UMA head; partial PBC is restricted by model',()=>{
 const uma={...model,architecture:'uma-v1',heads:['omol','omat'],periodic:'partial'};
 const ui={llmlip:{...info.llmlip,models:[uma]}};
 const d={...data,charge:1,multiplicity:2,llmlip:{...data.llmlip,head:'omol'}};
 assert.doesNotThrow(()=>api.validate(d,ui));
 assert.throws(()=>api.validate({...d,llmlip:{...d.llmlip,head:'omat'}},ui));
 assert.throws(()=>api.validate({...d,cell:{pbc:[true,true,true]}},ui));
 assert.throws(()=>api.validate({...data,cell:{pbc:[true,false,false]}},{llmlip:{...info.llmlip,models:[{...model,periodic:'full'}]}}));
});
test('saved result provenance prevents swapping model, head, precision or CPU thread conditions',()=>{
 const r={engine:'llmlip',provenance:{llmlip:{...data.llmlip,device:'cpu',backend:'direct',modelSHA256:'a'.repeat(64)}}};
 assert.doesNotThrow(()=>api.validateResult(r,data));
 for(const change of [{model:'other'},{head:'omol'},{threads:8},{dtype:'float32'},{device:'cuda'},{modelSHA256:''}])assert.throws(()=>api.validateResult({...r,provenance:{llmlip:{...r.provenance.llmlip,...change}}},data));
 assert.throws(()=>api.validate(data,{engine:'uma'}));
});
