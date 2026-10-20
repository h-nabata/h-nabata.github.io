/* Proper rigid alignment. No reflections, atom permutations or input mutation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else(root.MoleculeVisualizer=root.MoleculeVisualizer||{}).StructureAnalysis=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function coordinates(values){
    if(!Array.isArray(values)||!values.length||values.length>500||values.some(p=>!Array.isArray(p)||p.length!==3||p.some(x=>!Number.isFinite(x)||Math.abs(x)>10000)))throw Error('比較する構造は1〜500原子、有限なXYZ座標にしてください。');
    return values;
  }
  function correspondence(n,options){
    const {referenceSymbols,mobileSymbols,referenceIds,mobileIds}=options;
    for(const values of [referenceSymbols,mobileSymbols])if(values&&(values.length!==n||values.some(x=>typeof x!=='string')))throw Error('元素と座標の数が一致しません。');
    for(const values of [referenceIds,mobileIds])if(values&&(values.length!==n||new Set(values).size!==n))throw Error('原子IDが重複しているか、座標の数と一致しません。');
    const lookup=mobileIds?new Map(mobileIds.map((id,i)=>[id,i])):null;
    const sameIds=referenceIds&&lookup&&referenceIds.every(id=>lookup.has(id));
    const mapping=Array.from({length:n},(_,i)=>sameIds?lookup.get(referenceIds[i]):i);
    if(referenceSymbols&&mobileSymbols&&mapping.some((j,i)=>referenceSymbols[i]!==mobileSymbols[j]))throw Error('原子の元素と対応が一致しません。原子の並べ替えは自動推測しません。');
    return {mapping,correspondence:sameIds?'stableIds':'fileOrder'};
  }
  // Symmetric Jacobi diagonalization avoids the degeneracy failure of power iteration.
  function largestEigenvector(matrix){
    const a=matrix.map(r=>r.slice()),v=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>Number(i===j)));
    for(let iteration=0;iteration<80;iteration++){
      let p=0,q=1,off=0;
      for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)if(Math.abs(a[i][j])>off){off=Math.abs(a[i][j]);p=i;q=j;}
      if(off<1e-14*Math.max(1,...a.map((r,i)=>Math.abs(r[i]))))break;
      const theta=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(theta),s=Math.sin(theta),pp=a[p][p],qq=a[q][q],pq=a[p][q];
      for(let k=0;k<4;k++)if(k!==p&&k!==q){const kp=a[k][p],kq=a[k][q];a[k][p]=a[p][k]=c*kp-s*kq;a[k][q]=a[q][k]=s*kp+c*kq;}
      a[p][p]=c*c*pp-2*s*c*pq+s*s*qq;a[q][q]=s*s*pp+2*s*c*pq+c*c*qq;a[p][q]=a[q][p]=0;
      for(let k=0;k<4;k++){const kp=v[k][p],kq=v[k][q];v[k][p]=c*kp-s*kq;v[k][q]=s*kp+c*kq;}
    }
    let k=0;for(let i=1;i<4;i++)if(a[i][i]>a[k][k])k=i;
    const out=v.map(r=>r[k]),norm=Math.hypot(...out);return out.map(x=>x/norm);
  }
  function align(reference,mobile,options={}){
    coordinates(reference);coordinates(mobile);if(reference.length!==mobile.length)throw Error('比較する構造の原子数が一致しません。');
    const n=reference.length,{mapping,correspondence:kind}=correspondence(n,options);
    const indices=options.indices||Array.from({length:n},(_,i)=>i).filter(i=>options.selection!=='heavy'||options.referenceSymbols?.[i]!=='H');
    if(!indices.length||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=n))throw Error('重ね合わせる原子を1個以上選択してください。');
    if(options.selection==='heavy'&&!options.referenceSymbols)throw Error('重原子の選択には元素情報が必要です。');
    const a=[0,0,0],b=[0,0,0];
    for(const i of indices)for(let k=0;k<3;k++){a[k]+=reference[i][k]/indices.length;b[k]+=mobile[mapping[i]][k]/indices.length;}
    const s=Array.from({length:3},()=>[0,0,0]);
    for(const i of indices)for(let j=0;j<3;j++)for(let k=0;k<3;k++)s[j][k]+=(mobile[mapping[i]][j]-b[j])*(reference[i][k]-a[k]);
    const [[xx,xy,xz],[yx,yy,yz],[zx,zy,zz]]=s;
    const q=largestEigenvector([[xx+yy+zz,yz-zy,zx-xz,xy-yx],[yz-zy,xx-yy-zz,xy+yx,zx+xz],[zx-xz,xy+yx,-xx+yy-zz,yz+zy],[xy-yx,zx+xz,yz+zy,-xx-yy+zz]]);
    const [w,x,y,z]=q,rotation=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
    const translation=a.map((value,k)=>value-rotation[k].reduce((sum,r,j)=>sum+r*b[j],0));
    const positions=mobile.map(p=>rotation.map((row,k)=>translation[k]+row.reduce((sum,r,j)=>sum+r*p[j],0)));
    const deviations=reference.map((p,i)=>Math.hypot(...p.map((x,k)=>x-positions[mapping[i]][k])));
    return {positions,rotation,translation,quaternion:q,mapping,correspondence:kind,indices:indices.slice(),rmsd:Math.sqrt(indices.reduce((sum,i)=>sum+deviations[i]**2,0)/indices.length),allAtomRMSD:Math.sqrt(deviations.reduce((sum,x)=>sum+x*x,0)/n),maxDeviation:Math.max(...deviations),deviations};
  }
  function deduplicate(images,options={}){
    if(!Array.isArray(images)||!images.length||images.length>500)throw Error('重複判定は1〜500構造にしてください。');
    const threshold=options.threshold??.1;if(!Number.isFinite(threshold)||threshold<0||threshold>10)throw Error('RMSD閾値は0〜10 Åにしてください。');
    const n=images.length,energies=options.energies||[],keys=options.conditionKeys||[];
    if(energies.length&&energies.length!==n||keys.length&&keys.length!==n||options.energyComparable&&options.energyComparable.length!==n)throw Error('エネルギー・計算条件と構造数が一致しません。');
    images.forEach(coordinates);
    const groups=new Map();for(let i=0;i<n;i++){const key=keys[i]??null;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
    const clusters=[];
    for(const [conditionKey,ids] of groups){
      const energyComparable=conditionKey!==null&&ids.every(i=>Number.isFinite(energies[i])&&options.energyComparable?.[i]!==false);
      if(energyComparable)ids.sort((a,b)=>energies[a]-energies[b]||a-b);
      const local=[];
      for(const i of ids){
        let match=null,rmsd=0;
        for(const cluster of local){
          const r=cluster.representative;
          const aligned=align(images[r],images[i],{referenceSymbols:options.symbolsByFrame?.[r]||options.symbols,mobileSymbols:options.symbolsByFrame?.[i]||options.symbols,referenceIds:options.atomIdsByFrame?.[r],mobileIds:options.atomIdsByFrame?.[i],selection:options.selection,indices:options.indices});
          if(aligned.rmsd<=threshold+1e-10){match=cluster;rmsd=aligned.rmsd;break;}
        }
        if(match){match.members.push(i);match.rmsds.push(rmsd);}else{const cluster={representative:i,members:[i],rmsds:[0],conditionKey,energyComparable};local.push(cluster);clusters.push(cluster);}
      }
    }
    clusters.sort((a,b)=>Math.min(...a.members)-Math.min(...b.members));
    return {clusters,representatives:clusters.map(c=>c.representative),threshold,selection:options.selection||'all',algorithm:'energy-ordered-leader',count:n};
  }
  return {align,deduplicate};
});
