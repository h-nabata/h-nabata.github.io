(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer=global.MoleculeVisualizer||{};
  function initViewerHeight(){
    const shell=document.querySelector('.mv-viewer-shell'),handle=document.getElementById('viewerResizeHandle');
    const storageKey='molecule-studio-viewer-height-v1',min=160,max=1600;
    const stage=shell.closest('.mv-stage'),workspace=stage.closest('.mv-workspace'),frames=stage.querySelector('.mv-trajectory');
    let drag=null;
    function sync(){
      const height=Math.round(shell.getBoundingClientRect().height);
      handle.setAttribute('aria-valuenow',height);
      handle.setAttribute('aria-valuetext',height+'ピクセル');
    }
    function fitAutomaticHeight(){
      // Measure the actual wrapped toolbars rather than assuming a fixed number
      // of rows. Document-flow coordinates keep scrolling from resizing canvas.
      if(global.innerWidth<=800){shell.style.removeProperty('--mv-auto-viewer-limit');return;}
      const fullscreen=document.fullscreenElement;
      const flowTop=workspace.getBoundingClientRect().top+(fullscreen?fullscreen.scrollTop:(global.scrollY||0))-(fullscreen?fullscreen.getBoundingClientRect().top:0);
      const leading=shell.getBoundingClientRect().top-stage.getBoundingClientRect().top;
      const available=Math.floor(global.innerHeight-flowTop-leading-frames.getBoundingClientRect().height-12);
      const limit=Math.max(min,Math.min(max,available))+'px';
      if(shell.style.getPropertyValue('--mv-auto-viewer-limit')!==limit)shell.style.setProperty('--mv-auto-viewer-limit',limit);
    }
    function setHeight(value,persist=true){
      if(!Number.isFinite(value))return;
      const height=Math.round(Math.max(min,Math.min(max,value)));
      shell.style.height=height+'px';
      shell.classList.add('mv-custom-height');
      sync();
      if(persist)try{global.localStorage.setItem(storageKey,String(height));}catch(error){/* Resizing also works without storage. */}
    }
    function reset(){
      shell.classList.remove('mv-custom-height');
      shell.style.removeProperty('height');
      try{global.localStorage.removeItem(storageKey);}catch(error){/* Storage may be disabled. */}
      fitAutomaticHeight();
      sync();
    }
    try{
      const saved=global.localStorage.getItem(storageKey),height=Number(saved);
      if(saved&&Number.isFinite(height)&&height>=min&&height<=max)setHeight(height,false);
    }catch(error){/* Keep the responsive default if storage is unavailable. */}
    document.querySelectorAll('[data-viewer-size]').forEach(button=>{
      button.addEventListener('click',()=>{
        if(button.dataset.viewerSize==='reset')reset();
        else setHeight(shell.getBoundingClientRect().height+Number(button.dataset.viewerSize));
      });
    });
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0||drag)return;
      e.preventDefault();handle.focus({preventScroll:true});
      drag={id:e.pointerId,y:e.clientY,height:shell.getBoundingClientRect().height};
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove',e=>{
      if(drag&&e.pointerId===drag.id)setHeight(drag.height+e.clientY-drag.y,false);
    });
    function finish(e){
      if(!drag||e.pointerId!==drag.id)return;
      const id=drag.id;drag=null;
      setHeight(shell.getBoundingClientRect().height);
      if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
    }
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>handle.addEventListener(type,finish));
    handle.addEventListener('keydown',e=>{
      if(!['ArrowUp','ArrowDown','Home','End','Enter'].includes(e.key))return;
      e.preventDefault();
      if(e.key==='Enter')reset();
      else setHeight(e.key==='Home'?min:e.key==='End'?max:shell.getBoundingClientRect().height+(e.key==='ArrowUp'?-1:1)*(e.shiftKey?80:20));
    });
    if(global.ResizeObserver){
      new global.ResizeObserver(sync).observe(shell);
      const layoutObserver=new global.ResizeObserver(fitAutomaticHeight);
      document.querySelectorAll('.mv-page-buffer, .mv-app-header, .mv-document, .mv-stage-heading, .mv-stage-toolbar, .mv-calculation-controls, .mv-display-controls, .mv-trajectory').forEach(element=>layoutObserver.observe(element));
    }
    global.addEventListener('resize',fitAutomaticHeight);
    document.addEventListener('fullscreenchange',fitAutomaticHeight);
    fitAutomaticHeight();
    sync();
  }
  function init(){
    initViewerHeight();
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
