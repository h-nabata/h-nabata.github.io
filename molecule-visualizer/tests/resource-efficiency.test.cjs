'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(){const c=vm.createContext({window:{},console});for(const name of ['model','history','bonding','io','periodic'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name+'.js'),'utf8'),c);return c.window.MoleculeVisualizer;}
test('bulk selection validates IDs in linear work and preserves explicit selection order',()=>{
 const {Model:M}=load(),n=5000;let reads=0;
 const atoms=Array.from({length:n},(_,i)=>({get id(){reads++;return 'a'+i;}})),s={atoms};
 const ids=Array.from({length:n},(_,i)=>'a'+(n-i-1));M.setSelectedAtoms(s,[...ids,'missing',ids[0]]);
 assert.deepEqual([...s.selectedAtomIds],ids);assert.ok(reads<=n*2,`atom ID reads: ${reads}`);
});
test('undo shares frozen trajectory frames while edits, cells and navigation remain isolated',()=>{
 const M=load(),frame=M.Periodic.snapshot(M.Model.createState({atoms:[{id:'a',element:'C',x:1,y:2,z:3}],metadata:{cell:{vectors:[[5,0,0],[0,5,0],[0,0,5]],pbc:[true,true,true]}}}));
 const state=M.Model.createState(frame);state.metadata.trajectory=[frame,JSON.parse(JSON.stringify(frame))];state.metadata.frameIndex=0;
 const history=new M.History();history.push('original',state);history.push('second',state);
 const a=history.undoStack[0].state,b=history.undoStack[1].state;
 assert.equal(a.metadata.trajectory[1],b.metadata.trajectory[1]);assert.notEqual(a.metadata.trajectory,b.metadata.trajectory);
 assert.ok(Object.isFrozen(a.metadata.trajectory[1].atoms[0]));
 const next=M.Model.cloneEditableState(state);next.atoms[0].x=8;next.metadata.cell.vectors[0][0]=9;next.metadata.trajectory[0]=M.Periodic.snapshot(next);
 assert.equal(a.atoms[0].x,1);assert.equal(a.metadata.cell.vectors[0][0],5);assert.equal(a.metadata.trajectory[0].atoms[0].x,1);
 const selected=M.Model.createState(next.metadata.trajectory[1]);selected.metadata.cell.vectors[0][0]=12;
 assert.equal(next.metadata.trajectory[1].metadata.cell.vectors[0][0],5);
 const restored=history.undo(next);assert.equal(restored.atoms[0].x,1);assert.equal(history.redo(restored).atoms[0].x,8);
 const deep=M.Model.cloneState(state);deep.metadata.trajectory[1].atoms[0].x=55;assert.equal(state.metadata.trajectory[1].atoms[0].x,1);
});
test('single-frame snapshots do not traverse a discarded trajectory',()=>{
 const M=load(),state=M.Model.createState({atoms:[{element:'H'}]});
 state.metadata.trajectory={toJSON(){throw Error('must not traverse trajectory');}};
 assert.equal(M.Periodic.snapshot(state).atoms.length,1);
});
