const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function boot(){const ctx={window:{}};vm.createContext(ctx);for(const f of ['model','bonding','geometry','io','molfile','periodic','formats','fragment-clipboard'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);return ctx.window.MoleculeVisualizer;}
const plain=x=>JSON.parse(JSON.stringify(x));
test('fragment copy retains internal chemistry, allocates IDs, preserves host and excludes constraints/results',()=>{
 const {Model:M,FragmentClipboard:C,IO}=boot();
 const s=M.createState({atoms:[{id:'a70',element:'C',x:0,charge:-1,mol:{props:{MASS:'13',RAD:'2'},map:7},selective:[false,false,false],xyzExtras:{force:[1,2,3]}},{id:'a71',element:'O',x:1.2},{id:'a72',element:'H',y:1}],bonds:[{id:'b50',atom1:'a70',atom2:'a71',order:2},{id:'b51',atom1:'a70',atom2:'a72',order:1}],selectedAtomIds:['a70','a71'],metadata:{constraints:{enabled:true,fixedAtomIds:['a70']},afir:{fragments:[{atomIds:['a70']}]},externalCalculation:{energyEV:12},stereoGroups:[{type:'MDLV30/STEREL1',atomIds:['a70']}],cell:{vectors:[[10,0,0],[0,10,0],[0,0,10]],pbc:[true,true,true]}}});
 const before=IO.stateToProjectText(s),f=C.extract(s),copied=IO.stateToMolV3000Text(f),parsed=C.parse(copied),next=C.append(s,f);
 assert.equal(f.atoms.length,2);assert.equal(f.bonds.length,1);assert.equal(f.metadata.cell,undefined);assert.equal(f.metadata.constraints,undefined);assert.equal(f.atoms[0].xyzExtras,undefined);assert.equal(f.atoms[0].selective,undefined);
 assert.equal(parsed.atoms[0].charge,-1);assert.equal(parsed.atoms[0].mol.props.MASS,'13');assert.equal(parsed.bonds[0].order,2);
 assert.equal(next.atoms.length,5);assert.equal(next.bonds.length,3);assert.deepEqual(plain(next.atoms.slice(0,3)),plain(s.atoms));assert.deepEqual(plain(next.bonds.slice(0,2)),plain(s.bonds));
 assert.equal(new Set(next.atoms.map(a=>a.id)).size,5);assert.equal(new Set(next.bonds.map(b=>b.id)).size,3);assert.deepEqual([...next.selectedAtomIds],next.atoms.slice(3).map(a=>a.id));
 assert.ok(Math.abs(next.atoms[4].x-next.atoms[3].x-1.2)<1e-12);assert.equal(next.atoms[3].x,3.7);assert.equal(next.atoms[3].mol.map,0);
 assert.deepEqual(plain(next.metadata.constraints),plain(s.metadata.constraints));assert.deepEqual(plain(next.metadata.afir),plain(s.metadata.afir));assert.equal(next.metadata.externalCalculation,undefined);
 assert.equal(next.metadata.stereoGroups[1].type,'MDLV30/STEREL2');assert.equal(next.metadata.stereoGroups[1].atomIds[0],next.atoms[3].id);assert.equal(IO.stateToProjectText(s),before);
 const empty=C.append(M.createState(),f);assert.equal(empty.atoms[1].x,1.2);assert.equal(empty.metadata.constraints,undefined);assert.equal(empty.metadata.afir,undefined);
 const repeated=C.append(next,f);assert.ok(repeated.atoms[5].x>next.atoms[4].x);assert.equal(repeated.bonds.length,4);
});
test('clipboard accepts one MOL/XYZ, keeps XYZ inference inside fragment, rejects invalid and multi-frame input',()=>{
 const {FragmentClipboard:C,Model:M}=boot(),f=C.parse('C 0 0 0\nO 1.2 0 0');assert.equal(f.atoms.length,2);assert.equal(f.bonds.length,1);
 assert.throws(()=>C.parse(''),/クリップボード/);assert.throws(()=>C.parse('not a molecule'));assert.throws(()=>C.parse('C NaN 0 0'));assert.throws(()=>C.parse('1\na\nHe 0 0 0\n1\nb\nHe 1 0 0'),/1構造/);
 assert.throws(()=>C.extract(M.createState()),/選択/);
 const host=M.createState({atoms:[{element:'C',x:0},{element:'C',x:1.4}]});const next=C.append(host,f);assert.equal(next.bonds.length,1);assert.ok(next.bonds.every(b=>next.selectedAtomIds.has(b.atom1)&&next.selectedAtomIds.has(b.atom2)));
 assert.throws(()=>C.append(M.createState({atoms:Array.from({length:2000},()=>({element:'H'}))}),f),/2,000/);
});
