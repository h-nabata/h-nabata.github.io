const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function modules(extra={}){
 const window={...extra},context=vm.createContext({window,document:extra.document,console});
 for(const name of ['model','bonding','io','periodic','renderer3dmol'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name+'.js'),'utf8'),context);
 return window.MoleculeVisualizer;
}
function random(seed){return ()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};}
function pairs(bonds){return bonds.map(b=>[b.atom1,b.atom2,b.type].join(':')).join('|');}
test('spatial bonds equal exhaustive search for gas, skew and partial periodic cells',()=>{
 const m=modules(),r=random(710),elements=['C','H','O','Fe','I','He'];
 for(const cell of [null,m.Periodic.cell([[9,0,0],[4,8,0],[-2,3,10]]),m.Periodic.cell([[9,0,0],[4,8,0],[-2,3,10]],[true,false,true])]){
  const atoms=Array.from({length:220},(_,i)=>({id:'a'+i,element:elements[i%elements.length],x:60*r()-30,y:60*r()-30,z:60*r()-30}));
  const expected=[];
  for(let i=0;i<atoms.length;i++)for(let j=i+1;j<atoms.length;j++)expected.push(...m.Bonding.inferBonds([atoms[i],atoms[j]],cell));
  assert.equal(pairs(m.Bonding.inferBonds(atoms,cell)),pairs(expected));
  if(cell){cell.vectors[0][0]+=1;const ref=[];for(let i=0;i<atoms.length;i++)for(let j=i+1;j<atoms.length;j++)ref.push(...m.Bonding.inferBonds([atoms[i],atoms[j]],cell));assert.equal(pairs(m.Bonding.inferBonds(atoms,cell)),pairs(ref));}
 }
});
test('prepared MIC is a cell snapshot and retains partial-periodic closest image',()=>{
 const m=modules(),cell=m.Periodic.cell([[8,0,0],[3,7,0],[1,2,9]],[true,false,true]),solve=m.Periodic.prepareMinimumImage(cell),r=random(19);
 for(let k=0;k<80;k++){
  const d=Array.from({length:3},()=>30*r()-15),actual=solve(d);let best=Infinity;
  for(let a=-8;a<=8;a++)for(let c=-8;c<=8;c++){const shift=m.Periodic.cartesian([a,0,c],cell);best=Math.min(best,Math.hypot(...d.map((v,i)=>v+shift[i])));}
  assert.ok(Math.abs(actual.distance-best)<1e-10);
 }
 const before=solve([5,0,0]).distance;cell.vectors[0][0]=12;assert.equal(solve([5,0,0]).distance,before);assert.notEqual(m.Periodic.minimumImage([5,0,0],cell).distance,before);
});
test('Verlet soft-core list matches exhaustive relaxation including periodic crossings',()=>{
 const m=modules(),relax=require('../relax.js');
 for(const cell of [null,m.Periodic.cell([[18,0,0],[2,17,0],[0,0,16]])]){
  const r=random(43),atoms=Array.from({length:100},(_,i)=>({id:'a'+i,element:'C',x:(i%5)*2.2+.2*r(),y:(Math.floor(i/5)%5)*2.2+.2*r(),z:Math.floor(i/25)*2.2+.2*r()}));
  const state={atoms,bonds:[],metadata:{cell}},mic=cell?m.Periodic.prepareMinimumImage(cell):m.Periodic.minimumImage;
  const options={maxSteps:35,timeLimit:120000},fast=relax(state,m.Bonding.COVALENT_RADII,mic,options),ref=relax(state,m.Bonding.COVALENT_RADII,mic,{...options,neighborList:false});
  assert.deepEqual(fast,ref);
 }
});
test('renderer coalesces frames and avoids resizing unchanged canvas',()=>{
 let resets=0,gradients=0,seq=0;const pending=new Map();
 const ctx=new Proxy({createRadialGradient(){gradients++;return {addColorStop(){}};}},{get:(o,k)=>o[k]||(()=>{})});
 const canvas=()=>({style:{},clientWidth:800,clientHeight:500,set width(v){this.w=v;resets++;},get width(){return this.w;},set height(v){this.h=v;resets++;},get height(){return this.h;},setAttribute(){},addEventListener(){},getContext(){return ctx;}});
 const container={innerHTML:'',appendChild(){},getBoundingClientRect(){return {width:800,height:500};}};
 const document={getElementById:()=>container,createElement:canvas},m=modules({document,devicePixelRatio:2,addEventListener(){},requestAnimationFrame:f=>{pending.set(++seq,f);return seq;},cancelAnimationFrame:i=>pending.delete(i)});
 const renderer=new m.Renderer3DMol('viewer'),state=m.Model.createState({atoms:[{id:'a1',element:'C',x:0,y:0,z:0},{id:'a2',element:'O',x:1.3,y:0,z:0}]});
 renderer.renderState(state,false);const dimensions=resets,paint=gradients;
 renderer.renderState(state,true);assert.equal(resets,dimensions);
 let draws=0;const draw=renderer.draw.bind(renderer);renderer.draw=()=>{draws++;draw();};
 for(let i=0;i<30;i++)renderer.requestDraw();assert.equal(pending.size,1);assert.equal(draws,0);
 for(const f of [...pending.values()]){pending.clear();f();}assert.equal(draws,1);
 const point=renderer.projectedAtoms[0];assert.equal(renderer.pickAtom(point.x,point.y).id,point.atom.id);
 state.atoms[0].x=4;renderer.renderState(state,true);assert.notEqual(renderer.projectedAtoms[0].x,point.x);
});
