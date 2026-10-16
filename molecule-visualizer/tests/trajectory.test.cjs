const test=require('node:test'),assert=require('node:assert/strict'),T=require('../trajectory.js');
const frames=xs=>xs.map(x=>[[x,0,0]]);
test('NODE filenames use a safe editable name followed by _infile.log',()=>{
 assert.equal(T.lupFilename('Water'),'Water_infile.log');assert.equal(T.lupFilename(' 水の反応経路 '),'水の反応経路_infile.log');
 assert.equal(T.lupFilename('a/b\\c:d*e?f"g<h>i|j\nk'),'a_b_c_d_e_f_g_h_i_j_k_infile.log');
 for(const name of [undefined,'','  ','..'])assert.equal(T.lupFilename(name),'molecule_infile.log');
 assert.equal(T.lupFilename('sample. '),'sample_infile.log');assert.equal(T.lupFilename('水'.repeat(100)),'水'.repeat(60)+'_infile.log');
 assert.ok(Buffer.byteLength(T.lupFilename('🌊'.repeat(100)))<=255);
});
test('GRRM LUP infile has sequential zero-based NODE blocks with only coordinates and separators',()=>{
 const source={kind:'neb',symbols:['O','H','H'],images:[0,.1,.2].map(x=>[[x,0,0],[.9572,0,0],[-.239987,.926627,0]]),energies:[-3,-2,-1],biasEnergies:[1,2,3],cell:{vectors:[[9,0,0],[0,9,0],[0,0,9]],pbc:[true,true,true]}};
 const before=JSON.stringify(source),text=T.lup(source,[0,2]);
 assert.equal(text,'# NODE 0\nO 0.000000000000 0.000000000000 0.000000000000\nH 0.957200000000 0.000000000000 0.000000000000\nH -0.239987000000 0.926627000000 0.000000000000\n--\n# NODE 1\nO 0.200000000000 0.000000000000 0.000000000000\nH 0.957200000000 0.000000000000 0.000000000000\nH -0.239987000000 0.926627000000 0.000000000000\n');
 assert.equal(T.lup(source,[0,1,2]).split('\n--\n').length,3);
 assert.equal(T.lup(source,[1]).split('\n--\n').length,1);assert.match(T.lup(source,[1]),/^# NODE 0\nO 0.100000000000/);
 assert.equal(JSON.stringify(source),before);
 for(const ids of [[0,0],[2,1],[-1],[3],[.5],[]])assert.throws(()=>T.lup(source,ids));
 assert.throws(()=>T.lup({...source,images:[[[NaN,0,0]]]},[0]));
});
test('index and displacement sampling select distinct original frames and retain exact endpoints',()=>{
 const images=frames([0,.1,.2,.3,1,2,3,4,6,8,10]),before=JSON.stringify(images);
 assert.deepEqual(T.indices(images,6,'index'),[0,2,4,6,8,10]);
 assert.deepEqual(T.indices(images,6,'distance'),[0,5,7,8,9,10]);
 assert.deepEqual(T.indices(images,2,'distance'),[0,10]);assert.equal(JSON.stringify(images),before);
 const arc=T.distances([[[0,0,0],[0,0,0]],[[3,0,0],[0,4,0]]]);assert.ok(Math.abs(arc[1]-Math.sqrt(12.5))<1e-12);
});
test('sampling handles plateaus, zero movement, one-frame results and the complete 10001-frame history',()=>{
 const flat=frames(Array(64).fill(2)),jump=frames([...Array(40).fill(0),...Array(24).fill(100)]);
 for(let n=2;n<=64;n++){
   assert.deepEqual(T.indices(flat,n,'distance'),T.indices(flat,n,'index'));
   const chosen=T.indices(jump,n,'distance');assert.equal(chosen.length,n);assert.equal(chosen[0],0);assert.equal(chosen.at(-1),63);
   assert.ok(chosen.every((x,i)=>!i||x>chosen[i-1]));
 }
 assert.deepEqual(T.indices(frames([0]),1,'distance'),[0]);
 const all=T.indices(frames(Array.from({length:10001},(_,i)=>i/10000)),10001,'distance');assert.ok(all.every((x,i)=>x===i));
 for(const n of [0,1,65,2.5,NaN])assert.throws(()=>T.indices(flat,n,'index'));
 assert.throws(()=>T.indices(flat,3,'unknown'));
});
test('XYZ has one complete block per chosen frame, preserves atom order and separates physical and biased energies',()=>{
 const source={kind:'afir',symbols:['O','H'],images:[[[0,0,0],[1,0,0]],[[.25,0,0],[1.25,0,0]],[[.5,0,0],[1.5,0,0]]],energies:[-3,-2,-1],biasEnergies:[1,2,3]};
 const before=JSON.stringify(source),text=T.xyz(source,[0,2],'distance'),lines=text.trimEnd().split('\n');assert.equal(lines.length,8);
 for(const [block,i] of [[0,0],[1,2]]){
   const rows=lines.slice(block*4,block*4+4);assert.equal(rows[0],'2');assert.match(rows[1],new RegExp(`source_frame=${i+1}/3`));assert.match(rows[1],new RegExp(`step=${i}`));
   assert.match(rows[1],/energy_eV=/);assert.match(rows[1],/bias_eV=/);assert.match(rows[1],/biased_energy_eV=/);
   rows.slice(2).forEach((row,a)=>{const [symbol,...p]=row.split(/\s+/);assert.equal(symbol,source.symbols[a]);assert.deepEqual(p.map(Number),source.images[i][a]);});
 }
 assert.equal(JSON.stringify(source),before);
 const cell={vectors:[[5,0,0],[1,5,0],[0,0,6]],pbc:[true,true,false]};
 assert.match(T.xyz({...source,cell},[0]),/Lattice="5 0 0 1 5 0 0 0 6" pbc="T T F"/);
 assert.match(T.xyz({kind:'optimize',symbols:['H'],images:frames([2]),energies:[1],stepNumbers:[150]},[0]),/step=150 /);
 for(const ids of [[0,0],[2,1],[3],[]])assert.throws(()=>T.xyz(source,ids));
 assert.throws(()=>T.xyz({...source,images:[[[NaN,0,0]]]},[0]));
});
