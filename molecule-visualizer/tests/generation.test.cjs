const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={window:{}};vm.createContext(ctx);for(const f of ['model','bonding','geometry','io','molfile','periodic','formats','ring-conformers','generation'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);
const {IO,Model:M,Periodic:P,Generation:G,Formats:F}=ctx.window.MoleculeVisualizer;
const xyz=s=>s.atoms.map(a=>[a.x,a.y,a.z]),near=(x,y,t=1e-8)=>assert.ok(Math.abs(x-y)<t,`${x} != ${y}`);
const cif=`data_test
_cell_length_a 5.0(2)
_cell_length_b 6
_cell_length_c 7
_cell_angle_alpha 90
_cell_angle_beta 100
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P -1'
loop_
_space_group_symop_id
_space_group_symop_operation_xyz
1 'x,y,z'
2 '-x,-y,-z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
C1 C .1 .2 .3 1
O1 O 0 0 0 1
`;
test('CIF reads uncertainty, oblique cell and symmetry, removes special-position duplicates and retains partial occupancy',()=>{
 const s=F.parse(cif);assert.equal(s.atoms.length,3);assert.ok(s.metadata.cell);near(P.fractional(xyz(s)[0],s.metadata.cell)[0],.1);near(P.fractional(xyz(s)[1],s.metadata.cell)[0],.9);assert.equal(s.atoms[2].element,'O');assert.equal(F.parse(cif.replace('O1 O','D1 D')).atoms[2].mol.props.MASS,'2');
 const partial=F.parse(cif.replace('.3 1','.3 0.5'));assert.equal(partial.atoms[0].xyzExtras.occupancy.values[0],'0.5');assert.match(partial.metadata.importWarnings[0],/部分占有/);
 assert.throws(()=>F.parse(cif.replace(/loop_\n_space_group_symop_id[\s\S]*?'\-x,-y,-z'\n/,'')),/対称操作/);assert.throws(()=>F.parse(cif.replace("'-x,-y,-z'","'alert(1),y,z'")),/対称操作/);
 assert.equal(F.parse(cif+'\n'+cif.replace('data_test','data_second')).metadata.trajectory.length,2);
});
test('SDF multiple records retain bonds and properties including an empty title; MOL2 has explicit orders and partial charges',()=>{
 const a=IO.parseXYZToState('C 0 0 0\nO 1.3 0 0');a.metadata.title='';a.metadata.sdfProperties='> <sample>\nfirst';a.bonds[0].order=2;a.bonds[0].source='manual';
 const text=IO.stateToSDFText(a),s=F.parse(text+text);assert.equal(s.metadata.trajectory.length,2);assert.equal(s.metadata.trajectory[1].bonds[0].order,2);assert.match(s.metadata.trajectory[1].metadata.sdfProperties,/first/);
 const mol2='@<TRIPOS>MOLECULE\ncarbonyl\n2 1 0 0 0\nSMALL\nUSER_CHARGES\n@<TRIPOS>ATOM\n10 C1 0 0 0 C.2 1 MOL 0.4\n20 O1 1.2 0 0 O.2 1 MOL -0.4\n@<TRIPOS>BOND\n1 10 20 2\n';const m=F.parse(mol2);assert.equal(m.bonds[0].order,2);assert.equal(m.atoms[1].xyzExtras.partial_charge.values[0],'-0.4');assert.equal(m.atoms[1].charge,0);
});
test('PDB model coordinates use fixed columns; Gaussian and ORCA read Cartesian units and charge/multiplicity',()=>{
 const line=(id,e,x)=>'HETATM'+String(id).padStart(5)+' '+(' '+e).padEnd(4)+' MOL A   1    '+x.toFixed(3).padStart(8)+'   0.000   0.000  1.00  0.00          '+e.padStart(2)+'  ';
 const pdb='MODEL        1\n'+line(1,'C',0)+'\n'+line(2,'O',1.2)+'\nENDMDL\nMODEL        2\n'+line(1,'C',1)+'\n'+line(2,'O',2.2)+'\nENDMDL\nCONECT    1    2\n';const p=F.parse(pdb);assert.equal(p.atoms[1].element,'O');near(p.atoms[1].x,1.2);assert.equal(p.metadata.trajectory.length,2);
 const g=F.parse('%mem=1GB\n#p hf/sto-3g units=bohr\n\nH2\n\n0 1\nH 0 0 0\nH 2 0 0\n\n');near(g.atoms[1].x,1.058354421806);assert.equal(g.metadata.multiplicity,1);
 const o=F.parse('! B3LYP def2-SVP\n* xyz -1 2\nO 0 0 0\nH .96 0 0\n*\n');assert.equal(o.metadata.totalCharge,-1);assert.equal(o.metadata.multiplicity,2);
 assert.throws(()=>F.parse('! HF\n* xyzfile 0 1 file.xyz','orca'),/xyzfile/);
});
test('seeded torsions preserve bond lengths and order; orientation is rigid, periodic cell rotates with atoms; limit is enforced',()=>{
 const s=IO.parseXYZToState('C 0 0 0\nC 1.5 0 0\nC 2.1 1.3 0\nC 3.5 1.6 0.5');s.bonds=[];for(let i=0;i<3;i++)M.addOrUpdateBond(s,s.atoms[i].id,s.atoms[i+1].id,1,'covalent','manual');
 const before=JSON.stringify(s),r=G.randomStructures(s,{count:5,seed:42,mode:'torsion'}),again=G.randomStructures(s,{count:5,seed:42,mode:'torsion'});assert.equal(r.state.metadata.trajectory.length,5);assert.equal(JSON.stringify(r.state),JSON.stringify(again.state));assert.equal(JSON.stringify(s),before);
 for(const f of r.state.metadata.trajectory)for(let i=0;i<3;i++)near(Math.hypot(...xyz(f)[i].map((v,j)=>v-xyz(f)[i+1][j])),Math.hypot(...xyz(s)[i].map((v,j)=>v-xyz(s)[i+1][j])));
 const orient=G.randomStructures(s,{count:20,mode:'orientation',seed:22});assert.equal(orient.state.metadata.trajectory.length,20);for(const f of orient.state.metadata.trajectory)for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)near(Math.hypot(...xyz(f)[i].map((v,k)=>v-xyz(f)[j][k])),Math.hypot(...xyz(s)[i].map((v,k)=>v-xyz(s)[j][k])));
 s.metadata.cell=P.cell([[10,0,0],[1,10,0],[0,0,10]]);const periodic=G.randomStructures(s,{count:1,mode:'orientation',seed:8}).state;P.fractional(xyz(periodic)[2],periodic.metadata.cell).forEach((v,i)=>near(v,P.fractional(xyz(s)[2],s.metadata.cell)[i]));assert.throws(()=>G.randomStructures(s,{count:21,mode:'orientation'}),/20/);assert.throws(()=>G.randomStructures(s,{count:5,mode:'torsion'}),/周期/);
});
test('paths preserve exact endpoints and file order, validate mismatches, relieve linear collisions and support fixed-cell shortest images',()=>{
 const a=IO.parseXYZToState('C -1 0 0\nC 1 0 0'),b=IO.parseXYZToState('C 1 0 0\nC -1 0 0'),before=JSON.stringify([a,b]);
 const line=G.path(a,b,{count:5,method:'linear'}).state.metadata.trajectory;near(line[2].atoms[0].x,0);
 const r=G.path(a,b,{count:5,method:'distance',seed:42}).state.metadata.trajectory;assert.equal(JSON.stringify(xyz(r[0])),JSON.stringify(xyz(a)));assert.equal(JSON.stringify(xyz(r.at(-1))),JSON.stringify(xyz(b)));assert.ok(Math.hypot(...xyz(r[2])[0].map((v,i)=>v-xyz(r[2])[1][i]))>1.5);assert.equal(JSON.stringify([a,b]),before);
 b.atoms[0].element='N';assert.throws(()=>G.path(a,b,{count:5}),/File-order 1/);b.atoms[0].element='C';b.atoms.pop();assert.throws(()=>G.path(a,b,{count:5}),/原子数/);
 const p=IO.parseXYZToState('C .1 0 0\nTV 10 0 0\nTV 0 10 0\nTV 0 0 10'),q=IO.parseXYZToState('C 9.9 0 0\nTV 10 0 0\nTV 0 10 0\nTV 0 0 10');const short=G.path(p,q,{count:3,method:'linear',minimumImage:true}).state.metadata.trajectory;near(short[1].atoms[0].x,0);near(short[2].atoms[0].x,-.1);assert.equal(JSON.stringify(short[1].metadata.cell),JSON.stringify(p.metadata.cell));q.metadata.cell.vectors[0][0]=11;assert.throws(()=>G.path(p,q,{count:3}),/同じ格子/);
});
test('initial path smoothing projects the entire 3N gradient and records zero tangential updates',()=>{
 const a=IO.parseXYZToState('C -1 0 0\nC 1 0 0'),b=IO.parseXYZToState('C 1 0 0\nC -1 0 0');
 const r=G.path(a,b,{count:7,method:'distance',seed:42}).state;
 assert.equal(r.metadata.generation.relaxation,'perpendicular');assert.ok(r.metadata.generation.maxTangentialStep<1e-12);
 const images=[[[0,0,0],[0,0,0]],[[1,2,3],[4,5,6]],[[2,4,6],[8,10,12]]],tau=G.tangent(images,1),force=[[3,-.4,1],[7,.6,-4]],projected=G.perpendicular(force,tau).flat();
 near(projected.reduce((s,v,i)=>s+v*tau[i],0),0);assert.ok(Math.abs(projected.slice(0,3).reduce((s,v,i)=>s+v*tau[i],0))>.01,'projection must be in 3N space, not per atom');
 const p=IO.parseXYZToState('H 0 0 0\nH 1 0 0\nTV 8 0 0\nTV 1 8 0\nTV 0 0 8'),q=M.cloneState(p);q.atoms[1].x=2;
 const periodic=G.path(p,q,{count:5,method:'distance'}).state;assert.ok(periodic.metadata.generation.maxTangentialStep<1e-12);assert.equal(JSON.stringify(periodic.metadata.trajectory[0].metadata.cell),JSON.stringify(p.metadata.cell));
});
