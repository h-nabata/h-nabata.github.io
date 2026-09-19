const test=require('node:test'),assert=require('node:assert/strict'),relax=require('../relax.js'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const ctx={window:{}};vm.createContext(ctx);for(const f of ['model','bonding','geometry','io','periodic'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);
const MV=ctx.window.MoleculeVisualizer,run=s=>relax(s,MV.Bonding.COVALENT_RADII,MV.Periodic.minimumImage,{timeLimit:5000});
test('light relaxation reduces distortions, preserves input and center, and separates overlapping nonbonded atoms',()=>{
 const s=MV.IO.parseXYZToState('O 0 0 0\nH .95 0 0\nH -.24 .92 0');s.atoms[1].x=2;s.atoms[2].y=.4;const before=JSON.stringify(s),r=run(s);assert.equal(JSON.stringify(s),before);assert.ok(r.final<r.initial*.2);assert.ok(Math.hypot(...r.coordinates[0].map((v,i)=>v-r.coordinates[1][i]))<1.1);
 for(let j=0;j<3;j++)assert.ok(Math.abs(r.coordinates.reduce((v,p)=>v+p[j],0)-s.atoms.reduce((v,a)=>v+[a.x,a.y,a.z][j],0))<1e-8);
 const overlap=MV.IO.parseXYZToState('C 0 0 0\nC 0 0 0');overlap.bonds=[];const o=run(overlap);assert.ok(o.final<o.initial);assert.ok(Math.hypot(...o.coordinates[0].map((v,i)=>v-o.coordinates[1][i]))>2);
});
test('periodic relaxation uses minimum images with fixed cell and rejects unsupported elements',()=>{
 const s=MV.IO.parseXYZToState('C .1 0 0\nC 9 0 0');s.metadata.cell=MV.Periodic.cell([[10,0,0],[0,10,0],[0,0,10]]);MV.Model.addOrUpdateBond(s,s.atoms[0].id,s.atoms[1].id,1,'covalent','manual');const before=JSON.stringify(s.metadata.cell),r=run(s);assert.ok(r.final<r.initial);assert.equal(JSON.stringify(s.metadata.cell),before);const d=MV.Periodic.minimumImage(r.coordinates[0].map((v,i)=>v-r.coordinates[1][i]),s.metadata.cell).distance;assert.ok(Math.abs(d-1.52)<.01);assert.throws(()=>run(MV.IO.parseXYZToState('Na 0 0 0')),/金属/);
});
