const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./import-fixtures.cjs');
const ctx={window:{},console,TextDecoder,Uint8Array};vm.createContext(ctx);
for(const name of ['model','bonding','geometry','io','molfile','periodic','formats','structure-import'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name+'.js'),'utf8'),ctx,{filename:name+'.js'});
const {Formats:F,IO,Model:M}=ctx.window.MoleculeVisualizer;
const parse=(s,f='auto',name='')=>F.parse(s,f,{filename:name}),plain=x=>JSON.parse(JSON.stringify(x)),close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,a+' != '+b),frames=s=>s.metadata.trajectory||[s];
const file=(name,text)=>({name,size:Buffer.byteLength(text),arrayBuffer:async()=>Uint8Array.from(Buffer.from(text)).buffer});
test('GRRM direct COM: two endpoints, one shared frozen block, options excluded',()=>{
 const s=parse(fixture.grrm,'auto','reaction.com'),f=frames(s);assert.equal(s.metadata.sourceFormat,'grrm');assert.equal(f.length,2);
 for(const x of f){assert.equal(x.atoms.length,3);assert.deepEqual(plain(x.atoms.map(a=>a.element)),['H','H','He']);assert.equal(x.metadata.totalCharge,0);assert.equal(x.metadata.multiplicity,1);assert.deepEqual(plain(x.metadata.constraints.fixedAtomIds),[x.atoms[2].id]);}
 assert.deepEqual(plain(f[0].atoms.map(a=>a.id)),plain(f[1].atoms.map(a=>a.id)));close(f[1].atoms[1].z,1.4);
 assert.match(s.metadata.importWarnings.join(' '),/ReadCommonGeometry/);assert.equal(s.metadata.sourceFile,'reaction.com');
 assert.ok(f[0].bonds.every(b=>f[0].atoms.some(a=>a.id===b.atom1)&&f[0].atoms.some(a=>a.id===b.atom2)));
});
test('GRRM single, Product, External Atoms, multi electronic states and no blank before Options',()=>{
 let s=parse('# SC-AFIR/x\n0 1 0 3\nC 0 0 0\nExternal Atoms\nH 0 0 1.1\nProduct\nC 0 0 0\nH 0 0 1.4\nOptions\nC 99 99 99\n');
 assert.equal(frames(s).length,2);assert.equal(s.atoms.length,2);assert.deepEqual(plain(s.metadata.importElectronicStates),[[0,1],[0,3]]);assert.deepEqual(plain(s.metadata.grrmExternalAtoms),[1]);
 s=parse('%infile=path.log\n# LUP/x\n\n0 1\nH 0 0 0\nOptions\n');assert.equal(s.atoms.length,1);assert.match(s.metadata.importWarnings.join(' '),/%infile/);
});
test('GRRM accepts D exponents, numeric elements, TV and concatenated inputs',()=>{
 const t='# OPT/x\n\n0 1\n1 1D+0 0 0\nTV 5 0 0\nTV 0 5 0\nTV 0 0 5\nOptions\n';
 const s=parse(t+t);assert.equal(frames(s).length,2);close(s.atoms[0].x,1);close(s.metadata.cell.vectors[0][0],5);
});
test('malformed GRRM blocks never return partial structures',()=>{
 for(const t of [fixture.grrm.replace('H 0 0 1.4','H 0 NaN 1.4'),fixture.grrm.replace('0 1','0 0'),'# OPT/x\n0 1\nC\nOptions',fixture.grrm.replace('He 5 0 0','He 5 0')])assert.throws(()=>parse(t));
});
test('Gaussian .com identified separately; Link1, Bohr, frozen and isotope metadata',()=>{
 const t=fixture.gaussian.replace('HF/STO-3G','HF/STO-3G Units=Bohr').replace('H 0 0 .74','D -1 0 0 2');
 const s=parse(t+'\n--Link1--\n'+t,'auto','job.com');assert.equal(s.metadata.sourceFormat,'gaussian');assert.equal(frames(s).length,2);close(s.atoms[1].z,2*.529177210903);assert.equal(s.atoms[1].mol.props.MASS,'2');assert.equal(s.metadata.constraints.fixedAtomIds[0],s.atoms[1].id);
 assert.throws(()=>parse('# HF Geom=AllCheck\n\n'),/FCHK/);
 assert.throws(()=>parse(fixture.gaussian.replace('H 0 0 .74','H 1 R1')),/Cartesian/);
});
test('ORCA Cartesian, multiple jobs and percent coords Bohr',()=>{
 assert.equal(frames(parse(fixture.orca+'$new_job\n'+fixture.orca)).length,2);
 const s=parse('%coords\n CTyp xyz\n Charge -1\n Mult 2\n Units Bohrs\n coords\n H 0 0 2\n end\nend');
 close(s.atoms[0].z,1.058354421806);assert.equal(s.metadata.totalCharge,-1);
 assert.throws(()=>parse('* xyzfile 0 1 missing.xyz'),/一緒に/);assert.throws(()=>parse('* xyzfile 0 1\n'),/内部座標/);
});
test('GRRM logs extract only marked coordinates, not energy or gradient tables',()=>{
 const s=parse('# Geometry of EQ 0, SYMMETRY = C1\nH 0 0 0\nH 0 0 .74\nEnergy = -1\nH 99 99 99\n# Geometry of TS 0\nH 0 0 0\nH 0 0 1.4\nENERGY = -0.5\n','auto','job_EQ_list.log');
 assert.equal(frames(s).length,2);assert.equal(s.atoms.length,2);close(frames(s)[1].atoms[1].z,1.4);
 assert.throws(()=>parse('# Geometry of EQ 0\nH 0 0 0\nX 1 0 0\nEnergy = 0'),/元素/);
 const p=parse('# NODE 0\nH 0 0 0\nENERGY = -1\n# NODE 1\nH 0 0 1\nENERGY = -1\n');assert.equal(frames(p).length,2);
});
test('Gaussian log uses Standard once, keeps frames and omits incomplete final table with warning',()=>{
 const t='Charge = 0 Multiplicity = 1\n'+fixture.gtable()+fixture.gtable('1.4').replace('Standard','Input')+fixture.gtable('1.2');
 const s=parse(t,'auto','opt.log');assert.equal(frames(s).length,2);close(frames(s)[1].atoms[1].z,1.2);assert.equal(s.metadata.multiplicity,1);
 const broken=fixture.gtable().replace(/ -+\n$/,'');assert.throws(()=>parse(broken));assert.match(parse(t+broken).metadata.importWarnings.join(''),/不完全/);
});
test('ORCA log Angstrom preferred over duplicate atomic units, AU only scales correctly',()=>{
 const a='CARTESIAN COORDINATES (ANGSTROEM)\n---------------------\nH 0 0 0\nH 0 0 .74\n\n';
 const b='CARTESIAN COORDINATES (A.U.)\n-----------------\nNO LB ZA FRAG MASS X Y Z\n0 H 1.0 0 1.0 0 0 0\n1 H 1.0 0 1.0 0 0 2\n\n';
 assert.equal(frames(parse(a+b+a)).length,2);close(parse(b).atoms[1].z,1.058354421806);
});
test('GRRM INP4GEN counts/frozen indices are checked',()=>{
 const t='TASK: FORCE\nNACTIVEATOM / NATOM: 2 / 2\nH 0 0 0\nH 0 0 .74\nNFROZENATOM: 1\nHe 4 0 0\n';
 const s=parse(t,'auto','INP4GEN.rrm');assert.equal(s.atoms.length,3);assert.equal(s.metadata.constraints.fixedAtomIds[0],s.atoms[2].id);assert.throws(()=>parse(t.replace('He 4 0 0','')));
});
test('TURBOMOLE coord scales Bohr and keeps f fixed flags',()=>{
 const s=parse('$coord\n0 0 0 h\n0 0 2 h f\n$end','auto','coord');close(s.atoms[1].z,1.058354421806);assert.equal(s.metadata.constraints.fixedAtomIds[0],s.atoms[1].id);
 close(parse('$coord angs\n0 0 2 h\n$end').atoms[0].z,2);assert.throws(()=>parse('$coord\n0 0 0 h'));
});
test('Q-Chem fragments and jobs use total charge, not fragment labels as atoms',()=>{
 const t='$molecule\n0 1\n--\n0 2\nH 0 0 0\n--\n0 2\nH 0 0 2\n$end\n$rem\nINPUT_BOHR TRUE\n$end';
 const s=parse(t+'\n@@@\n'+t,'auto','a.in');assert.equal(frames(s).length,2);assert.equal(s.atoms.length,2);close(s.atoms[1].z,1.058354421806);
});
test('NWChem and GAMESS Cartesian input units and symmetry restrictions',()=>{
 close(parse('geometry units au\nH 0 0 2\nend','auto','a.nw').atoms[0].z,1.058354421806);
 const t=' $CONTRL UNITS=BOHR ICHARG=-1 MULT=2 $END\n $DATA\nsynthetic\nC1\nH 1.0 0 0 2\n $END';
 const s=parse(t);close(s.atoms[0].z,1.058354421806);assert.equal(s.metadata.totalCharge,-1);assert.throws(()=>parse(t.replace('C1','C2v')),/C1/);
});
test('Molden atoms/geometry and FCHK arrays',()=>{
 close(parse('[Molden Format]\n[Atoms] AU\nH 1 1 0 0 2\n[GTO]\nignored').atoms[0].z,1.058354421806);
 assert.equal(frames(parse('[Molden Format]\n[GEOMETRIES] XYZ\n'+fixture.xyz+fixture.xyz+'[GEOCONV]\n')).length,2);
 const t='synthetic\nHF STO-3G\nCharge              I             -1\nMultiplicity        I              2\nAtomic numbers      I   N=           2\n 1 1\nCurrent cartesian coordinates      R   N=           6\n 0 0 0 0 0 2D+00\n';
 const s=parse(t);close(s.atoms[1].z,1.058354421806);assert.equal(s.metadata.totalCharge,-1);assert.equal(s.metadata.multiplicity,2);assert.throws(()=>parse(t.replace('N=           6','N=           9')));
});
test('CUBE imports atoms only, Bohr and legacy negative grid Angstrom',()=>{
 const t='synthetic\ncube\n1 0 0 0\n2 1 0 0\n2 0 1 0\n2 0 0 1\n1 1 0 0 2\n0.0 0.0';
 const s=parse(t,'auto','a.cube');close(s.atoms[0].z,1.058354421806);assert.equal(s.metadata.cell,undefined);
 close(parse(t.replace(/^2 /gm,'-2 '),'cube').atoms[0].z,2);
 assert.throws(()=>parse(t.replace('1 1 0 0 2','1 1 0 0 NaN'),'cube'));
});
test('GRO nm and triclinic box, concatenated frames and variable precision',()=>{
 const s=parse(fixture.gro+fixture.gro,'auto','a.gro');close(s.atoms[1].z,.74);assert.equal(frames(s).length,2);close(s.metadata.cell.vectors[1][1],11);
 const t=fixture.gro.replace('1.0 1.1 1.2','1 2 3 .1 .2 .3 .4 .5 .6');assert.deepEqual(plain(parse(t,'gro').metadata.cell.vectors),[[10,1,2],[3,20,4],[5,6,30]]);
 const precise=fixture.gro.replaceAll('   0.000','    0.00000').replace('   0.074','    0.07400');close(parse(precise,'gro').atoms[1].z,.74);
});
test('PDBQT AutoDock types and partial charge',()=>{
 const row='ATOM      1  C1  LIG A   1       0.000   0.000   1.500  1.00  0.00    -0.123 A';
 const s=parse(row,'auto','ligand.pdbqt');assert.equal(s.atoms[0].element,'C');close(s.atoms[0].z,1.5);assert.equal(Number(s.atoms[0].xyzExtras.partial_charge.values[0]),-.123);
 assert.throws(()=>parse(row.slice(0,77)+'XX','pdbqt'));
});
test('DFTB GEN fractional, Cartesian and unsupported nonzero origins',()=>{
 const t='1 F\nH\n1 1 .25 .5 .75\n0 0 0\n4 0 0\n0 6 0\n0 0 8\n';
 const s=parse(t);assert.deepEqual(plain([s.atoms[0].x,s.atoms[0].y,s.atoms[0].z]),[1,3,6]);
 close(parse('1 C\nH\n1 1 0 0 .74').atoms[0].z,.74);assert.throws(()=>parse(t.replace('0 0 0','1 0 0')),/原点/);
});
test('XDATCAR VASP5 multiple fractional frames and malformed last frame',()=>{
 const head=fixture.poscar.split('\n').slice(0,7).join('\n')+'\n';
 const t=head+'Direct configuration= 1\n0 0 0\n0 0 .1\nDirect configuration= 2\n0 0 0\n0 0 .2\n';
 const s=parse(t,'auto','XDATCAR');assert.equal(frames(s).length,2);close(frames(s)[1].atoms[1].z,1.2);assert.throws(()=>parse(t.slice(0,t.lastIndexOf('0 0 .2'))));
});
test('SIESTA FDF scales lattice and coordinates, checks species and external includes',()=>{
 const t='SystemLabel synthetic\nNumberOfAtoms 1\nLatticeConstant 2 Bohr\n%block LatticeVectors\n1 0 0\n0 2 0\n0 0 3\n%endblock LatticeVectors\n%block ChemicalSpeciesLabel\n1 1 H\n%endblock ChemicalSpeciesLabel\nAtomicCoordinatesFormat Fractional\n%block AtomicCoordinatesAndAtomicSpecies\n.5 .5 .5 1\n%endblock AtomicCoordinatesAndAtomicSpecies\n';
 const s=parse(t,'auto','a.fdf');close(s.atoms[0].z,3*.529177210903);close(s.metadata.cell.vectors[0][0],2*.529177210903);
 assert.throws(()=>parse('%include others.fdf\n'+t));assert.throws(()=>parse(t.replace('1 1 H','1 -1 H')));
});
test('SIESTA XV and STRUCT_OUT: Bohr vs fractional in Angstrom cell',()=>{
 const head='4 0 0\n0 4 0\n0 0 4\n1\n';
 close(parse(head+'1 1 0 0 2 0 0 0','auto','s.XV').atoms[0].z,1.058354421806);
 close(parse(head+'1 1 0 0 .5','auto','s.STRUCT_OUT').atoms[0].z,2);
});
test('Quantum ESPRESSO crystal / alat / Bohr and selective flags, no variable-cell guess',()=>{
 const t='&SYSTEM\nibrav=0, nat=1, celldm(1)=2\n/\nCELL_PARAMETERS alat\n1 0 0\n0 1 0\n0 0 1\nATOMIC_POSITIONS crystal\nH 0 0 .5 1 0 1\n';
 const s=parse(t,'auto','pw.in');close(s.atoms[0].z,.529177210903);assert.deepEqual(plain(s.atoms[0].selective),['T','F','T']);
 assert.throws(()=>parse(t.replace('ibrav=0','ibrav=2')));assert.throws(()=>parse(t+t),/可変セル/);
});
test('XSF animated cells and non-periodic ATOMS; FHI-aims fractional',()=>{
 const t='ANIMSTEPS 2\nCRYSTAL\nPRIMVEC 1\n4 0 0\n0 4 0\n0 0 4\nPRIMCOORD 1\n1 1\n1 0 0 1\nPRIMVEC 2\n5 0 0\n0 5 0\n0 0 5\nPRIMCOORD 2\n1 1\nH 0 0 2\n';
 const s=parse(t);assert.equal(frames(s).length,2);close(frames(s)[1].metadata.cell.vectors[0][0],5);
 close(parse('ATOMS\nH 0 0 .74\n').atoms[0].z,.74);
 const a=parse('lattice_vector 4 0 0\nlattice_vector 0 4 0\nlattice_vector 0 0 4\natom_frac 0 0 .5 H','auto','geometry.in');close(a.atoms[0].z,2);
});
test('Existing XYZ, POSCAR, MOL/SDF and project JSON remain readable',()=>{
 const s=parse(fixture.xyz);assert.equal(s.atoms.length,2);close(parse(fixture.poscar,'auto','CONTCAR').metadata.cell.vectors[0][0],4);
 const mol=IO.stateToMolText(s);assert.equal(parse(mol,'auto','x.mol').atoms.length,2);assert.equal(frames(parse(mol+'\n$$$$\n'+mol+'\n$$$$\n')).length,2);
 const json=IO.stateToProjectText(s);assert.deepEqual(plain(parse(json).atoms),plain(s.atoms));
});
test('Incompatible structures are retained as collection and explicitly warned',()=>{
 const s=parse('# OPT/x\n0 1\nH 0 0 0\nOptions\n# OPT/x\n0 1\nHe 0 0 0\nOptions\n');assert.equal(frames(s).length,2);assert.match(s.metadata.importWarnings.join(' '),/元素順序/);
});
test('Formats reject unknown logs, binary data and atom/frame limits',()=>{
 assert.throws(()=>parse('energy = 1','auto','unknown.out'));assert.throws(()=>parse('\x00abc','xyz'),/バイナリ/);
 assert.throws(()=>parse('# OPT/x\n0 1\n'+Array(2001).fill('H 0 0 0').join('\n')),/2000/);
 assert.throws(()=>parse(('# OPT/x\n0 1\nH 0 0 0\nOptions\n').repeat(201)),/200/);
});
test('Read multiple files in supplied order, normalize IDs and use reference XYZ once',async()=>{
 const s=await F.readFiles([file('a.com',fixture.grrm),file('b.gjf',fixture.gaussian)]);assert.equal(frames(s).length,3);assert.equal(frames(s)[2].metadata.sourceFile,'b.gjf');
 for(const input of [[file('job.inp','* xyzfile 0 1 h2.xyz'),file('h2.xyz',fixture.xyz)],[file('h2.xyz',fixture.xyz),file('job.inp','* xyzfile 0 1 h2.xyz')]]){
  const o=await F.readFiles(input);assert.equal(frames(o).length,1);assert.equal(o.metadata.sourceFormat,'orca');assert.equal(o.atoms.length,2);
 }
 const same=await F.readFiles([file('a.xyz',fixture.xyz),file('b.xyz',fixture.xyz)]);assert.equal(frames(same)[1].atoms[0].id,same.atoms[0].id);
 await assert.rejects(F.readFiles([file('a.xyz',fixture.xyz),file('bad.com','# OPT/x\n0 1\nH bad 0 0')]),/bad.com/);
 await assert.rejects(F.readFiles([file('a.xyz',fixture.xyz),file('a.xyz',fixture.xyz)]),/同名/);
});
test('UTF8 BOM, UTF16 LE/BE, Shift-JIS titles and CRLF',async()=>{
 const b=Buffer.from('\ufeff'+fixture.gaussian,'utf16le'),f={name:'a.gjf',size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer};
 assert.equal((await F.readFiles([f])).atoms.length,2);
 const be=Buffer.from(b);be.swap16();assert.equal((await F.readFiles([{...f,arrayBuffer:async()=>Uint8Array.from(be).buffer}])).atoms.length,2);
 assert.equal((await F.readFiles([file('a.com','\ufeff'+fixture.grrm.replaceAll('\n','\r\n'))])).atoms.length,3);
 const sjis=Buffer.concat([Buffer.from('1\n'),Buffer.from([0x83,0x65,0x83,0x58,0x83,0x67]),Buffer.from('\nH 0 0 0\n')]);
 const record=await F.readText({name:'a.xyz',size:sjis.length,arrayBuffer:async()=>Uint8Array.from(sjis).buffer});assert.equal(record.encoding,'shift_jis');assert.match(record.text,/テスト/);
 await assert.rejects(F.readFiles([{name:'big.log',size:F.MAX_BYTES+1}]),/50/);
 await assert.rejects(F.readText(file('a.chk','\0\0hello')),/バイナリ/);
});
test('GRRM constraints and frame geometry survive project export/import',()=>{
 const s=parse(fixture.grrm),r=IO.parseProject(IO.stateToProjectText(s));assert.equal(frames(r).length,2);assert.equal(r.metadata.constraints.fixedAtomIds[0],r.atoms[2].id);close(frames(r)[1].atoms[1].z,1.4);
});

test('CIF magic header is not a Gaussian route; atom labels remain coordinates',()=>{
 const s=parse('#\\#CIF_1.1\ndata_synthetic\nloop_\n_atom_site_type_symbol\n_atom_site_Cartn_x\n_atom_site_Cartn_y\n_atom_site_Cartn_z\nH 0 0 .74\n','auto','a.cif');assert.equal(s.metadata.sourceFormat,'cif');close(s.atoms[0].z,.74);
});

test('Molden trajectory wins over final Atoms; FR-COORD and SIESTA default are Bohr',()=>{
 assert.equal(frames(parse('[Molden Format]\n[Atoms] (AU)\nH 1 1 0 0 0\n[GEOMETRIES] XYZ\n'+fixture.xyz+fixture.xyz)).length,2);
 close(parse('[Molden Format]\n[Atoms] (AU)\nH 1 1 0 0 2\n').atoms[0].z,1.058354421806);
 close(parse('[Molden Format]\n[FR-COORD]\nH 0 0 2\n[FR-NORM-COORD]\n').atoms[0].z,1.058354421806);
 const f='%block ChemicalSpeciesLabel\n1 1 H\n%endblock\n%block AtomicCoordinatesAndAtomicSpecies\n0 0 2 1\n%endblock\n';close(parse(f).atoms[0].z,1.058354421806);
 assert.equal(parse('1\n# xyz title\nH 0 0 0\n').metadata.sourceFormat,'xyz');
});
