(() => {
  const params = new URLSearchParams(location.search);
  const requestId = params.get("id") || "";
  const application = params.get("application") || "app";
  const provider = params.get("provider") || "provider";
  const scope = params.get("scope") || "";
  const ttl = params.get("ttl") || "";
  const summary = document.getElementById("summary");
  if (summary) {
    summary.replaceChildren();
    const appEl = document.createElement("strong");
    appEl.textContent = application;
    const provEl = document.createElement("strong");
    provEl.textContent = provider;
    const scopeEl = document.createElement("code");
    scopeEl.textContent = scope;
    summary.append(
      appEl,
      " fordert / requests ",
      provEl,
      " ",
      scopeEl,
      ` für / for ${ttl}s.`,
    );
  }

  async function decide(allow) {
    const invoke =
      (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
      (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke);
    if (typeof invoke !== "function") return;
    await invoke("access_decide", { requestId, allow });
  }

  document.getElementById("allow")?.addEventListener("click", () => void decide(true));
  document.getElementById("deny")?.addEventListener("click", () => void decide(false));
})();
