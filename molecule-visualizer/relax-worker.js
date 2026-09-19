'use strict';
self.window=self;
importScripts('./model.js?v=12','./bonding.js?v=12','./geometry.js?v=12','./io.js?v=12','./periodic.js?v=12','./relax.js?v=12');
self.onmessage=function(e){
  try{self.postMessage({result:self.MoleculeRelax(e.data,self.MoleculeVisualizer.Bonding.COVALENT_RADII,self.MoleculeVisualizer.Periodic.minimumImage)});}
  catch(error){self.postMessage({error:error.message||String(error)});}
};
