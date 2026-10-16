(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer=global.MoleculeVisualizer||{};
  function init(){
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
