const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context={window:{},console};vm.createContext(context);
for(const file of ['model','bonding','geometry','io','molfile','periodic','batch'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file+'.js'),'utf8'),context);
const {Batch:B,IO,Model:M,Periodic:P}=context.window.MoleculeVisualizer,plain=x=>JSON.parse(JSON.stringify(x));
const water='O 0 0 0\nH .95 0 0\nH -.24 .92 0',other=water.replace('.95','1.1');
test('batch parses headered XYZ, blank comments, Unicode, headerless groups, NODE and fixed atom counts',()=>{
 for(const text of ['3\nfirst\n'+water+'\n3\n\n'+other,water+'\n\n'+other,water+'\n--\n'+other,'# NODE 0\n'+water+'\n--\n# NODE 1\n'+other]){
  const frames=B.parse(text.replaceAll(' ','\u3000').replaceAll('\n','\r\n'));assert.equal(frames.length,2);assert.equal(frames[1].atoms[1].x,1.1);
  assert.deepEqual(plain(frames[1].atoms.map(a=>a.id)),plain(frames[0].atoms.map(a=>a.id)));
  assert.ok(frames.every(f=>f.bonds.every(b=>f.atoms.some(a=>a.id===b.atom1)&&f.atoms.some(a=>a.id===b.atom2))));
 }
 assert.equal(B.parse(water+'\n'+other,3).length,2);
 assert.equal(B.parse('3\n\n'+water+'\n--\n'+other).length,2);
 assert.equal(B.parse(water+'\n'+other).length,1,'unseparated atoms are not heuristically divided');
});
test('batch rejects malformed frames, mixed composition/order, mismatched cells and oversized collections',()=>{
 for(const text of ['', '3\ncomment\nO 0 0 0',water+'\n\nH 0 0 0',water+'\n\n'+other.replace('O 0','C 0'),water+'\n\nH 0 0 0\nO 1 0 0\nH 0 1 0',water.replace('.95','NaN'),water.replace('.95','10001')])assert.throws(()=>B.parse(text));
 assert.throws(()=>B.parse(water+'\n'+other,4));assert.throws(()=>B.parse(water,-1));assert.throws(()=>B.parse(Array(101).fill(water).join('\n\n')));
 const periodic='3\nLattice="5 0 0 0 5 0 0 0 5" pbc="T T F"\n'+water;
 assert.equal(B.parse(periodic+'\n'+periodic)[0].metadata.cell.pbc[2],false);
 assert.throws(()=>B.parse(periodic+'\n3\n\n'+water));
 const s=IO.parseXYZToState(water),before=JSON.stringify(s);B.normalize([s,M.cloneState(s)]);assert.equal(JSON.stringify(s),before);
});
test('minimum and CSV exclude failed/cancelled partial energies, retain unconverged results and escape names',()=>{
 const entries=[['converged',-2],['step_limit',-3],['failed',-99],['cancelled',-100],['not_run',null]].map(([status,energy],i)=>({status,frame:{metadata:{title:i?'line,"quoted"':'=1+1'}},result:energy===null?undefined:{energies:[energy],steps:4,effectiveFmax:.1}}));
 assert.equal(B.minimum(entries),-3);assert.equal(entries.filter(B.completed).length,2);
 const csv=B.csv(entries);assert.match(csv,/"'\=1\+1"/);assert.match(csv,/line,""quoted""/);assert.match(csv,/"1","96.4853321233"/);assert.match(csv,/"failed","-99","",""/);
 assert.equal(B.minimum([]),null);
});
test('batch queue is sequential, starts independent inputs and continues after a confirmed per-structure error',async()=>{
 const entries=[0,1,2].map(i=>({status:'waiting',input:i})),seen=[];let concurrent=0;
 await B.run(entries,async(e,i)=>{assert.equal(++concurrent,1);seen.push([e.input,i]);await Promise.resolve();--concurrent;return {status:i===1?'failed':'converged'};},()=>false,()=>{});
 assert.deepEqual(seen,[[0,0],[1,1],[2,2]]);assert.deepEqual(entries.map(e=>e.status),['converged','failed','converged']);
});
test('cancel prevents remaining jobs and unknown transport failures never advance the queue',async()=>{
 let cancelled=false,calls=0;const entries=[0,1,2].map(()=>({status:'waiting'}));
 await B.run(entries,async()=>{calls++;cancelled=true;return {status:'cancelled'};},()=>cancelled,()=>{});
 assert.equal(calls,1);assert.deepEqual(entries.map(e=>e.status),['cancelled','not_run','not_run']);
 const next=[0,1].map(()=>({status:'waiting'}));calls=0;
 await assert.rejects(()=>B.run(next,async()=>{calls++;throw Error('connection lost');},()=>false,()=>{}),/connection lost/);
 assert.equal(calls,1);assert.equal(next[0].status,'unknown');assert.equal(next[1].status,'waiting');
});
