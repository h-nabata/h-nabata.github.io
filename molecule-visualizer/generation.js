/* Seeded torsion/orientation sampling and distance-interpolated initial paths.
 * No energy calculator or NEB is used; generated geometries require inspection.
 */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,M=MV.Model,P=MV.Periodic,B=MV.Bonding;
  const xyz=a=>[a.x,a.y,a.z],add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),norm=a=>Math.hypot(...a);
  function rng(seed){let a=Number(seed)>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
  function count(value,min=1){const n=Number(value);if(!Number.isInteger(n)||n<min||n>20)throw Error(`生成数は${min}〜20の整数にしてください。`);return n;}
  function check(s,max=500){if(!s.atoms.length||s.atoms.length>max||s.atoms.some(a=>!xyz(a).every(Number.isFinite)))throw Error(`1〜${max}原子の有限な座標が必要です。`);}
  function center(p){return [0,1,2].map(k=>p.reduce((v,x)=>v+x[k],0)/p.length);}
  function rotate(v,axis,angle){const c=Math.cos(angle),s=Math.sin(angle),d=dot(v,axis),cross=[axis[1]*v[2]-axis[2]*v[1],axis[2]*v[0]-axis[0]*v[2],axis[0]*v[1]-axis[1]*v[0]];return v.map((x,i)=>x*c+cross[i]*s+axis[i]*d*(1-c));}
  function randomRotation(random){const u=random(),v=2*Math.PI*random(),w=2*Math.PI*random(),q=[Math.sqrt(1-u)*Math.sin(v),Math.sqrt(1-u)*Math.cos(v),Math.sqrt(u)*Math.sin(w),Math.sqrt(u)*Math.cos(w)];return p=>{const [x,y,z,s]=q,t=[2*(y*p[2]-z*p[1]),2*(z*p[0]-x*p[2]),2*(x*p[1]-y*p[0])];return [p[0]+s*t[0]+y*t[2]-z*t[1],p[1]+s*t[1]+z*t[0]-x*t[2],p[2]+s*t[2]+x*t[1]-y*t[0]];};}
  function graph(s){const map=new Map(s.atoms.map((a,i)=>[a.id,i])),adj=s.atoms.map(()=>[]),bonds=[];for(const b of s.bonds){if(b.type!=='covalent')continue;const i=map.get(b.atom1),j=map.get(b.atom2);if(i==null||j==null)continue;adj[i].push(j);adj[j].push(i);bonds.push({i,j,order:b.order});}return {adj,bonds};}
  function rotors(s,g){return g.bonds.filter(b=>{
    if(b.order!==1||[b.i,b.j].some(i=>s.atoms[i].element==='H'||g.adj[i].length<2))return false;
    // Exclude amide C–N rotation even if MOL represents it as a single bond.
    return ![[b.i,b.j],[b.j,b.i]].some(([c,n])=>s.atoms[c].element==='C'&&s.atoms[n].element==='N'&&g.bonds.some(x=>x.order===2&&((x.i===c&&s.atoms[x.j].element==='O')||(x.j===c&&s.atoms[x.i].element==='O'))));
  }).flatMap(b=>{
    const seen=new Set([b.j]),queue=[b.j];for(let k=0;k<queue.length;k++)for(const n of g.adj[queue[k]]){if((queue[k]===b.j&&n===b.i)||(queue[k]===b.i&&n===b.j))continue;if(!seen.has(n)){seen.add(n);queue.push(n);}}
    return seen.has(b.i)?[]:[{...b,group:[...seen]}];
  });}
  function clashPairs(s,g){const pairs=[];for(let i=0;i<s.atoms.length;i++)for(let j=i+1;j<s.atoms.length;j++){if(g.adj[i].includes(j)||g.adj[i].some(k=>g.adj[k].includes(j)))continue;const cutoff=.72*((B.COVALENT_RADII[s.atoms[i].element]||.8)+(B.COVALENT_RADII[s.atoms[j].element]||.8));pairs.push([i,j,cutoff]);}return pairs;}
  function coordinates(s,p,title){const copy=M.createState(P.snapshot(s));copy.atoms.forEach((a,i)=>{[a.x,a.y,a.z]=p[i];});copy.metadata.title=title;return copy;}
  function series(states,info){states.forEach(s=>s.metadata.generation=info);const frames=states.map(P.snapshot),s=M.createState(frames[0]);s.metadata.trajectory=frames;s.metadata.frameIndex=0;s.metadata.generation=info;return s;}
  function randomStructures(s,options,progress=()=>{}){
    const n=count(options.count),mode=options.mode||'both';if(!['torsion','orientation','both'].includes(mode))throw Error('生成モードが不正です。');check(s,mode==='orientation'?2000:500);
    if(s.metadata.cell&&mode!=='orientation')throw Error('周期系の配座変更は分子を切り出し、セルを解除してから実行してください。周期系の配向生成は格子も一緒に回転します。');
    const random=rng(options.seed),g=graph(s),torsions=mode==='orientation'?[]:rotors(s,g),pairs=mode==='orientation'?[]:clashPairs(s,g),original=s.atoms.map(xyz),states=[],signatures=new Set(),start=Date.now();
    const rings=mode!=='orientation'&&options.rings!==false&&MV.RingConformers?MV.RingConformers.moves(s,g):[],ringLimits=rings.length?MV.RingConformers.constraints(original,g):null,ringAngle=Number(options.ringAngle??30);
    if(!Number.isFinite(ringAngle)||ringAngle<1||ringAngle>90)throw Error('環の摂動角は1〜90°にしてください。');
    if(mode==='torsion'&&!torsions.length&&!rings.length)throw Error('変動可能な単結合・環の可動区間がありません。芳香環・小員環・剛直なかご構造は変形対象にならない場合があります。');
    for(let attempt=0;states.length<n&&attempt<n*80&&Date.now()-start<8000;attempt++){
      let p=original.map(v=>v.slice());const angles=[];
      for(const bond of torsions){const axis=sub(p[bond.j],p[bond.i]),d=norm(axis);if(d<1e-8)throw Error('長さ0の結合があり、ねじれ回転できません。');const angle=random()*2*Math.PI;angles.push(Math.round(angle*180/Math.PI/5));for(const i of bond.group)p[i]=add(p[bond.i],rotate(sub(p[i],p[bond.i]),axis.map(v=>v/d),angle));}
      if(rings.length){const changed=MV.RingConformers.perturb(p,rings,ringLimits,pairs,random,ringAngle);p=changed.positions;if(mode==='torsion'&&!torsions.length&&!changed.accepted)continue;}
      if(pairs.some(([i,j,min])=>norm(sub(p[i],p[j]))<min))continue;
      const signature=angles.join(',')+(rings.length?'|'+MV.RingConformers.signature(p,g):'');if(mode==='torsion'&&signatures.has(signature))continue;signatures.add(signature);
      let rotateCell=null;
      if(mode!=='torsion'){const rotation=randomRotation(random),c=s.metadata.cell?[0,0,0]:center(p);p=p.map(v=>add(c,rotation(sub(v,c))));if(s.metadata.cell)rotateCell=P.cell(s.metadata.cell.vectors.map(rotation),s.metadata.cell.pbc);}
      const next=coordinates(s,p,`${s.metadata.title||'Structure'} · random ${states.length+1}`);if(rotateCell)next.metadata.cell=rotateCell;states.push(next);progress(states.length/n);
    }
    if(!states.length)throw Error('衝突を避けた構造を生成できませんでした。元構造の結合と近接原子を確認してください。');
    return {state:series(states,{kind:'random',mode,seed:Number(options.seed)>>>0,rotors:torsions.length,ringMoves:rings.length,ringAngle}),message:`${states.length}構造を生成しました（非環状回転結合 ${torsions.length}本・環の可動区間 ${rings.length}組）。`+(states.length<n?' 衝突・重複または時間上限により指定数に達しませんでした。':'')+(mode==='both'&&!torsions.length&&!rings.length?' この構造では配向のみ変化します。':'')};
  }
  function sameCell(a,b){return !a&&!b||a&&b&&a.pbc.every((v,i)=>v===b.pbc[i])&&a.vectors.every((v,i)=>v.every((x,j)=>Math.abs(x-b.vectors[i][j])<1e-6));}
  // One tangent in Cartesian 3N space, not independent per-atom projections.
  function tangent(images,k){
    const current=images[k].flat(),previous=images[k-1].flat(),forward=images[k+1].flat().map((v,i)=>v-current[i]),backward=current.map((v,i)=>v-previous[i]);
    const nf=norm(forward),nb=norm(backward);let t=forward.map((v,i)=>v/Math.max(nf,1e-15)+backward[i]/Math.max(nb,1e-15)),nt=norm(t);
    if(nt<1e-12){t=nf>nb?forward:backward;nt=norm(t);}return nt<1e-12?null:t.map(v=>v/nt);
  }
  function perpendicular(v,t){if(!t)return v.map(p=>p.slice());const flat=v.flat(),d=dot(flat,t);return v.map((p,i)=>p.map((x,j)=>x-d*t[3*i+j]));}
  function path(a,b,options,progress=()=>{}){
    const n=count(options.count,2),method=options.method||'distance';if(!['linear','distance'].includes(method))throw Error('経路生成方法が不正です。');check(a,method==='linear'?2000:300);check(b,method==='linear'?2000:300);
    if(a.metadata.trajectory||b.metadata.trajectory)throw Error('各端点には1構造を入力してください。');
    if(a.atoms.length!==b.atoms.length)throw Error('始点と終点の原子数が異なります。');a.atoms.forEach((atom,i)=>{if(atom.element!==b.atoms[i].element)throw Error(`File-order ${i+1}: ${atom.element} と ${b.atoms[i].element} が一致しません。原子順序を揃えてください。`);});
    if(!sameCell(a.metadata.cell,b.metadata.cell))throw Error('周期系の経路生成には同じ格子ベクトル・周期方向を持つ2構造が必要です。');
    const cell=a.metadata.cell,delta=(x,y)=>cell?P.minimumImage(sub(x,y),cell).vector:sub(x,y),start=a.atoms.map(xyz),end=b.atoms.map(xyz);
    if(options.minimumImage&&cell)for(let i=0;i<end.length;i++)end[i]=add(start[i],delta(end[i],start[i]));
    const images=Array.from({length:n},(_,k)=>start.map((v,i)=>v.map((x,j)=>x+(end[i][j]-x)*k/(n-1)))),linear=images.map(p=>p.map(v=>v.slice()));let steps=0,maxTangentialStep=0;
    if(method==='distance'&&n>2&&start.some((p,i)=>norm(sub(p,end[i]))>1e-10)){
      const pairs=[];for(let i=0;i<start.length;i++)for(let j=i+1;j<start.length;j++){const d0=norm(delta(start[i],start[j])),d1=norm(delta(end[i],end[j]));if(Math.min(d0,d1)<.05)throw Error('端点に重なった原子があります。端点の座標を修正してください。');pairs.push([i,j,d0,d1]);}
      // Break exact collision symmetry while keeping endpoints untouched.
      const random=rng(options.seed||1),noise=start.map(()=>[random()-.5,random()-.5,random()-.5]);
      for(let k=1;k<n-1;k++){const jitter=perpendicular(noise,tangent(linear,k));for(let i=0;i<start.length;i++)images[k][i]=images[k][i].map((v,j)=>v+.04*Math.sin(Math.PI*k/(n-1))*jitter[i][j]);}
      const evaluate=(p,k,gradient)=>{
        const g=gradient?p.map(()=>[0,0,0]):null;let energy=0;
        for(const [i,j,d0,d1] of pairs){let v=delta(p[i],p[j]),d=norm(v),target=d0+(d1-d0)*k/(n-1),weight=1/Math.max(.5,target)**4;
          if(d<1e-9){v=[.577350269,.577350269,.577350269];d=1e-9;}else v=v.map(x=>x/d);
          const error=d-target;energy+=.5*weight*error*error;if(g)for(let dim=0;dim<3;dim++){const f=weight*error*v[dim];g[i][dim]+=f;g[j][dim]-=f;}
        }
        // Temporal smoothing couples adjacent images, with a weak Cartesian tether.
        for(let i=0;i<p.length;i++)for(let dim=0;dim<3;dim++){const v=p[i][dim],l=v-images[k-1][i][dim],r=v-images[k+1][i][dim],t=v-linear[k][i][dim];energy+=.015*(l*l+r*r)+.00005*t*t;if(g)g[i][dim]+=.03*(l+r)+.0001*t;}
        return {energy,g};
      };
      const time=Date.now();for(;steps<250&&Date.now()-time<6000;steps++){
        let change=0;const updates=images.slice();
        for(let k=1;k<n-1;k++){
          const t=tangent(images,k);if(!t)continue;
          const evaluated=evaluate(images[k],k,true),energy=evaluated.energy,g=perpendicular(evaluated.g,t),max=Math.max(...g.flat().map(Math.abs));let step=Math.min(.8,.08/Math.max(max,1e-9));
          for(let trial=0;trial<8;trial++){const next=images[k].map((p,i)=>p.map((v,j)=>v-step*g[i][j]));if(evaluate(next,k,false).energy<energy){updates[k]=next;change=Math.max(change,max*step);maxTangentialStep=Math.max(maxTangentialStep,Math.abs(dot(g.flat(),t)*step));break;}step*=.5;}
        }
        for(let k=1;k<n-1;k++)images[k]=updates[k];
        if(steps%10===0)progress(Math.min(.95,steps/250));if(change<1e-5)break;
      }
    }
    const states=images.map((p,k)=>{
      const next=coordinates(k===n-1?b:a,p,`Path ${k+1}/${n} · ${k/(n-1)}`);
      if(k>0&&k<n-1){next.bonds=[];next.metadata.manualBondIds=[];next.metadata.suppressedBondKeys=[];B.refreshInferredBonds(next);}return next;
    });
    let closest=Infinity;for(const image of images)for(let i=0;i<image.length;i++)for(let j=i+1;j<image.length;j++)closest=Math.min(closest,norm(delta(image[i],image[j])));
    const info={kind:'path',method,steps,relaxation:method==='distance'?'perpendicular':'none',maxTangentialStep,minimumImage:Boolean(options.minimumImage&&cell),closestDistance:closest};
    return {state:series(states,info),message:`端点を含む${n}構造を生成しました。`+(method==='distance'?` 距離補間を${steps}ステップ調整しました。`:'')+(closest<.6?` 原子間距離が短い箇所（最短 ${closest.toFixed(3)} Å）があります。必ず確認してください。`:'')+' エネルギー未評価の初期推定経路です。'};
  }
  MV.Generation={randomStructures,path,rng,rotors,tangent,perpendicular,graph};
})(window);
