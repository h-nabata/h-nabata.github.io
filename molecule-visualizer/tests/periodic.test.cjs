const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context={window:{},console};vm.createContext(context);for(const file of ['model','bonding','geometry','io','molfile','periodic','history'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file+'.js'),'utf8'),context);
const {IO,Periodic:P,Model:M}=context.window.MoleculeVisualizer;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('triclinic fractional conversion and exact minimum image',()=>{const c=P.cell([[4,0,0],[3.9,.8,0],[.5,.3,6]]),f=[.73,-.4,1.1];P.fractional(P.cartesian(f,c),c).forEach((x,i)=>close(x,f[i]));const delta=[3,2.1,-3.4];let best=Infinity;for(let i=-8;i<=8;i++)for(let j=-8;j<=8;j++)for(let k=-8;k<=8;k++){const n=P.cartesian([i,j,k],c);best=Math.min(best,Math.hypot(...delta.map((x,q)=>x-n[q])));}close(P.minimumImage(delta,c).distance,best);assert.throws(()=>P.cell([[1,0,0],[2,0,0],[0,0,1]]));});
test('extended XYZ retains skew cell, partial PBC, extra columns and trajectory',()=>{const text='2\nstep=1 Lattice="4 0 0 1 5 0 0 0 6" pbc="T T F" Properties=species:S:1:pos:R:3:force:R:3\nC .1 .2 .3 1 2 3\nO 3.1 .2 .3 4 5 6\n';const s=IO.parseXYZToState(text+text.replace('step=1','step=2'));assert.equal(s.metadata.trajectory.length,2);const copy=IO.parseXYZToState(IO.stateToXYZText(s));assert.equal(copy.metadata.cell.pbc[2],false);assert.equal(copy.atoms[1].xyzExtras.force.values[2],'6');close(copy.metadata.cell.vectors[1][0],1);assert.equal(s.bonds.length,1);const deep=M.cloneState(s);deep.metadata.cell.vectors[0][0]=99;assert.equal(s.metadata.cell.vectors[0][0],4);assert.throws(()=>IO.stateToMolText(s));const restored=IO.parseProject(IO.stateToProjectText(s));assert.equal(restored.metadata.trajectory.length,2);});
test('POSCAR direct and negative-volume Cartesian scaling round trip with constraints',()=>{const text='test\n-125\n1 0 0\n0 1 0\n0 0 1\nC O\n1 1\nSelective dynamics\nCartesian\n0 0 0 T F T\n.5 .5 .5 F F F\n';const s=P.parsePOSCAR(text);close(s.metadata.cell.vectors[0][0],5);close(s.atoms[1].x,2.5);const copy=P.parsePOSCAR(P.toPOSCAR(s));assert.equal(copy.atoms[0].selective[1],'F');close(copy.atoms[1].x,2.5);assert.throws(()=>P.parsePOSCAR(text+'velocity\n'));});
test('wrapping and supercell preserve fractional positions and scale cell',()=>{const s=IO.parseXYZToState('1\nLattice="3 0 0 1 4 0 0 0 5"\nC 4.5 -2 6\n');P.wrap(s);P.fractional(P.xyz(s.atoms[0]),s.metadata.cell).forEach(x=>assert.ok(x>=0&&x<1));const sc=P.supercell(s,[2,3,1]);assert.equal(sc.atoms.length,6);close(sc.metadata.cell.vectors[0][0],6);close(sc.metadata.cell.vectors[1][1],12);assert.equal(new Set(sc.atoms.map(a=>a.id)).size,6);assert.throws(()=>P.supercell(s,[0,2,2]));});
test('XYZ accepts Unicode spaces and newline variants with or without headers',()=>{
 for(const newline of ['\n','\r','\r\n','\u0085','\u2028','\u2029'])for(const space of [' ','\t','\u3000','\u00a0','\u2009']){
  const body=['O 0 0 0','H .95 0 0','H -.24 .92 0'].map(l=>l.replaceAll(' ',space)).join(newline+newline);
  for(const prefix of ['',`3${newline}${newline}`]){const s=IO.parseXYZToState('\uFEFF'+prefix+body+newline);assert.equal(s.atoms.length,3);close(s.atoms[2].y,.92);}
 }
 assert.throws(()=>IO.parseXYZToState('2\n\nH 0 0 0'));
});
test('TV editor round trip with both header counts, Unicode whitespace, and triangular rotation',()=>{
 const body='C 1 2 3\nO 2 2 3\nTV 4 0 0\nTV 1 5 0\nTV 2 3 6\n';
 for(const prefix of ['', '2\ncell\n','5\ncell\n']){const s=IO.parseXYZToState(prefix+body.replaceAll(' ','\u3000'));assert.equal(s.atoms.length,2);close(s.metadata.cell.vectors[2][1],3);for(const h of [true,false]){const text=P.editorText(s,h);assert.equal((text.match(/^TV /gm)||[]).length,3);const t=IO.parseXYZToState(text);assert.equal(t.atoms.length,2);close(t.metadata.cell.vectors[1][0],1);}}
 assert.throws(()=>IO.parseXYZToState('C 0 0 0\nTV 1 0 0\nTV 0 1 0'));
 assert.throws(()=>IO.parseXYZToState('2\n\nC 0 0 0'));
 const s=IO.parseXYZToState('2\nLattice="0 4 0 -5 1 0 2 3 6"\nC 1 2 3\nO 2 4 3\n'),before=P.fractional(P.xyz(s.atoms[0]),s.metadata.cell),d=Math.hypot(...P.xyz(s.atoms[0]).map((x,i)=>x-P.xyz(s.atoms[1])[i]));
 P.lowerTriangular(s);const v=s.metadata.cell.vectors;close(v[0][1],0);close(v[0][2],0);close(v[1][2],0);P.fractional(P.xyz(s.atoms[0]),s.metadata.cell).forEach((x,i)=>close(x,before[i]));close(Math.hypot(...P.xyz(s.atoms[0]).map((x,i)=>x-P.xyz(s.atoms[1])[i])),d);
});
