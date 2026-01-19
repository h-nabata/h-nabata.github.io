document.addEventListener('DOMContentLoaded', () => {
  if (typeof initHeader === 'function') {
    initHeader();
  }

  if (window.hljs && typeof window.hljs.highlightAll === 'function') {
    window.hljs.highlightAll();
  }

  if (typeof window.renderMathInElement === 'function') {
    window.renderMathInElement(document.body);
  }
});
