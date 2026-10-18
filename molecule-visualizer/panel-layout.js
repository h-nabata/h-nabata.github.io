(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer=global.MoleculeVisualizer||{};
  function init(){
    document.querySelectorAll('[data-workspace-jump]').forEach(button=>{
      button.addEventListener('click',()=>{
        const kind=button.dataset.workspaceJump;
        if(kind==='afir'){
          const panel=document.getElementById('afirPanel');
          if(panel.hidden)document.getElementById('btnAFIR').click();
          if(!panel.hidden){panel.scrollIntoView({block:'nearest',behavior:'smooth'});document.getElementById('afirName').focus({preventScroll:true});}
        }else{
          if(kind==='editing'&&!document.getElementById('afirPanel').hidden)document.getElementById('afirClose').click();
          const target=document.getElementById(kind==='coordinates'?'dataText':'tab-atoms');
          if(kind==='editing')target.click();
          target.scrollIntoView({block:'nearest',behavior:'smooth'});target.focus({preventScroll:true});
        }
      });
    });
    document.querySelectorAll('.mv-scroll-panel').forEach(panel=>{
      panel.querySelectorAll('[data-panel-size]').forEach(button=>{
        button.addEventListener('click',()=>{
          if(button.dataset.panelSize==='reset'){
            panel.style.removeProperty('height');
            return;
          }
          const css=global.getComputedStyle(panel),min=parseFloat(css.minHeight)||240;
          const max=Math.max(min,parseFloat(css.maxHeight)||global.innerHeight);
          const height=panel.getBoundingClientRect().height+Number(button.dataset.panelSize);
          panel.style.height=Math.max(min,Math.min(max,height))+'px';
        });
      });
    });
  }
  MV.PanelLayout={init};
})(window);
