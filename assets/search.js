(() => {
  const root = document.querySelector(".site-search");
  const form = document.getElementById("site-search-form");
  const input = document.getElementById("site-search-query");
  const status = document.getElementById("site-search-status");
  const results = document.getElementById("site-search-results");
  if (!root || !form || !input || !status || !results) return;

  const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, " ").trim();
  const params = new URLSearchParams(window.location.search);
  input.value = params.get("q") || "";
  let pages = [];

  const makeText = (tag, text, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  };

  const countOccurrences = (text, term) => {
    if (!term) return 0;
    let count = 0;
    let position = 0;
    while ((position = text.indexOf(term, position)) !== -1 && count < 10) {
      count += 1;
      position += term.length;
    }
    return count;
  };

  const makeSnippet = (page, terms) => {
    const text = page.content || "";
    let position = -1;
    for (const term of terms) {
      const found = text.indexOf(term);
      if (found >= 0 && (position < 0 || found < position)) position = found;
    }
    if (position < 0) return text.slice(0, 220) + (text.length > 220 ? "…" : "");
    const start = Math.max(0, position - 90);
    const end = Math.min(text.length, position + 150);
    return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  };

  const search = () => {
    const rawQuery = input.value.trim();
    const query = normalize(rawQuery);
    const terms = query.split(" ").filter(Boolean);
    results.replaceChildren();
    const url = new URL(window.location.href);
    if (rawQuery) url.searchParams.set("q", rawQuery);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);

    if (!terms.length) {
      status.textContent = pages.length + "ページを検索できます。キーワードを入力してください。";
      return;
    }

    const matches = [];
    for (const page of pages) {
      const title = normalize(page.title || "");
      const body = normalize(page.content || "");
      if (!terms.every((term) => title.includes(term) || body.includes(term))) continue;
      let score = title.includes(query) ? 100 : 0;
      for (const term of terms) {
        if (title.includes(term)) score += 30;
        score += Math.min(10, countOccurrences(body, term)) * 2;
      }
      matches.push({ page, score });
    }
    matches.sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title, "ja"));

    const shown = matches.slice(0, 50);
    status.textContent = matches.length
      ? matches.length + "件見つかりました" + (matches.length > shown.length ? "（上位50件を表示）" : "") + "。"
      : "該当するページは見つかりませんでした。";
    for (const match of shown) {
      const item = document.createElement("li");
      const heading = document.createElement("h2");
      const link = document.createElement("a");
      link.textContent = match.page.title || match.page.url;
      const jumpTerm = terms.slice().sort((a, b) => b.length - a.length)[0];
      link.href = match.page.url + (jumpTerm ? "#:~:text=" + encodeURIComponent(jumpTerm) : "");
      heading.append(link);
      item.append(heading);
      const snippet = makeSnippet(match.page, terms);
      if (snippet) item.append(makeText("p", snippet));
      results.append(item);
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    search();
  });
  input.addEventListener("input", search);

  fetch(root.dataset.searchIndex, { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    })
    .then((data) => {
      pages = data.map((page) => ({
        ...page,
        title: page.title || "",
        content: normalize(page.content || "")
      }));
      search();
    })
    .catch(() => {
      status.textContent = "検索索引を読み込めませんでした。時間をおいて再読み込みしてください。";
    });
})();
