/* Selection-only clipboard. No document, calculation or constraint data is copied. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,M=MV.Model,IO=MV.IO;
  const clone=x=>JSON.parse(JSON.stringify(x));
  function extract(state,selection=state.selectedAtomIds){
    const ids=new Set(selection),atoms=state.atoms.filter(a=>ids.has(a.id)).map(a=>({
      id:a.id,element:a.element,x:a.x,y:a.y,z:a.z,charge:a.charge,mol:a.mol
    }));
    if(!atoms.length)throw Error('コピーする原子を選択してください。');
    const bonds=state.bonds.filter(b=>ids.has(b.atom1)&&ids.has(b.atom2));
    const stereoGroups=(state.metadata.stereoGroups||[]).map(g=>({...g,atomIds:g.atomIds.filter(id=>ids.has(id))})).filter(g=>g.atomIds.length);
    return M.createState({atoms,bonds,metadata:{title:'Copied atoms',stereoGroups}});
  }
  function parse(text){
    if(!text.trim())throw Error('クリップボードに原子団がありません。原子を選択してコピーしてください。');
    if(text.length>10*1024*1024)throw Error('貼り付ける構造は10MB以下にしてください。');
    const parsed=IO.parseAuto(text,/V[23]000/.test(text)?'mol':'xyz');
    if(parsed.metadata.trajectory?.length>1)throw Error('原子団の貼り付けは1構造ずつ行ってください。複数構造は「座標を貼り付け」から読み込めます。');
    return extract(parsed,parsed.atoms.map(a=>a.id));
  }
  function append(target,fragment){
    if(!fragment.atoms.length)throw Error('貼り付ける原子がありません。');
    if(target.atoms.length+fragment.atoms.length>2000)throw Error('貼り付け後の構造は2,000原子以下にしてください。');
    const next=M.cloneState(target),map=new Map(),offset={x:0,y:0,z:0};
    if(next.atoms.length){
      const center=(atoms,key)=>atoms.reduce((sum,a)=>sum+a[key],0)/atoms.length;
      offset.x=Math.max(...next.atoms.map(a=>a.x))+2.5-Math.min(...fragment.atoms.map(a=>a.x));
      offset.y=center(next.atoms,'y')-center(fragment.atoms,'y');
      offset.z=center(next.atoms,'z')-center(fragment.atoms,'z');
    }
    for(const a of fragment.atoms){
      // New atoms have new IDs and no inherited atom mapping or fixed-coordinate flags.
      const mol=a.mol?clone(a.mol):undefined;if(mol){delete mol.index;mol.map=0;}
      const added=M.createAtom({element:a.element,charge:a.charge,mol,x:a.x+offset.x,y:a.y+offset.y,z:a.z+offset.z});
      if(![added.x,added.y,added.z].every(Number.isFinite))throw Error('貼り付け後の座標が範囲外です。');
      next.atoms.push(added);map.set(a.id,added.id);
    }
    const addedBonds=fragment.bonds.map(b=>M.createBond({...b,id:undefined,atom1:map.get(b.atom1),atom2:map.get(b.atom2),source:'manual'}));
    next.bonds.push(...addedBonds);
    next.metadata.manualBondIds=[...(next.metadata.manualBondIds||[]),...addedBonds.map(b=>b.id)];
    const groups=next.metadata.stereoGroups||[],usedTypes=new Set(groups.map(g=>g.type));
    for(const g of fragment.metadata.stereoGroups||[]){
      let type=g.type;const prefix=type.match(/^MDLV30\/(STEREL|STERAC)/)?.[0];
      if(prefix){let i=1;while(usedTypes.has(prefix+i))i++;type=prefix+i;}
      usedTypes.add(type);groups.push({type,atomIds:g.atomIds.map(id=>map.get(id))});
    }
    next.metadata.stereoGroups=groups;
    for(const key of ['externalCalculation','afirCalculation','molSource','sdfProperties'])delete next.metadata[key];
    M.setSelectedAtoms(next,[...map.values()]);M.setSelectedBonds(next,[]);
    return next;
  }
  MV.FragmentClipboard={extract,parse,append};
})(window);
