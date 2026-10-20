// Test feature only. The port is an owned synthetic listener, never production8788.
window.__NETWORK_PROBE__ = async state => {
  const http = "http://127.0.0.1:__OWNED_PORT__";
  const ws = "ws://127.0.0.1:__OWNED_PORT__";
  const suffix = "/h2-synthetic?window=" + encodeURIComponent(state.label);
  const violations = [];
  const onViolation = event => violations.push({
    directive: event.effectiveDirective, blockedURI: event.blockedURI,
  });
  document.addEventListener("securitypolicyviolation", onViolation);
  const network = { http: null, ws: null, violations };
  try {
    const response = await fetch(http + suffix, {
      credentials: "omit", signal: AbortSignal.timeout(4000),
    });
    network.http = { ok: response.ok, body: await response.text() };
  } catch (error) {
    network.http = { ok: false, error: String(error) };
  }
  network.ws = await new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    try {
      const socket = new WebSocket(ws + suffix);
      const timer = setTimeout(() => {
        socket.close(); finish({ ok: false, timeout: true });
      }, 4000);
      socket.onopen = () => {
        clearTimeout(timer); socket.close(); finish({ ok: true });
      };
      socket.onerror = () => {
        clearTimeout(timer); finish({ ok: false, error: true });
      };
    } catch (error) {
      finish({ ok: false, error: String(error) });
    }
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  document.removeEventListener("securitypolicyviolation", onViolation);
  state.network = network;
  const blocked = [http, ws].every(base => violations.some(event =>
    event.directive === "connect-src" && event.blockedURI.startsWith(base)));
  return __EXPECT_ALLOWED__ ? network.http.ok && network.ws.ok
    : !network.http.ok && !network.ws.ok && blocked;
};
