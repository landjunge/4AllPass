/* Renders site/produkte.json. No network except that JSON. */
(function () {
  const root = document.querySelector("[data-products]");
  if (!root) return;

  const lang = root.getAttribute("data-lang") === "de" ? "de" : "en";
  const src = root.getAttribute("data-src") || "produkte.json";
  const pick = (obj) => (obj && (obj[lang] || obj.en || obj.de)) || "";

  const label = {
    de: { source: "Quelle", fallback: "Fallback", suite: "Hub" },
    en: { source: "Source", fallback: "Fallback", suite: "Hub" },
  }[lang];

  fetch(src)
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then((data) => {
      const note = document.querySelector("[data-products-note]");
      if (note && data.note) note.textContent = pick(data.note);

      root.replaceChildren();
      for (const item of data.products || []) {
        const article = document.createElement("article");
        article.className = "product-card";
        article.id = item.id;

        const head = document.createElement("header");
        const kicker = document.createElement("p");
        kicker.className = "kicker";
        kicker.textContent = pick(item.layer);
        const title = document.createElement("h3");
        title.textContent = item.name;
        const badge = document.createElement("p");
        badge.className = "badge badge-" + (item.status || "notiz");
        badge.textContent = pick(item.statusLabel);
        head.append(kicker, title, badge);

        const line = document.createElement("p");
        line.className = "line";
        line.textContent = pick(item.line);
        const who = document.createElement("p");
        who.className = "muted";
        who.textContent = pick(item.who);

        const nav = document.createElement("p");
        nav.className = "card-links";
        const links = [];
        if (item.repo) links.push([label.source, item.repo]);
        if (item.fallback) links.push([label.fallback, item.fallback]);
        if (item.hub) links.push([label.suite, item.hub]);
        for (const [text, href] of links) {
          const a = document.createElement("a");
          a.href = href;
          a.textContent = text;
          nav.append(a);
        }

        article.append(head, line, who, nav);
        root.append(article);
      }
    })
    .catch(() => {
      root.hidden = true;
    });
})();
