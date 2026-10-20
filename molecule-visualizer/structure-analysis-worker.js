/* Keep RMSD clustering off the renderer's main thread. */
importScripts('./structure-analysis.js');
self.onmessage=function(event){
  try{self.postMessage({result:self.MoleculeVisualizer.StructureAnalysis.deduplicate(event.data.images,event.data.options)});}
  catch(error){self.postMessage({error:error.message});}
};
