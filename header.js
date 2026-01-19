function showDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 月は0から始まるので1を足す
  const day = now.getDate();
  return `${year}/${month}/${day}`;
}

function showDayOfWeek() {
  const weeks = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();
  const weekdays = now.getDay();
  return weeks[weekdays];
}

function toggleMenu(menuId) {
  const menu = menuId
    ? document.getElementById(menuId)
    : document.querySelector(".dropdown-menu");
  if (!menu) {
    return;
  }
  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

function initHeader() {
  const todaysDate = document.getElementById("todaysdate");
  const dayOfWeek = document.getElementById("dayofweek");
  if (todaysDate) {
    todaysDate.innerHTML = showDate();
  }
  if (dayOfWeek) {
    dayOfWeek.innerHTML = showDayOfWeek();
  }
  if (typeof hljs !== "undefined") {
    hljs.highlightAll();
  }
  if (typeof renderMathInElement !== "undefined") {
    renderMathInElement(document.body);
  }
}

function onDomReady() {
  return new Promise((resolve) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    } else {
      resolve();
    }
  });
}

function getAssetBaseUrl() {
  if (document.currentScript && document.currentScript.src) {
    return new URL(".", document.currentScript.src);
  }
  return new URL("/", window.location.origin);
}

function ensureStylesheet(url, id) {
  if (document.getElementById(id)) {
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

function ensureLinkIcon(url, rel, id, sizes) {
  if (document.getElementById(id)) {
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = rel;
  link.href = url;
  if (sizes) {
    link.sizes = sizes;
  }
  document.head.appendChild(link);
}

function loadScriptSequential(urls) {
  return urls.reduce((promise, url) => {
    return promise.then(() => {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${url}`));
        document.head.appendChild(script);
      });
    });
  }, Promise.resolve());
}

function loadSharedHeader(options = {}) {
  const extraMenuHtml = options.extraMenuHtml || "";
  const baseUrl = getAssetBaseUrl();
  const headerUrl = options.headerPath
    ? new URL(options.headerPath, window.location.href)
    : new URL("header.html", baseUrl);

  ensureStylesheet(
    "https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.css",
    "shared-katex-css"
  );
  ensureStylesheet(
    "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/default.min.css",
    "shared-hljs-css"
  );
  ensureStylesheet(
    "https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css",
    "shared-font-awesome"
  );
  ensureStylesheet(
    new URL("stylesheet.css", baseUrl).toString(),
    "shared-site-css"
  );
  ensureLinkIcon(
    new URL("img/favicon.ico", baseUrl).toString(),
    "icon",
    "shared-favicon"
  );
  ensureLinkIcon(
    new URL("img/favicon_candle.png", baseUrl).toString(),
    "apple-touch-icon",
    "shared-apple-touch-icon",
    "180x180"
  );

  return fetch(headerUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${headerUrl}`);
      }
      return response.text();
    })
    .then((html) => {
      const headerHost = document.getElementById("site-header");
      if (headerHost) {
        headerHost.innerHTML = html;
        const extraMenu = document.getElementById("extra-menu");
        if (extraMenu && extraMenuHtml) {
          extraMenu.innerHTML = extraMenuHtml;
        }
      }
      return onDomReady();
    })
    .then(() => {
      const scripts = [
        "https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.js",
        "https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/contrib/auto-render.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/languages/go.min.js",
      ];
      return loadScriptSequential(scripts);
    })
    .then(() => {
      initHeader();
    })
    .catch((error) => {
      console.error("Shared header load failed:", error);
    });
}
