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
    const skin=.5;let neighbors=pairs,neighborOrigin=null;
    function nearby(x){
      if(options.neighborList===false||pairs.length<128)return pairs;
      let rebuild=!neighborOrigin;
      if(!rebuild)for(let k=0;k<x.length;k+=3){
        if((x[k]-neighborOrigin[k])**2+(x[k+1]-neighborOrigin[k+1])**2+(x[k+2]-neighborOrigin[k+2])**2>(skin/2)**2){rebuild=true;break;}
      }
      if(rebuild){
        neighborOrigin=Array.from(x);
        neighbors=pairs.filter(([i,j,target])=>{
          const d=delta(x,i,j),limit=target+skin;
          return d[0]*d[0]+d[1]*d[1]+d[2]*d[2]<=limit*limit;
        });
      }
      return neighbors;
    }
    function evaluate(x,gradient){
      const g=gradient?new Float64Array(n*3):null;let energy=0;
      function pair(i,j,target,k,repulsion){
        const u=3*i,v=3*j;
        let dx=x[u]-x[v],dy=x[u+1]-x[v+1],dz=x[u+2]-x[v+2];
        if(cell)[dx,dy,dz]=minimumImage([dx,dy,dz],cell).vector;
        // Reject outside the finite soft core before allocating/normalizing.
        if(repulsion&&(Math.abs(dx)>=target||Math.abs(dy)>=target||Math.abs(dz)>=target))return;
        let r=Math.hypot(dx,dy,dz);if(repulsion&&r>=target)return;
        if(r<1e-10){
          dx=Math.sin((i+1)*17+j);dy=Math.cos((j+1)*13+i);dz=Math.sin((i+j+1)*7);
          const norm=Math.hypot(dx,dy,dz);dx/=norm;dy/=norm;dz/=norm;r=0;
        }else {dx/=r;dy/=r;dz/=r;}
        const error=r-target;energy+=.5*k*error*error;
        if(g){const f=k*error;g[u]+=f*dx;g[u+1]+=f*dy;g[u+2]+=f*dz;g[v]-=f*dx;g[v+1]-=f*dy;g[v+2]-=f*dz;}
      }
      for(const p of springs)pair(p[0],p[1],p[2],p[3],false);
      for(const p of nearby(x))pair(p[0],p[1],p[2],p[3],true);
      return {energy,g};
    }
    let x=atoms.flatMap(a=>[a.x,a.y,a.z]),current=evaluate(x,true),initial=current.energy,steps=0;
    const start=Date.now(),maxSteps=options.maxSteps||300,timeLimit=options.timeLimit||1800;
    for(;steps<maxSteps&&Date.now()-start<timeLimit;steps++){
      const max=Math.max(...current.g.map(Math.abs));if(max<1e-4)break;
      let step=Math.min(.025,.08/max),accepted=false;
      for(let trial=0;trial<12;trial++){
        const next=x.map((v,i)=>v-step*current.g[i]),evaluated=evaluate(next,true),e=evaluated.energy;
        if(Number.isFinite(e)&&e<current.energy-1e-10){x=next;current=evaluated;accepted=true;break;}step*=.5;
      }
      if(!accepted)break;
    }
    return {coordinates:atoms.map((_,i)=>x.slice(3*i,3*i+3)),initial,final:current.energy,steps};
  }
  if(typeof module==='object')module.exports=relax;else root.MoleculeRelax=relax;
})(typeof self==='undefined'?globalThis:self);
