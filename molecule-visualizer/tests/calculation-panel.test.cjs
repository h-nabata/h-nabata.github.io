const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../calculation-panel.js'),'utf8');

function fixture(){
  const elements=new Map();
  const document={getElementById:id=>elements.get(id),activeElement:null};
  for(const tag of html.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/gi)){
    const events=new Map(),id=tag[1];
    elements.set(id,{
      id,dataset:{},textContent:'',hidden:/\shidden\b/.test(tag[0]),
      addEventListener(type,fn){events.set(type,fn);},
      fire(type,event={}){events.get(type)?.(event);},
      focus(){document.activeElement=this;},
      setAttribute(key,value){this[key]=value;},
      removeAttribute(){},contains(node){return node?.panel===this.id;}
    });
  }
  const $=document.getElementById;
  $('engineDialog').open=true;$('engineMode').value='dsafir';$('engineMode').selectedOptions=[{textContent:'DS-AFIR'}];
  let connection=null,job=false,result=null;
  const M={EngineUI:{getConnection:()=>connection,isBusy:()=>job,getResult:()=>result,modeLabel:mode=>mode.toUpperCase()},
    App:{getState:()=>({atoms:[{}],metadata:{}})}};
  vm.runInNewContext(script,{window:{MoleculeVisualizer:M},document});
  M.CalculationPanel.init();
  return {$,document,P:M.CalculationPanel,connect(){connection={info:{engine:'tblite',method:'GFN2-xTB'}};},
    run(){job=true;M.CalculationPanel.beginJob('cineb');},finish(){result={result:{mode:'cineb'}};job=false;$('engineResult').hidden=false;M.CalculationPanel.completed();}};
}

test('calculation panes preserve focus order, method selection and accessible connection actions',()=>{
  const {$,P,document,connect}=fixture();
  assert.equal($('engineTabSetup')['aria-selected'],'true');
  assert.equal($('enginePanelConnect').hidden,false);assert.equal($('engineRun').hidden,true);
  $('enginePanelConnect').fire('click');
  assert.equal(document.activeElement,$('engineTabConnection'));
  assert.equal($('enginePaneSetup').hidden,true);
  let prevented=false;
  $('engineTabConnection').fire('keydown',{key:'End',preventDefault(){prevented=true;}});
  assert.ok(prevented);assert.equal(document.activeElement,$('engineTabResults'));
  assert.equal($('engineTabSetup').tabIndex,-1);
  assert.equal($('engineResultsEmpty').hidden,false);
  connect();P.show('setup');
  assert.equal($('enginePanelConnect').hidden,true);assert.equal($('engineRun').hidden,false);
  assert.equal($('engineMode').value,'dsafir');
});

test('a finished job keeps a queued draft in view; an undisturbed form opens the result',()=>{
  const {$,P,document,run,finish}=fixture();
  run();$('enginePaneSetup').fire('input');finish();
  assert.equal($('enginePaneSetup').hidden,false);assert.equal($('engineTabResults').dataset.newResult,'true');
  P.show('setup');run();
  document.activeElement={panel:'enginePaneSetup'};finish();
  assert.equal($('enginePaneResults').hidden,false);assert.equal(document.activeElement,$('engineTabResults'));
  assert.equal($('engineResultsEmpty').hidden,true);
});
