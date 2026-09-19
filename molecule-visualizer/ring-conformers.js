/* Correlated ring moves: rotate a graph component about two ring anchors.
 * Every boundary bond ends on the rotation axis, so ALL bond lengths and ring
 * closures are preserved exactly. Reject angle strain, clashes and inversion.
 * Geometric proposals only: no force field or thermodynamic weighting. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,G=MV.Geometry;
  const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],key=(a,b)=>a<b?a+':'+b:b+':'+a;
  function angle(a,b,c){const x=sub(a,b),y=sub(c,b),d=norm(x)*norm(y);return d<1e-10?NaN:Math.acos(Math.max(-1,Math.min(1,dot(x,y)/d)));}
  function volume(p,c,neighbors){const [a,b,d]=neighbors;return dot(sub(p[a],p[c]),cross(sub(p[b],p[c]),sub(p[d],p[c])));}
  function moves(state,g){
    const n=g.adj.length,discovery=Array(n).fill(-1),low=Array(n).fill(0),bridges=new Set();let clock=0;
    function visit(u,parent){discovery[u]=low[u]=clock++;for(const v of g.adj[u]){if(v===parent)continue;if(discovery[v]<0){visit(v,u);low[u]=Math.min(low[u],low[v]);if(low[v]>discovery[u])bridges.add(key(u,v));}else low[u]=Math.min(low[u],discovery[v]);}}
    for(let i=0;i<n;i++)if(discovery[i]<0)visit(i,-1);
    const bonds=new Map(g.bonds.map(b=>[key(b.i,b.j),b])),inRing=new Set(g.bonds.filter(b=>!bridges.has(key(b.i,b.j))).flatMap(b=>[b.i,b.j]));
    function flexible(b){
      if(b.order!==1)return false;
      if([b.i,b.j].every(i=>state.atoms[i].element==='C')&&G.distance(state.atoms[b.i],state.atoms[b.j])<1.45)return false; // short sp2-like XYZ bond
      return ![[b.i,b.j],[b.j,b.i]].some(([c,n])=>state.atoms[c].element==='C'&&state.atoms[n].element==='N'&&g.bonds.some(x=>x.order===2&&((x.i===c&&state.atoms[x.j].element==='O')||(x.j===c&&state.atoms[x.i].element==='O'))));
    }
    const anchors=[...inRing].filter(i=>state.atoms[i].element!=='H'&&g.adj[i].every(j=>flexible(bonds.get(key(i,j))))),result=[];
    for(let ai=0;ai<anchors.length;ai++)for(let bi=ai+1;bi<anchors.length;bi++){
      const a=anchors[ai],b=anchors[bi];if(g.adj[a].includes(b))continue;
      const seen=new Set([a,b]),components=[];
      // Only components reached from anchor A can connect both anchors.
      for(const seed of g.adj[a]){
        if(seen.has(seed))continue;const group=[seed];seen.add(seed);let hitsB=false;
        for(let k=0;k<group.length;k++)for(const v of g.adj[group[k]]){if(v===b)hitsB=true;if(!seen.has(v)){seen.add(v);group.push(v);}}
        if(hitsB)components.push(group);
      }
      if(components.length<2)continue; // no internal degree of freedom: would be rigid rotation
      components.sort((x,y)=>x.length-y.length);
      for(const group of components.slice(0,components.length===2?1:components.length)){
        if(group.some(i=>g.adj[i].some(j=>(j===a||j===b)&&!flexible(bonds.get(key(i,j))))))continue;
        result.push({a,b,group});if(result.length>=256)return result;
      }
    }
    return result;
  }
  function constraints(original,g){
    const angles=[],chirality=[];
    for(let c=0;c<g.adj.length;c++){
      const neighbors=g.adj[c];for(let i=0;i<neighbors.length;i++)for(let j=i+1;j<neighbors.length;j++){const value=angle(original[neighbors[i]],original[c],original[neighbors[j]]);if(!Number.isFinite(value))throw Error('重なった結合があるため環の配座を生成できません。');angles.push([neighbors[i],c,neighbors[j],value]);}
      if(neighbors.length>=3){const v=volume(original,c,neighbors);if(Math.abs(v)>.08)chirality.push([c,neighbors.slice(0,3),v]);}
    }
    return {angles,chirality};
  }
  function valid(p,limits,pairs){
    if(limits.angles.some(([a,b,c,target])=>Math.abs(angle(p[a],p[b],p[c])-target)>20*Math.PI/180))return false;
    if(limits.chirality.some(([c,neighbors,v])=>volume(p,c,neighbors)*Math.sign(v)<.1*Math.abs(v)))return false;
    return !pairs.some(([i,j,min])=>norm(sub(p[i],p[j]))<min);
  }
  function perturb(p,choices,limits,pairs,random,degrees=30){
    let accepted=0;const result=p.map(v=>v.slice());
    for(let trial=0;trial<Math.min(24,choices.length*3);trial++){
      const move=choices[Math.floor(random()*choices.length)],origin=result[move.a],direction=sub(result[move.b],origin),length=norm(direction);if(length<1e-8)continue;
      const axis=direction.map(v=>v/length),theta=(2*random()-1)*degrees*Math.PI/180,cos=Math.cos(theta),sin=Math.sin(theta),before=move.group.map(i=>result[i]);
      move.group.forEach(i=>{const v=sub(result[i],origin),d=dot(v,axis),c=cross(axis,v);result[i]=v.map((x,k)=>origin[k]+x*cos+c[k]*sin+axis[k]*d*(1-cos));});
      if(valid(result,limits,pairs))accepted++;else move.group.forEach((i,k)=>result[i]=before[k]);
    }
    return {positions:result,accepted};
  }
  function signature(p,g){
    // Intrinsic 1–4 distances distinguish conformations without counting rotations.
    const pairs=new Set();for(const b of g.bonds)for(const a of g.adj[b.i])for(const d of g.adj[b.j])if(a!==b.j&&d!==b.i&&a!==d)pairs.add(key(a,d));
    return [...pairs].sort().map(k=>{const [a,b]=k.split(':').map(Number);return Math.round(norm(sub(p[a],p[b]))/.025);}).join(',');
  }
  MV.RingConformers={moves,constraints,perturb,signature,valid};
})(window);
