'use strict';
self.window=self;
importScripts('./model.js?v=15','./bonding.js?v=15','./geometry.js?v=15','./io.js?v=15','./periodic.js?v=15','./ring-conformers.js?v=15','./generation.js?v=15');
self.onmessage=e=>{
  try{const {kind,state,end,options}=e.data,G=self.MoleculeVisualizer.Generation,progress=value=>self.postMessage({progress:value});const result=kind==='random'?G.randomStructures(state,options,progress):G.path(state,end,options,progress);self.postMessage({result});}
  catch(error){self.postMessage({error:error.message||String(error)});}
};
