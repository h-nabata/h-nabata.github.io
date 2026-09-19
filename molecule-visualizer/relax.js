/* Fast geometric relaxation, not a parameterized molecular force field.
 * Pair springs implement bond lengths and ideal 1–3 distances; a soft
 * nonbonded core prevents overlap. Only coordinates change, never topology.
 */
(function(root){
  'use strict';
  function relax(state,radii,minimumImage,options={}){
    const atoms=state.atoms,n=atoms.length;
    if(!n||n>500)throw Error('構造緩和は1〜500原子に対応しています。');
    const supported=new Set(['H','B','C','N','O','F','Si','P','S','Cl','Br','I']);
    if(atoms.some(a=>!supported.has(a.element)))throw Error('簡易緩和は H/B/C/N/O/F/Si/P/S/Cl/Br/I に対応します。金属・イオン結晶には適用できません。');
    if(atoms.some(a=>![a.x,a.y,a.z].every(Number.isFinite)))throw Error('座標が不正です。');
    const id=new Map(atoms.map((a,i)=>[a.id,i])),adj=Array.from({length:n},()=>[]),springs=[],excluded=new Set();
    const key=(i,j)=>i<j?i+':'+j:j+':'+i;
    for(const b of state.bonds){
      if(b.type&&b.type!=='covalent')continue;
      const i=id.get(b.atom1),j=id.get(b.atom2);if(i===undefined||j===undefined||i===j)continue;
      const order=Number(b.order)||1,factor=order===3?.82:order===2?.88:order===4?.92:1;
      const length=(radii[atoms[i].element]+radii[atoms[j].element])*factor;
      springs.push([i,j,length,20]);adj[i].push({i:j,length,order});adj[j].push({i,length,order});excluded.add(key(i,j));
    }
    for(let c=0;c<n;c++){
      const a=adj[c],el=atoms[c].element;
      const angle=a.some(b=>b.order===3)||a.filter(b=>b.order===2).length===2?180:a.some(b=>b.order===2||b.order===4)?120:el==='O'&&a.length===2?104.5:el==='N'&&a.length===3?107:109.471;
      for(let j=0;j<a.length;j++)for(let k=j+1;k<a.length;k++){
        const u=a[j],v=a[k],pair=key(u.i,v.i);excluded.add(pair);
        // Small-ring closure is stronger than the angle preference.
        const target=Math.sqrt(u.length**2+v.length**2-2*u.length*v.length*Math.cos(angle*Math.PI/180));
        springs.push([u.i,v.i,target,1.2]);
      }
    }
    const vdw={H:1.2,B:1.92,C:1.7,N:1.55,O:1.52,F:1.47,Si:2.1,P:1.8,S:1.8,Cl:1.75,Br:1.85,I:1.98},pairs=[];
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(!excluded.has(key(i,j)))pairs.push([i,j,.75*(vdw[atoms[i].element]+vdw[atoms[j].element]),2]);
    const cell=state.metadata?.cell;
    const delta=(x,i,j)=>{const d=[x[3*i]-x[3*j],x[3*i+1]-x[3*j+1],x[3*i+2]-x[3*j+2]];return cell?minimumImage(d,cell).vector:d;};
    function evaluate(x,gradient){
      const g=gradient?new Float64Array(n*3):null;let energy=0;
      function pair(i,j,target,k,repulsion){
        let d=delta(x,i,j),r=Math.hypot(...d);if(repulsion&&r>=target)return;
        // Deterministic direction also separates exactly coincident atoms.
        if(r<1e-10){d=[Math.sin((i+1)*17+j),Math.cos((j+1)*13+i),Math.sin((i+j+1)*7)];const norm=Math.hypot(...d);d=d.map(v=>v/norm);r=0;}
        else d=d.map(v=>v/r);
        const error=r-target;energy+=.5*k*error*error;
        if(g)for(let kdim=0;kdim<3;kdim++){const force=k*error*d[kdim];g[3*i+kdim]+=force;g[3*j+kdim]-=force;}
      }
      for(const p of springs)pair(...p,false);for(const p of pairs)pair(...p,true);
      return {energy,g};
    }
    let x=atoms.flatMap(a=>[a.x,a.y,a.z]),current=evaluate(x,true),initial=current.energy,steps=0;
    const start=Date.now(),maxSteps=options.maxSteps||300,timeLimit=options.timeLimit||1800;
    for(;steps<maxSteps&&Date.now()-start<timeLimit;steps++){
      const max=Math.max(...current.g.map(Math.abs));if(max<1e-4)break;
      let step=Math.min(.025,.08/max),accepted=false;
      for(let trial=0;trial<12;trial++){
        const next=x.map((v,i)=>v-step*current.g[i]),e=evaluate(next,false).energy;
        if(Number.isFinite(e)&&e<current.energy-1e-10){x=next;current=evaluate(x,true);accepted=true;break;}step*=.5;
      }
      if(!accepted)break;
    }
    return {coordinates:atoms.map((_,i)=>x.slice(3*i,3*i+3)),initial,final:current.energy,steps};
  }
  if(typeof module==='object')module.exports=relax;else root.MoleculeRelax=relax;
})(typeof self==='undefined'?globalThis:self);
