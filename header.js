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
