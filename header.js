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
    document.querySelectorAll("pre code").forEach((block) => {
      hljs.highlightBlock(block);
    });
  }
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

function appendHeadNodes(template) {
  const nodes = Array.from(template.content.childNodes);
  const scriptLoads = [];
  nodes.forEach((node) => {
    if (node.nodeName === "SCRIPT") {
      const script = document.createElement("script");
      Array.from(node.attributes).forEach((attr) => {
        script.setAttribute(attr.name, attr.value);
      });
      if (node.textContent) {
        script.textContent = node.textContent;
      }
      if (script.src) {
        scriptLoads.push(
          new Promise((resolve) => {
            script.addEventListener("load", resolve);
            script.addEventListener("error", resolve);
          })
        );
      }
      document.head.appendChild(script);
    } else {
      document.head.appendChild(node.cloneNode(true));
    }
  });
  return Promise.all(scriptLoads);
}

function loadSharedHeader(options = {}) {
  const headerPath = options.headerPath || "header.html";
  const extraMenuHtml = options.extraMenuHtml || "";
  return fetch(headerPath)
    .then((response) => response.text())
    .then((html) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const headTemplate = doc.getElementById("shared-head");
      const headerTemplate = doc.getElementById("shared-header");
      if (!headTemplate || !headerTemplate) {
        return;
      }
      return appendHeadNodes(headTemplate).then(() => {
        const headerHost = document.getElementById("site-header");
        if (headerHost) {
          headerHost.innerHTML = "";
          headerHost.appendChild(headerTemplate.content.cloneNode(true));
          const extraMenu = document.getElementById("extra-menu");
          if (extraMenu && extraMenuHtml) {
            extraMenu.innerHTML = extraMenuHtml;
          }
        }
        initHeader();
      });
    });
}
