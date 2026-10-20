const test=require('node:test'),assert=require('node:assert/strict'),D=require('../diagnostics-ui.js');
test('NEB component energies refer to the same highest physical energy node',()=>{
 const p=D.normalize({step:2,fmax:.08,energies:[-7,-5,-8],energyComponents:{uma:[-6,-4,-7],solvation:[-1,-1,-1]},diagnostics:{rmsForce:.02,componentFmax:{spring:.03,climbingCorrection:.1}}},'cineb');
 assert.equal(p.energy,-5);assert.equal(p.uma+p.solvation,p.energy);assert.equal(p.rmsForce,.02);assert.equal(p.components.spring,.03);assert.equal(p.bias,null);assert.equal(p.total,null);
});
test('AFIR physical, artificial and total energies stay separate',()=>{
 const rows=D.fromResult({mode:'afir',energies:[-4,-3],biasEnergies:[2,1],imageFmax:[.2,.1],physicalFmax:[.3,.4],energyComponents:{uma:[-3,-2],solvation:[-1,-1]}});
 assert.equal(rows[0].energy,-4);assert.equal(rows[0].bias,2);assert.equal(rows[0].total,-2);assert.equal(rows[0].uma,-3);assert.equal(rows[1].physicalFmax,.4);
});
test('unavailable/nonfinite components remain absent instead of appearing as zero',()=>{
 const p=D.normalize({step:0,fmax:.1,diagnostics:{componentFmax:{spring:0,uma:NaN}}},'optimize');assert.equal(p.rmsForce,null);assert.equal(p.uma,null);assert.deepEqual(p.components,{spring:0});
 assert.equal(D.normalize({phase:'loading_model'}),null);assert.equal(D.energyRows({energies:[1]})[0].solvation,null);
});
test('separate IRC directions and scan nodes do not share history keys',()=>{
 assert.notEqual(D.normalize({step:1,direction:'forward'}).key,D.normalize({step:1,direction:'reverse'}).key);
 assert.notEqual(D.normalize({step:1,node:0}).key,D.normalize({step:1,node:1}).key);
});
test('perpendicular force is not mislabeled as the removed tangent force',()=>{
 const p=D.normalize({step:1,diagnostics:{perpendicularMax:.2,componentFmax:{tangentRemoval:.7}}},'cineb');assert.equal(p.components.perpendicular,.2);assert.equal(p.components.tangentRemoval,.7);
});
test('LUP energy follows the highest node and redistribution remains a displacement metric',()=>{
 const p=D.normalize({step:9,energies:[-8,-4,-7],energyComponents:{uma:[-6,-2,-5],solvation:[-2,-2,-2]},diagnostics:{redistributionResidual:.003,redistributionMove:.001,cacheHits:12}},'lup');
 assert.equal(p.energy,-4);assert.equal(p.uma+p.solvation,p.energy);assert.equal(p.redistributionResidual,.003);assert.equal(p.redistributionMove,.001);assert.equal(p.cacheHits,12);assert.deepEqual(p.components,{});assert.equal(D.normalize({step:1},'lup').redistributionResidual,null);
});
