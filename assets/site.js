document.addEventListener('DOMContentLoaded', () => {
  if (typeof initHeader === 'function') {
    initHeader();
  }

  if (window.hljs && typeof window.hljs.highlightAll === 'function') {
    document.querySelectorAll('pre code').forEach(el => { if (!el.closest('#mirror-article')) window.hljs.highlightElement(el); });
  }

  if (typeof window.renderMathInElement === 'function') {
    window.renderMathInElement(document.body, { ignoredClasses: ['mirror-main'] });
  }
});
