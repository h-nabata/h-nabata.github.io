'use strict';
self.window=self;
importScripts('./model.js?v=14','./bonding.js?v=14','./geometry.js?v=14','./io.js?v=14','./periodic.js?v=14','./generation.js?v=14');
self.onmessage=e=>{
  try{const {kind,state,end,options}=e.data,G=self.MoleculeVisualizer.Generation,progress=value=>self.postMessage({progress:value});const result=kind==='random'?G.randomStructures(state,options,progress):G.path(state,end,options,progress);self.postMessage({result});}
  catch(error){self.postMessage({error:error.message||String(error)});}
};
