const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Optimization = require('../optimization.js');
const Trajectory = require('../trajectory.js');
const read = name => fs.readFileSync(path.resolve(__dirname,'..',name),'utf8');
const html = read('index.html');
const code = read('md-ui.js');
const cell = (a=2) => ({vectors:[[a,0,0],[0,a,0],[0,0,a]],pbc:[true,true,true]});
function modern(){
  return {engine:'tblite',modes:['md'],molecularDynamics:{ensembles:['nve','nvt','npt'],
    thermostats:['nose-hoover-chain','langevin','bussi'],barostats:['mc-isotropic'],pressureMeasurement:true}};
}
function fixture(info=modern()){
  const nodes = new Map();
  const $ = id => nodes.get(id);
  for (const tag of html.matchAll(/<[a-z][^>]*\bid="(md\w+|engineMode)"[^>]*>/gi)) {
    const label = {}, listeners = {}, id=tag[1];
    let value=tag[0].match(/\bvalue="([^"]*)"/)?.[1]||'';
    nodes.set(id,{get value(){return value;},set value(v){value=String(v);},checked:/\bchecked\b/.test(tag[0]),
      closest:()=>label, addEventListener(event,fn){listeners[event]=fn;}, input(){listeners.input?.();}});
  }
  for (const id of ['mdEnsemble','mdThermostat','mdVelocitySource']){
    const options = html.split('id="'+id+'"')[1].split('</select>')[0].matchAll(/<option value="([^"]+)"([^>]*)>/g);
    $(id).options=Array.from(options,m=>({value:m[1],selected:m[2].includes('selected')}));
    $(id).value=($(id).options.find(o=>o.selected)||$(id).options[0]).value;
  }
  const frame={atoms:[{},{}],bonds:[],metadata:{cell:cell()}};
  const M={EngineUI:{getConnection:()=>({info})},Optimization,Trajectory,App:{getState:()=>frame}};
  vm.runInNewContext(code,{window:{MoleculeVisualizer:M},document:{getElementById:$}});
  const ui=M.MDUI;
  $('engineMode').value='md';ui.init();ui.sync();
  const request=()=>{
    const data={cell:frame.metadata.cell,mode:'md'};ui.input(data,frame,info);return data;
  };
  function select(id,value){$(id).value=value;$(id).input();ui.sync();}
  return {$,ui,frame,request,select,connect(next){info=next;ui.sync();}};
}

test('NVT defaults to the chain and submits only the selected thermostat fields',()=>{
  const {$,request,select}=fixture();
  assert.equal($('mdEnsemble').value,'nvt');
  assert.equal(request().md.thermostat,'nose-hoover-chain');
  assert.equal(request().md.thermostatTimeFs,100);
  assert.equal($('mdFrictionLabel').hidden,true);
  select('mdThermostat','langevin');
  assert.equal(request().md.frictionPerPs,10);
  assert.equal(request().md.thermostatTimeFs,undefined);
  select('mdTemperature','0');assert.equal(request().md.temperatureK,0);
  select('mdThermostat','bussi');assert.throws(request,/0 K/);
  select('mdEnsemble','nve');assert.equal($('mdThermostatLabel').hidden,true);
  assert.equal(request().md.thermostat,undefined);
  assert.equal(request().md.frictionPerPs,undefined);
});

test('1.21 NVT inputs restore Langevin and re-submit the schema that the old bridge actually supports',()=>{
  const legacy={engine:'tblite',modes:['md'],molecularDynamics:{ensembles:['nve','nvt']}};
  const {$,ui,request,select,connect}=fixture(legacy);
  assert.equal($('mdThermostat').value,'langevin');
  assert.ok($('mdEnsemble').options.find(o=>o.value==='npt').disabled);
  const saved=request();
  assert.equal(saved.md.thermostat,undefined);
  assert.equal(saved.md.frictionPerPs,10);
  connect(modern());assert.equal($('mdThermostat').value,'nose-hoover-chain');
  ui.restore(saved);assert.equal(request().md.thermostat,'langevin');
  select('mdThermostat','nose-hoover-chain');connect(legacy);
  assert.equal($('mdThermostat').value,'nose-hoover-chain');
  assert.throws(request,/熱浴/);
});

test('NPT and recorded fixed-volume pressure require complete periodicity and stress support',()=>{
  const {$,ui,frame,request,select,connect}=fixture();
  select('mdEnsemble','npt');select('mdSteps','5');
  assert.equal(request().md.barostat,'mc-isotropic');
  assert.equal(request().md.pressureBar,1);
  assert.equal(request().md.recordPressure,undefined);
  assert.match($('mdPlan').textContent,/0回試行/);
  select('mdPressure','0');assert.throws(request,/目標圧力/);select('mdPressure','1');
  frame.metadata.cell.pbc[1]=false;ui.sync();assert.throws(request,/3方向/);
  select('mdEnsemble','nvt');assert.ok($('mdRecordPressureLabel').hidden);
  frame.metadata.cell=cell();ui.sync();$('mdRecordPressure').checked=true;
  assert.equal(request().md.recordPressure,true);assert.equal(request().md.pressureBar,undefined);
  const limited=modern();limited.llmlip={models:[]};connect(limited);
  assert.ok($('mdRecordPressureLabel').hidden);
  assert.ok($('mdEnsemble').options.find(o=>o.value==='npt').disabled);
});

test('isotropic NPT results retain actual per-sample dimensions and reject partial or incompatible data',()=>{
  const {ui,select,request}=fixture();
  select('mdEnsemble','npt');select('mdSteps','2');
  const input=request(), images=[[[0,0,0]],[[.1,0,0]]];
  input.images=[images[0]];
  const trajectory={images,energies:[-1,-.5],kineticEV:[.2,.2],totalEV:[-.8,-.3],temperatureK:[200,200],
    stepNumbers:[0,2],timeFs:[0,1],cells:[cell(2),cell(3)],volumeA3:[8,27],pressureBar:[-4,0]};
  const result={mode:'md',md:input.md,symbols:['H'],trajectory,images:[images[1]],energies:[-.5],steps:2,
    reason:'completed',units:{time:'fs',velocity:'angstrom/fs',temperature:'K',volume:'angstrom^3',pressure:'bar'},
    velocitiesAngstromPerFs:[[0,0,0]],cells:[cell(3)],cell:cell(3),pressureBar:0,volumeA3:27};
  ui.validate(result,input);
  assert.equal(ui.thermalValues(trajectory,1).pressureBar,0);
  const xyz=Trajectory.xyz({...trajectory,symbols:result.symbols,kind:'md',md:trajectory},[0,1]);
  assert.match(xyz,/volume_A3=8 pressure_bar=-4.*Lattice="2 0 0 0 2 0 0 0 2"/);
  assert.match(xyz,/volume_A3=27 pressure_bar=0.*Lattice="3 0 0 0 3 0 0 0 3"/);
  const check=modify=>{const r=structuredClone(result);modify(r);assert.throws(()=>ui.validate(r,input));};
  check(r=>{r.trajectory.pressureBar=[0];});
  check(r=>{r.trajectory.cells[0]=cell(4);});
  check(r=>{r.trajectory.cells[1].vectors[1][0]=2;r.cell=r.trajectory.cells[1];r.cells=[r.cell];});
  check(r=>{r.trajectory.volumeA3[1]=28;r.volumeA3=28;});
  check(r=>{r.cell=cell(2);});
  check(r=>{r.units.pressure='GPa';});
});
