document.addEventListener('DOMContentLoaded', () => {
  if (typeof initHeader === 'function') {
    initHeader();
  }

  if (window.hljs && typeof window.hljs.highlightAll === 'function') {
    document.querySelectorAll('pre code').forEach(el => { if (!el.closest('#mirror-article')) window.hljs.highlightElement(el); });
  }

  if (typeof window.renderMathInElement === 'function') {
    const options = { ignoredClasses: ['mirror-main'] };
    if (document.getElementById('home-content')) {
      options.delimiters = [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false }
      ];
    }
    window.renderMathInElement(document.body, options);
  }
});
