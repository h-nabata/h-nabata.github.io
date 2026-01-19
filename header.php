<header class="header">
    <div class="header-left">
        <a href="https://h-nabata.github.io/"><img class="logo" src="https://h-nabata.github.io/img/favicon_candle.png" alt="Logo"></a>
        &nbsp;&nbsp;<span id="todaysdate"></span>&nbsp;(<span id="dayofweek"></span>)
    </div>
    <?php if (!empty($extra_menu_html)) { ?>
        <?php echo $extra_menu_html; ?>
    <?php } ?>
    <div class="menu-icon gaming" onclick="toggleMenu('menu-main')">&#9776;</div>
    <div id="menu-main" class="header-right dropdown-menu">
        <a href="https://h-nabata.github.io/index.html">トップページ - Top Page</a>
        <a href="https://h-nabata.github.io/toc.html">目次 - Table of Contents</a>
    </div>
  <script type="text/javascript">
      function showDate() {
          var now = new Date();
          var year = now.getFullYear();
          var month = now.getMonth() + 1; // 月は0から始まるので1を足す
          var day = now.getDate();
          return year + "/" + month + "/" + day;
      }

      function showDayOfWeek() {
          var weeks = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          var now = new Date();
          var weekdays = now.getDay();
          return weeks[weekdays];
      }

      document.addEventListener("DOMContentLoaded", function() {
          document.getElementById("todaysdate").innerHTML = showDate();
          document.getElementById("dayofweek").innerHTML = showDayOfWeek();
      });
  </script>

  <script>
      document.addEventListener('DOMContentLoaded', (event) => {
          document.querySelectorAll('pre code').forEach((block) => {
              hljs.highlightBlock(block);
          });
      });

      function toggleMenu(menuId) {
          const menu = menuId ? document.getElementById(menuId) : document.querySelector('.dropdown-menu');
          if (!menu) {
              return;
          }
          if (menu.style.display === 'flex') {
              menu.style.display = 'none';
          } else {
              menu.style.display = 'flex';
          }
      }
  </script>
  
</header>
