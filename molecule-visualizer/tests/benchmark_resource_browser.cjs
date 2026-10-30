// CI fetches this public baseline commit; no private structures or user data.
const {chromium}=require('playwright'),{execFileSync}=require('node:child_process'),fs=require('node:fs');
(async()=>{
 const baseline=execFileSync('git',['show','0b1ce3a38659c588d1f60c224c87ef73da1e5eca:molecule-visualizer/renderer3dmol.js'],{encoding:'utf8'});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  const rows=await page.evaluate(async baseline=>{
   const M=MoleculeVisualizer,after=M.Renderer3DMol;(0,eval)(baseline);const before=M.Renderer3DMol;M.Renderer3DMol=after;
   const rows=[];
   for(const periodic of [false,true]){
    const atoms=Array.from({length:1000},(_,i)=>({id:'a'+i,element:i%3?'C':'H',x:(i%20)*1.3,y:Math.floor(i/20)%20*1.3,z:Math.floor(i/400)*1.3}));
    const bonds=atoms.slice(1).map((a,i)=>({id:'b'+i,atom1:atoms[i].id,atom2:a.id,source:'manual'}));
    const state=M.Model.createState({atoms,bonds,metadata:{cell:periodic?{vectors:[[28,0,0],[3,28,0],[1,2,28]],pbc:[true,true,true]}:null}});
    for(const [label,Renderer] of [['before',before],['after',after]]){
     const div=document.createElement('div');div.id='measure-'+label+'-'+periodic;div.style.cssText='position:fixed;left:0;top:0;width:900px;height:650px;z-index:10000';document.body.append(div);
     const r=new Renderer(div.id);r.renderState(state,false);const samples=[];
     for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);r.rollCamera(.005);const start=performance.now();r.draw();if(i>=10)samples.push(performance.now()-start);}
     samples.sort((a,b)=>a-b);rows.push({periodic,label,medianDrawMS:samples[25],atoms:r.projectedAtoms.length,sprites:r.atomSprites?.size||0});div.remove();
    }
   }return rows;
  },baseline);
  fs.writeFileSync('test-artifacts/resource-render-benchmark.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
