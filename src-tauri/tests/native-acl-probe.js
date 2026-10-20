// Injected by the native harness into real WKWebViews. No mockIPC or fake handler.
(() => {
  const commands = __COMMAND_NAMES__;
  const label = __WINDOW_LABEL__;
  const state = { done: false, passed: false, label, origin: location.origin, rows: [] };
  window.__H3_PROBE__ = state;
  void (async () => {
    const invoke = window.__TAURI__.core.invoke;
    for (const command of commands) {
      const allowed = label === "main" ? command !== "access_decide"
        : label === "access-prompt" && command === "access_decide";
      try {
        // Empty arguments fail before HTTP/import/open actions. The only no-arg
        // commands are dismissal and fixture-only browser listing in this binary.
        await invoke(command, {});
        state.rows.push({ command, allowed, outcome: "resolved", passed: allowed });
      } catch (error) {
        const message = String(error);
        const denied = /not allowed|not permitted|denied/i.test(message);
        const dispatched = /invalid args|missing required key/i.test(message);
        state.rows.push({ command, allowed, outcome: message,
          passed: allowed ? dispatched && !denied : denied });
      }
    }
    for (const command of ["plugin:event|listen", "plugin:event|emit"]) {
      const allowed = label === "main";
      try {
        await invoke(command, {});
        state.rows.push({ command, allowed, outcome: "resolved", passed: false });
      } catch (error) {
        const message = String(error);
        const denied = /not allowed|not permitted|denied/i.test(message);
        state.rows.push({ command, allowed, outcome: message,
          passed: allowed ? /invalid args|missing required key/i.test(message) && !denied : denied });
      }
    }
    if (label === "access-prompt") {
      // Exercise the actual shipped access-prompt.js click handler, not a stub.
      document.getElementById("deny").click();
    }
    // Optional extension exists only in the separately selected network probe.
    // Plain H3 never creates network sockets.
    const extraPassed = typeof window.__NETWORK_PROBE__ === "function"
      ? await window.__NETWORK_PROBE__(state) : true;
    state.passed = state.rows.every(row => row.passed) && extraPassed;
    state.done = true;
  })().catch(error => { state.error = String(error); state.done = true; });
})();
