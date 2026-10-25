'use strict';
self.window=self;
importScripts('./model.js?v=performance-41','./bonding.js?v=performance-41','./geometry.js?v=performance-41','./io.js?v=performance-41','./periodic.js?v=performance-41','./relax.js?v=performance-41');
self.onmessage=function(e){
  try{self.postMessage({result:self.MoleculeRelax(e.data,self.MoleculeVisualizer.Bonding.COVALENT_RADII,(e.data.metadata?.cell?self.MoleculeVisualizer.Periodic.prepareMinimumImage(e.data.metadata.cell):self.MoleculeVisualizer.Periodic.minimumImage))});}
  catch(error){self.postMessage({error:error.message||String(error)});}
};
