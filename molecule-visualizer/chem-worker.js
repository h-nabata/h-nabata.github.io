/* Dedicated worker: expensive conformer generation must never block editing. */
'use strict';
self.onmessage=async function(event){
  let mol,conv,gen;
  try{
    importScripts('./vendor/openbabel/openbabel.js');
    const resource=async name=>{const r=await fetch(new URL('./vendor/openbabel/'+name,self.location.href));if(!r.ok)throw Error('化学エンジンのデータを取得できません: '+r.status);return r.arrayBuffer();};
    const [packageData,wasmBinary]=await Promise.all([resource('openbabel.data'),resource('openbabel.wasm')]);
    const {module:Module}=await new Promise((resolve,reject)=>{
      // This pinned wrapper supplies its own onRuntimeInitialized and locateFile.
      // Use its documented initialization hook and preload both binary resources.
      self.__$openBabelInitialized$__=event=>resolve(event);
      OpenBabelModule({wasmBinary:new Uint8Array(wasmBinary),getPreloadedPackage:()=>packageData,onAbort:reason=>reject(Error(String(reason))),print:()=>{},printErr:()=>{}});
    });
    const {data,input,output,generate}=event.data;
    conv=new Module.ObConversionWrapper();mol=new Module.OBMol();
    if(!conv.setInFormat('',input)||!conv.readString(mol,data)||!mol.NumAtoms())throw Error('構造を読み取れませんでした。');
    if(generate){if(mol.NumAtoms()>200)throw Error('3D生成は200原子までです。');gen=new Module.OB3DGenWrapper();if(gen.generate3DStructure(mol,'UFF')<0)throw Error('UFFで3D座標を生成できません。この元素・結合・価数の組合せに未対応の可能性があります。');}
    if(!conv.setOutFormat('',output))throw Error('未対応の出力形式です。');
    const result=conv.writeString(mol,false);if(!result.trim())throw Error('変換結果が空です。');self.postMessage({result});
  }catch(error){self.postMessage({error:error.message||String(error)});}finally{gen?.delete();mol?.delete();conv?.delete();}
};
