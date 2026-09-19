const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={window:{}};vm.createContext(ctx);for(const f of ['model','bonding','geometry','io','molfile','periodic','formats','measurements','ring-conformers','generation'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f+'.js'),'utf8'),ctx);
const {Measurements:Q,Model:M,IO,Periodic:P,Geometry:G,Generation:R,RingConformers:C}=ctx.window.MoleculeVisualizer;
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`),coords=s=>s.atoms.map(a=>[a.x,a.y,a.z]);
function state(points){return IO.parseXYZToState(points.map(p=>'C '+p.join(' ')).join('\n'));}
function measurement(type,indices,options={}){return {type,indices,options};}
test('all six measurement types obey documented atom order and analytic geometries',()=>{
 const s=state([[0,0,0],[1,0,0],[1,1,0],[0,0,2],[1,0,2],[1,1,2]]);
 near(Q.evaluate(s,measurement('distance',[0,1])).value,1);near(Q.evaluate(s,measurement('angle',[0,1,2])).value,90);
 near(Q.evaluate(s,measurement('dihedral',[0,1,2,5])).value,G.dihedral(...[0,1,2,5].map(i=>s.atoms[i])));
 near(Q.evaluate(s,measurement('planeDistance',[0,1,2,3])).value,2);near(Q.evaluate(s,measurement('planeGap',[0,1,2,3,4,5])).value,2);
 s.atoms[5].z=3;const intersect=Q.evaluate(s,measurement('planeGap',[0,1,2,3,4,5]));near(intersect.value,0);assert.match(intersect.note,/交差/);
 const cone=state([[0,0,0],[1,0,1],[-.5,Math.sqrt(3)/2,1],[-.5,-Math.sqrt(3)/2,1]]);
 near(Q.evaluate(cone,measurement('cone',[0,1,2,3],{coneVdw:false})).value,90);
 const radii=[.2,.2,.2];near(Q.evaluate(cone,measurement('cone',[0,1,2,3],{radii})).value,90+2*Math.asin(.2/Math.sqrt(2))*180/Math.PI);
});
test('cone solver covers antipodal, planar, unequal-radius and one-cap-dominant limits',()=>{
 const v=(x,y,z)=>({x,y,z});
 near(Q.enclosingCone([v(1,0,0),v(-1,0,0),v(0,1,0)],[0,0,0]).value,180);
 near(Q.enclosingCone([v(1,0,0),v(1,0,0),v(1,0,0)],[.3,.1,.2]).value,2*Math.asin(.3)*180/Math.PI);
 const dirs=[v(1,0,0),v(0,1,0),v(1,1,0)],radii=[.1,.2,0],r=Q.enclosingCone(dirs,radii);near(r.value,90+(Math.asin(.1)+Math.asin(.2))*180/Math.PI);
 dirs.forEach((p,i)=>assert.ok(Math.acos(Math.max(-1,Math.min(1,G.dot(G.unit(p),r.axis))))+Math.asin(radii[i]/G.norm(p))<=r.halfAngle+1e-7));
 assert.throws(()=>Q.enclosingCone(dirs,[2,0,0]),/内側/);
});
test('measurement values are invariant under rigid rotations/translations, including cone axes',()=>{
 const s=state([[0,0,-3],[1,0,0],[-.5,.866,0],[-.5,-.866,0],[1,0,2],[0,1,2]]),items=[measurement('distance',[0,1]),measurement('angle',[0,1,2]),measurement('dihedral',[0,1,2,3]),measurement('planeDistance',[1,2,3,0]),measurement('planeGap',[1,2,3,0,4,5]),measurement('cone',[0,1,2,3])],before=items.map(d=>Q.evaluate(s,d));
 for(const atom of s.atoms){Object.assign(atom,G.rotateAroundAxis(atom,{x:0,y:0,z:0},{x:1,y:2,z:3},73));atom.x+=15;atom.y-=7;atom.z+=21;}
 items.forEach((item,i)=>near(Q.evaluate(s,item).value,before[i].value,1e-6));
});
test('degenerate planes/dihedrals and missing atoms are undefined, not stale or fabricated zero',()=>{
 const s=state([[0,0,0],[1,0,0],[2,0,0],[0,0,1]]);
 for(const type of ['dihedral','planeDistance']){const r=Q.evaluate(s,measurement(type,[0,1,2,3]));assert.equal(r.ok,false);assert.equal(r.value,null);}
 assert.equal(Q.evaluate(s,measurement('angle',[0,1,10])).ok,false);
});
test('minimum-image measurements unwrap locally; stored Cartesian convention remains independent',()=>{
 const s=state([[9.8,0,0],[.2,0,0],[.2,1,0],[.2,1,1]]);s.metadata.cell=P.cell([[10,0,0],[1,10,0],[0,0,10]]);
 near(Q.evaluate(s,measurement('distance',[0,1])).value,9.6);near(Q.evaluate(s,measurement('distance',[0,1],{minimumImage:true})).value,.4);
 near(Q.evaluate(s,measurement('angle',[0,1,2],{minimumImage:true})).value,90);
 near(Math.abs(Q.evaluate(s,measurement('dihedral',[0,1,2,3],{minimumImage:true})).value),90);
});
test('ordered file-order selection and pinned IDs survive different frame IDs, project reload and atom deletion',()=>{
 const s=state([[0,0,0],[1,0,0],[1,1,0],[0,0,2]]),f=state([[0,0,0],[2,0,0],[2,1,0],[0,0,3]]);
 s.metadata.trajectory=[P.snapshot(s),P.snapshot(f)];s.metadata.frameIndex=0;s.selectedAtomIds=new Set([s.atoms[3].id,s.atoms[0].id]);const pin=Q.pin(s);near(Q.evaluate(s,pin).value,2);
 Q.transferSelection(s,f);assert.deepEqual([...f.selectedAtomIds],[f.atoms[3].id,f.atoms[0].id]);f.metadata.frameIndex=1;f.metadata.measurements=JSON.parse(JSON.stringify(s.metadata.measurements));Q.bind(f);near(Q.evaluate(f,Q.config(f).items[0]).value,3);
 s.metadata.measurements=JSON.parse(JSON.stringify(f.metadata.measurements));const project=IO.parseProject(IO.stateToProjectText(s));near(Q.evaluate(project,Q.config(project).items[0]).value,2);
 s.atoms.splice(1,1);near(Q.evaluate(s,pin).value,2);s.atoms.pop();assert.equal(Q.evaluate(s,pin).ok,false);
 const shorter=state([[1,0,0]]);assert.equal(Q.transferSelection(f,shorter),1);
 assert.equal(P.snapshot(project).metadata.measurements,undefined,'pins belong to document, not each snapshot');
});
test('CSV contains all pins and frames, uses current edited coordinates, and reports undefined values safely',()=>{
 const s=state([[0,0,0],[1,0,0],[1,1,0],[0,0,2]]),f=state([[0,0,0],[2,0,0],[2,1,0],[0,0,3]]);s.metadata.trajectory=[P.snapshot(s),P.snapshot(f)];s.metadata.frameIndex=0;
 s.selectedAtomIds=new Set([s.atoms[0].id,s.atoms[3].id]);Q.pin(s);s.selectedAtomIds=new Set(s.atoms.map(a=>a.id));Q.config(s).type='planeDistance';Q.pin(s);s.selectedAtomIds.clear();s.atoms[3].z=4;s.metadata.title='=HYPERLINK("bad")';
 const csv=Q.csv(s);assert.ok(csv.startsWith('\ufeff'));const lines=csv.trim().split('\r\n');assert.equal(lines.length,3);assert.match(lines[0],/M1.*M2/);assert.match(lines[1],/,4,/);assert.match(lines[1],/'=HYPERLINK/);assert.match(lines[2],/,3,/);
 s.atoms.pop();assert.match(Q.csv(s),/NA:/);assert.equal(Q.config(s).items.length,2);
 const bad=JSON.parse(IO.stateToProjectText(f));bad.metadata.measurements={version:1,items:[null]};assert.throws(()=>IO.parseProject(JSON.stringify(bad)),/固定計測/);
});
function cyclohexane(hydrogens=true){
 const s=state(Array.from({length:6},(_,i)=>[1.45*Math.cos(i*Math.PI/3),1.45*Math.sin(i*Math.PI/3),i%2?.24:-.24]));s.bonds=[];for(let i=0;i<6;i++)M.addOrUpdateBond(s,s.atoms[i].id,s.atoms[(i+1)%6].id,1,'covalent','manual');
 if(hydrogens)for(let i=0;i<6;i++){const center=s.atoms[i],u=G.unit(G.vsub(s.atoms[(i+5)%6],center)),v=G.unit(G.vsub(s.atoms[(i+1)%6],center)),bis=G.unit(G.vadd(u,v)),normal=G.unit(G.cross(u,v)),a=1/(3*G.dot(bis,u)),b=Math.sqrt(1-a*a);for(const sign of [-1,1]){const pos=G.vadd(center,G.vscale(G.vadd(G.vscale(bis,-a),G.vscale(normal,sign*b)),1.09)),h=M.createAtom({element:'H',...pos});s.atoms.push(h);M.addOrUpdateBond(s,center.id,h.id,1,'covalent','manual');}}
 return s;
}
test('ring proposals vary cyclic torsions with H/substituents while preserving every bond and stereochemistry',()=>{
 const s=cyclohexane(),before=JSON.stringify(s),g=R.graph(s),limits=C.constraints(coords(s),g),r=R.randomStructures(s,{count:20,mode:'torsion',seed:100,rings:true,ringAngle:30}),again=R.randomStructures(s,{count:20,mode:'torsion',seed:100,rings:true,ringAngle:30});
 assert.equal(r.state.metadata.trajectory.length,20);assert.ok(r.state.metadata.generation.ringMoves>0);assert.equal(JSON.stringify(r.state),JSON.stringify(again.state));assert.equal(JSON.stringify(s),before);
 const torsions=[];for(const f of r.state.metadata.trajectory){for(const bond of s.bonds){const ia=s.atoms.findIndex(a=>a.id===bond.atom1),ib=s.atoms.findIndex(a=>a.id===bond.atom2);near(G.distance(f.atoms[ia],f.atoms[ib]),G.distance(s.atoms[ia],s.atoms[ib]),1e-9);}assert.ok(C.valid(coords(f),limits,[]));torsions.push(G.dihedral(...f.atoms.slice(0,4)));}
 assert.ok(Math.max(...torsions)-Math.min(...torsions)>5);assert.throws(()=>R.randomStructures(s,{count:1,mode:'torsion',rings:false}),/変動可能/);
});
test('aromatic rings and rigid small rings are protected, mixed unsaturated rings keep double bonds intact',()=>{
 const benzene=cyclohexane(false);for(let i=0;i<6;i++){benzene.atoms[i].x=1.4*Math.cos(i*Math.PI/3);benzene.atoms[i].y=1.4*Math.sin(i*Math.PI/3);benzene.atoms[i].z=0;}benzene.bonds.forEach(b=>b.order=4);assert.equal(C.moves(benzene,R.graph(benzene)).length,0);
 benzene.bonds.forEach(b=>b.order=1);assert.equal(C.moves(benzene,R.graph(benzene)).length,0,'short sp2-like XYZ bonds must not be puckered');
 const triangle=state([[0,0,0],[1.5,0,0],[.75,1.3,0]]);triangle.bonds=[];for(let i=0;i<3;i++)M.addOrUpdateBond(triangle,triangle.atoms[i].id,triangle.atoms[(i+1)%3].id,1,'covalent','manual');assert.equal(C.moves(triangle,R.graph(triangle)).length,0);
 const mixed=cyclohexane(false);mixed.bonds[0].order=2;const moves=C.moves(mixed,R.graph(mixed));assert.ok(moves.length>0);assert.ok(moves.every(m=>![m.a,m.b].includes(0)&&![m.a,m.b].includes(1)));
});
